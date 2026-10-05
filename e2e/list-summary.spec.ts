import { expect, test } from '@playwright/test';
import { login, service } from './helpers';

// Big lists: the summary numbers and the "Showing 1–50 of N" total come from the database,
// the summary numbers filter the list when clicked, and the toolbar stays on one row.
test.describe.configure({ mode: 'serial' });
const db = service();
const tag = 'E2E Bulk ' + String(Date.now()).slice(-6);

test.beforeAll(async () => {
  const { data: teja } = await db.from('staff').select('id').ilike('email', 'teja@%').single();
  const yesterday = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  const rows = Array.from({ length: 60 }, (_, i) => ({ full_name: `${tag} ${String(i + 1).padStart(2, '0')}`, mobile: '7' + String(100000000 + i + Number(tag.slice(-6)) * 61).slice(-9), stage: 'New', owner_id: teja!.id, next_call_at: i === 0 ? yesterday : null }));
  const { error } = await db.from('lead').insert(rows);
  if (error) throw error;
});
test.afterAll(async () => { await db.from('lead').delete().like('full_name', tag + '%'); });

test('lead summary numbers match the database and filter the list when clicked', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/lead');
  await page.getByRole('button', { name: 'table', exact: true }).click();
  const strip = page.getByTestId('summary-strip');
  const { count: interested } = await db.from('lead').select('id', { count: 'exact', head: true }).eq('stage', 'Interested');
  const chip = strip.getByRole('button', { name: /^Interested/ });
  await expect(chip).toHaveText(new RegExp('Interested\\s*' + interested));
  const { count: overdue } = await db.from('lead').select('id', { count: 'exact', head: true }).not('stage', 'in', '("Converted","Not interested")').lt('next_call_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString());
  await expect(strip.getByRole('button', { name: /^Overdue calls/ })).toHaveText(new RegExp('Overdue calls\\s*' + overdue));
  // clicking the overdue number shows only overdue leads (ours is one of them), highlighted in the Next call column
  await strip.getByRole('button', { name: /^Overdue calls/ }).click();
  await expect(strip.getByRole('button', { name: /^Overdue calls/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('list-count')).toContainText(overdue + ' shown');
  const row = page.locator('tr', { hasText: tag + ' 01' });
  await expect(row.locator('[data-due="bad"]')).toContainText('Overdue');
  await strip.getByRole('button', { name: /^Overdue calls/ }).click();
  await expect(strip.getByRole('button', { name: /^Overdue calls/ })).toHaveAttribute('aria-pressed', 'false');
});

test('lead list pages on the server: Showing 1–50 of N, next page, search by owner', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/lead');
  await page.getByRole('button', { name: 'table', exact: true }).click();
  const { count: all } = await db.from('lead').select('id', { count: 'exact', head: true });
  await expect(page.getByTestId('list-count')).toContainText(`Showing 1–50 of ${all}`);
  await expect(page.locator('tbody tr')).toHaveCount(50);
  await page.getByPlaceholder('Search this list').fill(tag);
  await expect(page.getByTestId('list-count')).toContainText('Showing 1–50 of 60');
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByTestId('list-count')).toContainText('Showing 51–60 of 60');
  await expect(page.locator('tbody tr')).toHaveCount(10);
  // sort by name descending on the server: the last one comes first
  await page.locator('thead').getByRole('button', { name: 'Lead', exact: true }).click();
  await page.locator('thead').getByRole('button', { name: 'Lead', exact: true }).click();
  await expect(page.locator('tbody tr').first()).toContainText(tag + ' 60');
  // owner names are searchable too (looked up, then filtered by the database)
  await page.getByPlaceholder('Search this list').fill('Pooja');
  await expect(page.locator('tbody tr').first()).toContainText('Pooja');
  await page.getByPlaceholder('Search this list').fill('zzqq no such lead');
  await expect(page.getByText('No matches')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search and filters' }).click();
  await expect(page.getByTestId('list-count')).toContainText(`of ${all}`);
});

test('toolbar is one row at 1440 with the quick panel open; phone puts layout in the View menu', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'harsha');
  await page.goto('/p/candidate');
  await expect(page.getByRole('complementary', { name: 'Quick panel' })).toBeVisible();
  const bar = page.getByTestId('list-toolbar');
  await expect(bar.getByRole('button', { name: 'board', exact: true })).toBeVisible();
  expect((await bar.boundingBox())!.height).toBeLessThan(50);
  // candidate stage shows its place in the stage order
  await page.getByRole('button', { name: 'table', exact: true }).click();
  await expect(page.locator('tbody tr').first()).toContainText(/Step \d+ of \d+/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('button', { name: 'board', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /^View/ }).click();
  const menu = page.getByRole('dialog', { name: 'View options' });
  await expect(menu.getByRole('button', { name: 'board', exact: true })).toBeVisible();
  await expect(menu.getByRole('button', { name: /^Advanced/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('payments: money totals come from the database (Finance)', async ({ page }) => {
  await login(page, 'suresh');
  await page.goto('/p/payment');
  const { data } = await db.from('fee_payment').select('amount, status');
  const collected = (data || []).filter((r) => r.status === 'Received').reduce((a, r) => a + Number(r.amount), 0);
  await expect(page.getByTestId('summary-strip').getByRole('button', { name: /^Collected/ })).toContainText(collected.toLocaleString('en-IN'));
});
