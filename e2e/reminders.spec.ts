import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('admin sees reminder rules, previews who would get one today, and edits a rule', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/reminders');
  const rules = page.getByTestId('reminder-rules');
  await expect(rules).toBeVisible({ timeout: 15_000 });
  const row = rules.locator('tr[data-rule="Class tomorrow"]');
  await expect(row).toBeVisible();
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await row.getByRole('button', { name: 'Preview today' }).click();
  await expect(page.getByTestId('reminder-preview')).toContainText('nothing is sent');
  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('region', { name: 'Edit reminder' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('reminder-log')).toBeVisible();
});

test('telecaller cannot open the reminders page', async ({ page }) => {
  await login(page, 'teja');
  await page.goto('/p/reminders');
  await expect(page.getByText('This page isn’t open to your role')).toBeVisible({ timeout: 15_000 });
});

test('turning a reminder on first shows how many people it would message', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/reminders');
  const row = page.getByTestId('reminder-rules').locator('tr[data-rule="Class tomorrow"]');
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole('switch').click();
  const confirm = page.getByTestId('reminder-confirm');
  await expect(confirm).toContainText(/this will message \d+/);
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
});
