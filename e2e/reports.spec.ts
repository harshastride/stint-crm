import { expect, test } from '@playwright/test';
import { login } from './helpers';

const SHOTS = process.env.REPORT_SHOTS;
// Every fixed report states its question, period and freshness, explains its numbers and links to the rows behind it.
for (const id of ['rep_funnel', 'rep_roi', 'rep_batch', 'rep_place', 'rep_cash']) {
  test(`${id} explains itself`, async ({ page }) => {
    await login(page, 'harsha');
    await page.goto('/p/' + id);
    const h = page.getByTestId('report-header');
    await expect(h).toBeVisible({ timeout: 20000 });
    await expect(h).toContainText('Period:');
    await expect(page.getByTestId('report-freshness')).toContainText('IST');
    await h.getByText('How each number is worked out').click();
    await expect(h.locator('dt').first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'See the rows behind this report' }).getByRole('link').first()).toBeVisible();
    if (SHOTS) {
      await page.setViewportSize({ width: 1440, height: 900 }); await page.screenshot({ path: `${SHOTS}/pe-reports-${id}-desk.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: `${SHOTS}/pe-reports-${id}-mob.png`, fullPage: true });
    }
  });
}

test('cash report drills through to overdue fee plans', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/rep_cash');
  await page.getByRole('link', { name: 'Overdue plans' }).click({ timeout: 20000 });
  await expect(page).toHaveURL(/\/p\/plan\?view=Overdue/);
});

test('report builder starts from a common question', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/reports_builder');
  await page.getByRole('button', { name: 'How much fee did we receive each month?' }).click();
  await expect(page.getByRole('table', { name: 'Report results' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Total amount' })).toBeVisible();
  await expect(page.getByTestId('report-filter')).toHaveCount(1);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pe-reports-builder-desk.png`, fullPage: true });
});

test('a role without the report page cannot open it', async ({ page }) => {
  await login(page, 'suresh');
  await page.goto('/p/rep_cash');
  await expect(page.getByText('This page isn’t open to your role')).toBeVisible({ timeout: 20000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pe-reports-cash-finance.png`, fullPage: true });
});
