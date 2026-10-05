import { test, expect } from '@playwright/test';
import { login, service } from './helpers';

test('admin sees a lead change in the audit log with a diff and CSV export', async ({ page }) => {
  const svc = service();
  const l = (await svc.from('lead').select('id,full_name,city').limit(1).single()).data!;
  await svc.from('lead').update({ city: 'E2E Audit City' }).eq('id', l.id);
  await svc.from('lead').update({ city: l.city }).eq('id', l.id);
  await login(page, 'harsha');
  await page.goto('/p/audit');
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Person or record').fill(l.full_name);
  await page.getByLabel('Table').selectOption('lead');
  const row = page.getByTestId('audit-row').filter({ hasText: 'E2E Audit City' }).first();
  await expect(row).toContainText(`on lead ${l.full_name}`, { timeout: 15_000 });
  await row.getByRole('button', { name: 'Show details' }).click();
  await expect(page.getByTestId('audit-diff').first()).toContainText('City');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await dl).suggestedFilename()).toMatch(/^audit-log-.*\.csv$/);
});

test('non-admin cannot open the audit log', async ({ page }) => {
  await login(page, 'teja');
  await page.goto('/p/audit');
  await expect(page.getByText('This page isn’t open to your role')).toBeVisible({ timeout: 20_000 });
});
