import { expect, test } from '@playwright/test';
import { login } from './helpers';

// Dashboard number cards show a 30-day trend line with a hover value and a change against the previous 30 days.
test('Admin sees sparklines with hover values on the number cards', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/');
  const sparks = page.getByTestId('sparkline');
  await expect(sparks.first()).toBeVisible();
  expect(await sparks.count()).toBeGreaterThanOrEqual(3);
  const svg = sparks.first().locator('svg');
  await svg.scrollIntoViewIfNeeded();
  const box = (await svg.boundingBox())!;
  await svg.hover({ position: { x: box.width * 0.9, y: box.height / 2 } });
  await expect(page.getByTestId('sparkline-tip')).toContainText('·');
  await page.mouse.move(0, 0);
  await expect(page.getByTestId('sparkline-tip')).toHaveCount(0);
});

test('Telecaller has no fees sparkline', async ({ page }) => {
  await login(page, 'teja');
  await page.goto('/');
  await expect(page.getByRole('img', { name: /New leads this month: last 30 days/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /Collected this month/ })).toHaveCount(0);
});

test('Number cards show placeholders while loading', async ({ page }) => {
  await login(page, 'harsha');
  await page.route('**/rest/v1/rpc/kpi_trends*', async (r) => { await new Promise((f) => setTimeout(f, 1500)); await r.continue(); });
  await page.goto('/');
  await expect(page.getByTestId('stat-skeleton')).toBeVisible();
  await expect(page.getByTestId('sparkline').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('stat-skeleton')).toHaveCount(0);
});
