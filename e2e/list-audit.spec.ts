import { test, expect } from '@playwright/test';
import { login } from './helpers';

// List audit: checkboxes only where bulk actions exist and only on hover / once selecting;
// board columns only as tall as their cards; summary numbers are not repeated next to the same tab.
test.use({ viewport: { width: 1440, height: 900 } });

test('row checkboxes: hidden until hover, all shown once one is ticked; none on pages without bulk actions', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/followups');
  const rows = page.locator('tbody tr[data-clickable]');
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  const ticks = page.getByTestId('row-tick');
  await page.mouse.move(5, 5);
  await expect(ticks.nth(2)).toHaveCSS('opacity', '0');
  await rows.nth(1).hover();
  await expect(rows.nth(1).getByTestId('row-tick')).toHaveCSS('opacity', '1');
  await rows.nth(1).getByTestId('row-tick').click();
  await page.mouse.move(5, 5);
  await expect(ticks.nth(3)).toHaveCSS('opacity', '1');

  await page.goto('/p/payment');
  await expect(page.locator('tbody tr[data-clickable]').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('row-tick')).toHaveCount(0);
});

test('board columns are only as tall as their cards; strip does not repeat a tab count', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/users');
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('summary-strip').getByText('Active users')).toHaveCount(0);

  await page.goto('/p/placement');
  const board = page.getByTestId('board');
  if (await board.count()) {
    const empty = board.locator('section').filter({ hasText: 'No cards' }).first();
    if (await empty.count()) expect((await empty.boundingBox())!.height).toBeLessThan(160);
  }
});
