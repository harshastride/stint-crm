import { expect, test, type Locator, type Page } from '@playwright/test';
import { login } from './helpers';

// Phone list cards: swipe left shows actions, swipe right calls, the "⋯" menu has the same actions.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const SHOTS = process.env.PE_SHOTS;

async function swipe(page: Page, card: Locator, dx: number, dy = 0) {
  const b = (await card.boundingBox())!;
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y + (dy * i) / 8);
  await page.mouse.up();
}

test('leads: swipe left reveals Log outcome and Follow-up; one row open at a time; tap elsewhere closes', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/lead');
  const rows = page.getByTestId('phone-cards').getByTestId('swipe-row');
  await expect(rows.first()).toBeVisible();
  await expect(page.locator('table')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // no unmasked numbers in the cards
  expect(await page.getByTestId('phone-cards').innerText()).not.toMatch(/\d{10}/);

  await swipe(page, rows.nth(0), -160);
  await expect(rows.nth(0)).toHaveAttribute('data-open', 'true');
  await expect(rows.nth(0).getByRole('button', { name: 'Log outcome' })).toBeInViewport();
  if (SHOTS) await page.screenshot({ path: SHOTS + '/pe-swipe-open.png' });
  await swipe(page, rows.nth(1), -160);
  await expect(rows.nth(1)).toHaveAttribute('data-open', 'true');
  await expect(rows.nth(0)).not.toHaveAttribute('data-open', 'true');
  await page.getByRole('heading').first().click();
  await expect(rows.nth(1)).not.toHaveAttribute('data-open', 'true');

  // vertical drag is a scroll, not a swipe
  await swipe(page, rows.nth(2), 20, 120);
  await expect(rows.nth(2)).not.toHaveAttribute('data-open', 'true');

  await swipe(page, rows.nth(0), -160);
  await rows.nth(0).getByRole('button', { name: 'Log outcome' }).click();
  const panel = page.getByRole('complementary', { name: 'Quick panel' });
  await expect(panel.getByTestId('composer').getByRole('button', { name: 'Log call' })).toHaveAttribute('aria-pressed', 'true');
  if (SHOTS) await page.screenshot({ path: SHOTS + '/pe-swipe-log.png' });
});

test('leads: swipe right opens the quick panel for the call (number stays masked in the list)', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/lead');
  const card = page.getByTestId('phone-cards').getByTestId('swipe-row').first();
  await swipe(page, card, 200);
  await expect(page.getByRole('complementary', { name: 'Quick panel' })).toBeVisible();
});

test('"⋯" menu offers the same actions; follow-ups have Done', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/lead');
  const card = page.getByTestId('phone-cards').getByTestId('swipe-row').first();
  await card.getByRole('button', { name: /^Actions for/ }).click();
  const menu = card.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText(['Call', 'Log outcome', 'Follow-up']);
  await menu.getByRole('menuitem', { name: 'Follow-up' }).click();
  await expect(page.getByRole('complementary', { name: 'Quick panel' }).getByRole('button', { name: 'Add follow-up' })).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/p/followups');
  const f = page.getByTestId('phone-cards').getByTestId('swipe-row').first();
  await expect(f).toBeVisible();
  await f.getByRole('button', { name: /^Actions for/ }).click();
  await expect(f.getByRole('menuitem', { name: 'Done' })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: SHOTS + '/pe-swipe-menu.png' });
  await page.keyboard.press('Escape');
  await expect(f.getByRole('menu')).toHaveCount(0);
});

test('desktop is unchanged: table, no cards', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'harsha');
  await page.goto('/p/candidate');
  await page.getByRole('button', { name: 'table', exact: true }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await expect(page.getByTestId('phone-cards')).toBeHidden();
});
