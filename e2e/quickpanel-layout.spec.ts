import { expect, test } from '@playwright/test';
import { login } from './helpers';

// Quick panel layout: fixed header and composer, sticky tabs, only the middle scrolls.
test('quick panel: header, sticky tabs, composer at the bottom, Chat has height, J/K', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 760 });
  await login(page, 'harsha');
  await page.goto('/p/lead');
  await page.getByRole('button', { name: 'table', exact: true }).click();
  await page.locator('tbody tr').first().click();
  const panel = page.getByRole('complementary', { name: 'Quick panel' });
  const name = panel.locator('.truncate.text-base').first();
  await expect(name).not.toBeEmpty();
  const first = await name.innerText();

  const composer = panel.getByTestId('composer');
  await expect(composer).toBeInViewport();
  await composer.getByRole('button', { name: 'Add note' }).click();
  await expect(composer.getByLabel('Note', { exact: true })).toBeVisible();
  await composer.getByRole('button', { name: 'Close the box' }).click();

  // scroll the middle; the tab bar stays visible
  await panel.getByRole('tab', { name: 'Timeline', exact: true }).click();
  const scroller = panel.getByTestId('panel-scroll');
  await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(panel.getByRole('tablist')).toBeInViewport();
  await expect(composer).toBeInViewport();

  await panel.getByRole('tab', { name: 'Chat', exact: true }).click();
  const box = await panel.getByTestId('chat').boundingBox();
  expect(box!.height).toBeGreaterThan(100);

  await page.keyboard.press('j');
  await expect(name).not.toHaveText(first);
  await page.keyboard.press('k');
  await expect(name).toHaveText(first);
});
