import { expect, test, type Locator } from '@playwright/test';
import { login } from './helpers';

/** Open a card of the quick panel by clicking its header, only if it is closed (what is open at the start depends on the role). */
async function openCard(panel: Locator, id: string) {
  const card = panel.getByTestId('card-' + id);
  if ((await card.getAttribute('data-open')) === 'false') await card.getByRole('button').first().click();
  await expect(card).toHaveAttribute('data-open', 'true');
  return card;
}

// Quick panel layout: fixed header and composer, a stack of cards, only the middle scrolls.
test('quick panel: header, cards, composer at the bottom, Messages has height, J/K', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 760 });
  await login(page, 'harsha');
  await page.goto('/p/lead');
  await page.getByRole('button', { name: 'table', exact: true }).click();
  await page.locator('tbody tr').first().click();
  const panel = page.getByRole('complementary', { name: 'Quick panel' });
  const name = panel.getByTestId('qp-name');
  await expect(name).not.toBeEmpty();
  await expect(name).toBeInViewport();
  const first = await name.innerText();

  const composer = panel.getByTestId('composer');
  await expect(composer).toBeInViewport();
  await composer.getByRole('button', { name: 'Add note' }).click();
  await expect(composer.getByLabel('Note', { exact: true })).toBeVisible();
  await composer.getByRole('button', { name: 'Close the box' }).click();

  // clicking a card header toggles it
  const stage = panel.getByTestId('card-stage');
  const stageHead = stage.getByRole('button').first();
  const was = await stageHead.getAttribute('aria-expanded');
  await stageHead.click();
  await expect(stageHead).toHaveAttribute('aria-expanded', was === 'true' ? 'false' : 'true');
  await expect(stage).toHaveAttribute('data-open', was === 'true' ? 'false' : 'true');
  await stageHead.click();
  await expect(stageHead).toHaveAttribute('aria-expanded', was!);

  // scroll the middle; the header and the composer stay in view
  await openCard(panel, 'activity');
  const scroller = panel.getByTestId('panel-scroll');
  await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(name).toBeInViewport();
  await expect(composer).toBeInViewport();

  await openCard(panel, 'chat');
  const box = await panel.getByTestId('chat').boundingBox();
  expect(box!.height).toBeGreaterThan(100);
  await expect(composer).toBeInViewport();

  // "Close all" closes every card
  await panel.getByRole('button', { name: 'Close all' }).click();
  await expect(panel.locator('[data-card][data-open="true"]')).toHaveCount(0);
  await expect(panel.locator('[data-card] > h3 > button[aria-expanded="true"]')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Close all' })).toHaveCount(0);

  await page.keyboard.press('j');
  await expect(name).not.toHaveText(first);
  await page.keyboard.press('k');
  await expect(name).toHaveText(first);

  // hide the panel, then bring it back from the list
  await panel.getByRole('button', { name: 'Hide panel (Esc)' }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: 'Show panel' }).click();
  await expect(page.getByRole('complementary', { name: 'Quick panel' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Quick panel' }).getByTestId('qp-name')).toHaveText(first);
});
