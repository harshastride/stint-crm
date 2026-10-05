import { expect, test } from '@playwright/test';
import { login } from './helpers';

// Week calendar: Mon–Sun grid, prev/next/today, colour per type, only what the role can read, day view on phones.

test('admin sees a Mon–Sun week and can move between weeks', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/calendar');
  await expect(page.getByRole('heading', { name: 'Week calendar' })).toBeVisible();
  const heading = page.locator('h2[aria-live]');
  const first = await heading.textContent();
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(heading).not.toHaveText(first || '');
  await page.getByRole('button', { name: 'Previous week' }).click();
  await page.getByRole('button', { name: 'Previous week' }).click();
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(heading).toHaveText(first || '');
  await expect(page.locator('section[data-day]')).toHaveCount(7);
  await expect(page.locator('section[data-day="0"]').getByText('Mon', { exact: true })).toBeVisible();
});

test('clicking a class opens the batch record', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/calendar');
  const cls = page.locator('button[data-kind="class"]').first();
  test.skip(!(await cls.count()), 'no live batch classes this week in demo data');
  await cls.click();
  await expect(page).toHaveURL(/\/p\/batch/);
});

test('finance never sees mock interviews', async ({ page }) => {
  await login(page, 'suresh');
  await page.goto('/calendar');
  await expect(page.getByRole('heading', { name: 'Week calendar' })).toBeVisible();
  await expect(page.locator('button[data-kind="interview"]')).toHaveCount(0);
});

test('phones show one day at a time', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, 'harsha');
  await page.goto('/calendar');
  await expect(page.locator('[data-view="agenda"]')).toBeVisible();   // phones open on the agenda list
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(7);
  await tabs.nth(2).click();
  await expect(page.locator('section[data-day="2"]')).toBeVisible();
  await expect(page.locator('section[data-day="0"]')).toBeHidden();
});

test('agenda list, only mine, and add a follow-up from a day with the time filled in', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/calendar');
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.locator('[data-view="agenda"]')).toBeVisible();
  await page.getByRole('button', { name: 'Only mine' }).click();
  await expect(page.getByText(/\(only yours\)/)).toBeVisible();
  const today = new Date();
  await page.getByRole('button', { name: 'Add follow-up on ' + today.toDateString() }).click();
  await expect(page).toHaveURL(/\/p\/followups/);
  const editor = page.getByRole('complementary', { name: 'New follow-up' });
  const due = editor.getByLabel('Due', { exact: true });
  await expect(due).not.toHaveValue('', { timeout: 15_000 });
  expect((await due.inputValue()).slice(0, 10)).toBe(today.toLocaleDateString('en-CA'));
  await expect(editor.locator('[data-field="owner_id"] select')).not.toHaveValue('');   // owner defaults to me
});

test('two items for the same person at the same time are flagged as a clash', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/calendar');
  const clash = page.locator('button[data-clash="yes"]').first();
  test.skip(!(await clash.count()), 'no overlapping items this week in demo data');
  await expect(clash).toContainText('Clash');
});
