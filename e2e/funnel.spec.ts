import { test, expect } from '@playwright/test';
import { login } from './helpers';

// Cohort funnel: one group of leads (created in the chosen dates); each step counts how many of them reached it.
test('funnel steps never grow, show scope and percent, and open the same leads', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/');
  const f = page.getByTestId('funnel');
  await expect(f.getByTestId('funnel-step')).toHaveCount(5, { timeout: 20_000 });
  await expect(f.getByTestId('funnel-scope')).toContainText('Leads created at any time');
  const ns = await f.getByTestId('funnel-step').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-n'))));
  for (let i = 1; i < ns.length; i++) expect(ns[i]).toBeLessThanOrEqual(ns[i - 1]);
  await f.getByRole('button', { name: 'How this is counted' }).click();
  await expect(f.locator('#funnel-def')).toContainText('same group');
  await f.getByRole('button', { name: 'All time' }).click();
  await page.getByRole('button', { name: 'Last 90 days' }).click();
  await expect(f.getByTestId('funnel-scope')).toContainText(/Leads created \d+ \w+ \d{4} – /);
  await expect(f.getByTestId('funnel-step')).toHaveCount(5);
  const base = Number(await f.getByTestId('funnel-step').first().getAttribute('data-n'));
  await f.getByTestId('funnel-step').first().getByRole('link').click();
  await expect(page).toHaveURL(/\/p\/lead\?from=\d{4}-\d{2}-\d{2}&to=/);
  await expect(page.getByText(new RegExp(`^(${base} shown|\\d+–\\d+ of ${base})`))).toBeVisible({ timeout: 20_000 });
});

test('funnel says "not enough data" for dates with no leads', async ({ page }) => {
  await login(page, 'harsha');
  await page.route('**/rest/v1/rpc/funnel_cohort*', (r) => r.fulfill({ json: [1, 2, 3, 4, 5].map((step) => ({ step, label: 'S' + step, n: 0, history_since: null })) }));
  await page.goto('/');
  await expect(page.getByTestId('funnel-empty')).toContainText('Not enough data', { timeout: 20_000 });
});

test('funnel on the Lead funnel report page', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/rep_funnel');
  await expect(page.getByTestId('funnel').getByTestId('funnel-step')).toHaveCount(5, { timeout: 20_000 });
});
