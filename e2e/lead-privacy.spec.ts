import { expect, test } from '@playwright/test';
import { login, service } from './helpers';

// Lead contact details stay masked on screen; search still works by digits; export is Admin-only.
const stamp = String(Date.now()).slice(-8);
const mobile = '8' + stamp.slice(-9).padStart(9, '3');
const walkMobile = '6' + stamp.slice(-9).padStart(9, '4');
const name = 'E2E Private ' + stamp;
let leadId = '';

test.beforeAll(async () => {
  const db = service();
  const { data: teja } = await db.from('staff').select('id').ilike('email', 'teja@%').single();
  const { data, error } = await db.from('lead').insert({ full_name: name, mobile, stage: 'New', owner_id: teja!.id }).select('id').single();
  if (error) throw error;
  leadId = data!.id;
});

test.afterAll(async () => {
  const db = service();
  await db.from('lead').delete().in('mobile', [mobile, walkMobile]);
});

test('telecaller sees masked numbers, can search by last digits and edit the stage inline', async ({ page }) => {
  await login(page, 'teja');
  await page.goto('/p/lead');
  await page.getByRole('button', { name: 'table', exact: true }).click();
  const table = page.locator('table');
  await expect(table).toContainText(name);
  await expect(table).toContainText('•');
  expect(await table.innerText()).not.toMatch(/(?<!\d)[6-9]\d{9}(?!\d)/);
  expect(await table.innerText()).not.toContain(mobile);

  // search by the last 4 digits (command menu / person search use search_people)
  const menu = page.getByRole('dialog', { name: 'Command menu' });
  await expect(async () => {
    if (!(await menu.isVisible())) await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    await expect(menu).toBeVisible({ timeout: 1000 });
  }).toPass();
  await menu.getByRole('combobox').fill(mobile.slice(-4));
  await expect(menu.getByText(name).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // inline stage edit still saves
  const row = page.locator('tr', { hasText: name });
  await row.getByRole('button', { name: /^Stage: .*Change$/ }).click();
  await row.getByLabel('Stage').selectOption('Callback');
  await expect.poll(async () => (await service().from('lead').select('stage').eq('id', leadId).single()).data!.stage).toBe('Callback');

  // no export for a non-Admin
  await row.getByRole('checkbox').first().click();
  await expect(page.getByRole('button', { name: /^Export/ })).toHaveCount(0);
});

test('export button is shown to Admin only', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/history');
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible();
  await login(page, 'praveen');   // HR can read the change history (a page with export) but is not Admin
  await page.goto('/p/history');
  await expect(page.getByRole('heading', { name: /history/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toHaveCount(0);
});

test('walk-in enquiry still saves and a repeat mobile is caught', async ({ page }) => {
  await login(page, 'anita');
  await page.goto('/p/enquiry');
  await page.getByPlaceholder('As they say it').fill('E2E Walk ' + stamp);
  await page.getByLabel('Mobile', { exact: true }).fill(walkMobile);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'Python' }) }).first().selectOption({ label: 'Python' });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Save enquiry' }).click();
  await expect(page.getByText(/saved as a new lead/)).toBeVisible();
  await page.getByPlaceholder('As they say it').fill('E2E Again');
  await page.getByLabel('Mobile', { exact: true }).fill(walkMobile);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText(/already in the CRM as E2E Walk/)).toBeVisible();
});
