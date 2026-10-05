import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('button gallery renders for Admin with 44px hit areas', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/dev/ui');
  await expect(page.getByRole('heading', { name: 'UI kit' })).toBeVisible();
  const light = page.getByRole('region', { name: 'Light theme' });
  await expect(light.getByRole('button', { name: 'Loading' }).first()).toBeDisabled();
  const list = light.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Board' });
  await list.click();
  await expect(list).toHaveAttribute('aria-pressed', 'true');
  const hit = await light.getByRole('button', { name: 'Filter' }).first().evaluate((el) => {
    const b = getComputedStyle(el, '::before'); return [parseFloat(b.width), parseFloat(b.height)];
  });
  expect(Math.min(...hit)).toBeGreaterThanOrEqual(44);
});

test('ui kit table: sidebar-style selected row and density toggle', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/dev/ui');
  const t = page.getByRole('table', { name: 'Sample leads' });
  await t.getByRole('row', { name: /Ravi Kumar/ }).click();
  await expect(t.getByRole('row', { name: /Ravi Kumar/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('group', { name: 'Density' }).getByRole('button', { name: 'Compact' }).click();
  await expect(t).toHaveAttribute('data-density', 'compact');
});
