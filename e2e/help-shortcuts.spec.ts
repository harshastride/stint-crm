import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('help page: open from account menu, search, expand', async ({ page }) => {
  await login(page, 'anita');
  await page.getByRole('button', { name: /^Account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Help' }).click();
  await expect(page).toHaveURL(/\/help$/);
  await expect(page.getByRole('heading', { name: 'Help', level: 1 })).toBeVisible();
  const search = page.getByLabel('Search help');
  await search.fill('payment');
  await expect(page.getByRole('button', { name: 'How do I record a payment?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'How do I log a call?' })).toHaveCount(0);
  await page.getByRole('button', { name: 'How do I record a payment?' }).click();
  await expect(page.getByText(/press "Record payment"/)).toBeVisible();
  await expect(page.getByText('Still stuck? Ask your admin.')).toBeVisible();
});

test('"?" opens the shortcuts sheet, but not while typing', async ({ page }) => {
  await login(page, 'anita');
  await page.goto('/help');
  await page.getByRole('heading', { name: 'Help', level: 1 }).click();
  await page.keyboard.press('Shift+?');
  const dlg = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dlg).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  const search = page.getByLabel('Search help');
  await search.click();
  await page.keyboard.type('?');
  await expect(search).toHaveValue('?');
  await expect(dlg).toHaveCount(0);
  await page.getByRole('button', { name: /^Account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click();
  await expect(dlg).toBeVisible();
});
