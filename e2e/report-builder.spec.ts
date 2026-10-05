import { expect, test } from '@playwright/test';
import { login } from './helpers';

// Report builder: whitelist-only reports, live table + chart, CSV, save and share.
test('admin builds a payments report, sees table and chart, downloads CSV and saves it', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/reports_builder');
  await expect(page.getByRole('heading', { name: 'Report builder' })).toBeVisible();
  await expect(page.getByLabel('Data source').locator('option')).not.toHaveCount(1);
  const srcOpts = await page.getByLabel('Data source').locator('option').allTextContents();
  expect(srcOpts).toEqual(expect.arrayContaining(['Leads', 'Fee payments', 'Placements']));
  await page.getByLabel('Data source').selectOption('payments');
  // sensitive columns are never offered
  const opts = await page.getByLabel('Split by 1').locator('option').allTextContents();
  expect(opts.join(' ')).not.toMatch(/mobile|email|pan|aadhaar|bank/i);
  await page.getByLabel('Split by 1').selectOption('due_on');
  await page.getByLabel('Date step 1').selectOption('month');
  await page.getByRole('button', { name: 'Add number' }).click();
  await expect(page.getByRole('table', { name: 'Report results' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Total amount' })).toBeVisible();
  await expect(page.getByTestId('report-chart')).toBeVisible();
  await page.getByRole('button', { name: 'Line chart' }).click();

  // list mode
  await page.getByRole('button', { name: 'List of rows' }).click();
  await expect(page.getByRole('columnheader', { name: 'Amount' })).toBeVisible();

  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  expect((await dl).suggestedFilename()).toMatch(/\.csv$/);

  const name = 'RB test ' + Date.now();
  await page.getByLabel('Report name').fill(name);
  await page.getByRole('button', { name: 'Finance' }).click();
  await page.getByRole('button', { name: 'Save report' }).click();
  await expect(page.getByText('Report saved')).toBeVisible();
  await expect(page.getByLabel('Open a saved report').locator('option', { hasText: name })).toHaveCount(1);
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Report deleted')).toBeVisible();
});

test('telecaller cannot open the report builder', async ({ page }) => {
  await login(page, 'teja');
  await page.goto('/p/reports_builder');
  await expect(page.getByText('This page isn’t open to your role')).toBeVisible();
});
