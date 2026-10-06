import { expect, test } from '@playwright/test';
import { login, service } from './helpers';

test('idle warning, stay signed in, then signed out after no activity', async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __stintIdleMs: number }).__stintIdleMs = 4000; });
  await login(page, 'harsha');
  const dialog = page.getByRole('alertdialog', { name: 'Still there?' });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText('to keep student data safe');
  await dialog.getByRole('button', { name: 'Stay signed in' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/login/);
  // no activity now: warning comes back, then sign-out
  await expect(page).toHaveURL(/\/login\?reason=idle/, { timeout: 15_000 });
  await expect(page.getByText('Signed out after 30 minutes without activity')).toBeVisible();
});

test('Records tab: contact-stage chips save to app_role', async ({ page }) => {
  const db = service();
  const { data: before } = await db.from('app_role').select('contact_lead_stages, contact_candidate_stages').eq('name', 'Telecaller').single();
  await login(page, 'harsha');
  await page.goto('/p/roles');
  await page.getByRole('button', { name: 'Records', exact: true }).click();
  await page.getByRole('navigation', { name: 'Roles' }).getByRole('button', { name: 'Telecaller', exact: true }).click();
  const sec = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Telecaller', exact: true }) });
  await expect(sec.getByText('Can see contact details while the lead is in')).toBeVisible({ timeout: 15_000 });
  await expect(sec.getByText('Can see contact details while the student is in')).toBeVisible();
  const leadBox = sec.getByText('Can see contact details while the lead is in', { exact: true }).locator('xpath=..');
  try {
    await leadBox.getByRole('button', { name: 'Any stage' }).click();
    await expect(page.getByText(/Telecaller: can see lead contact details in any stage/)).toBeVisible();
    await expect.poll(async () => (await db.from('app_role').select('contact_lead_stages').eq('name', 'Telecaller').single()).data?.contact_lead_stages ?? null).toBeNull();
  } finally {
    await db.from('app_role').update(before!).eq('name', 'Telecaller');
  }
});

test('Data access log: Admin sees it, Telecaller does not', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/accesslog');
  await expect(page.getByRole('heading', { name: 'Data access log' })).toBeVisible({ timeout: 15_000 });
  await login(page, 'teja');
  await page.goto('/p/accesslog');
  await expect(page.getByText('This page isn’t open to your role')).toBeVisible({ timeout: 15_000 });
});
