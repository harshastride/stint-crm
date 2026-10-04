import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('funnel shows steps with kept/lost and opens a filtered list', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/');
  const f = page.getByTestId('funnel');
  await expect(f.getByTestId('funnel-step')).toHaveCount(5, { timeout: 20_000 });
  await expect(f.getByTestId('funnel-drop').first()).toContainText('% kept');
  await f.getByRole('button', { name: 'All time' }).click();
  await page.getByRole('button', { name: 'Last 90 days' }).click();
  await expect(f.getByTestId('funnel-step')).toHaveCount(5);
  await f.getByTestId('funnel-step').nth(1).click();
  await expect(page).toHaveURL(/\/p\/lead\?stage=Interested/);
});

test('funnel on the Lead funnel report page', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/rep_funnel');
  await expect(page.getByTestId('funnel').getByTestId('funnel-step')).toHaveCount(5, { timeout: 20_000 });
});
