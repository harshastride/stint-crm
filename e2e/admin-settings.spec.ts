import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('admin sidebar groups settings and roles page explains a role and confirms removal', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/roles');
  const nav = page.getByRole('navigation', { name: 'Pages' });
  for (const g of ['People & access', 'Data', 'Automation', 'Messaging']) await expect(nav.getByRole('group', { name: g })).toBeVisible({ timeout: 15_000 });
  await expect(nav.getByRole('group', { name: 'People & access' }).getByRole('link', { name: /Audit log/ })).toHaveAttribute('href', '/p/audit');
  await page.getByLabel('Role to summarise').selectOption('Telecaller');
  await expect(page.getByTestId('role-summary')).toContainText('Cannot open');
  const edit = page.getByRole('button', { name: /^Telecaller, .*: Edit$/ }).first();
  await edit.click();
  await expect(page.getByTestId('roles-confirm')).toContainText('Remove');
  await page.getByTestId('roles-confirm').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('roles-confirm')).toHaveCount(0);
});
