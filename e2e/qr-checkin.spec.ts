import { test, expect, type Page } from '@playwright/test';
import { login, service, PASSWORD } from './helpers';

const SHOT = '/private/tmp/claude-501/-Users-kanalaharshareddy-Applications-stint-crm/44af8995-f50d-49d2-96fc-b1698d4bcbd0/scratchpad/pe-qr-';

async function student(page: Page) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email').fill('priya@demo.stint.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/portal/, { timeout: 20000 });
}

test('trainer shows the check-in QR, student checks in with the short code, count updates', async ({ browser }) => {
  const db = service();
  const { data: me } = await db.from('candidate').select('id, batch_id').eq('full_name', 'Priya Reddy').single();
  const { data: b } = await db.from('batch').select('code').eq('id', me!.batch_id).single();
  const today = (await db.rpc('checkin_today')).data as string;
  await db.from('attendance').delete().eq('candidate_id', me!.id).eq('day', today);
  await db.from('checkin_log').delete().eq('candidate_id', me!.id).eq('ok', false); // fresh rate-limit window
  const t0 = new Date(Date.now() - 1000).toISOString();

  const t = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await login(t, 'kiran');
  await t.goto('/p/attendance');
  await t.getByLabel('Batch', { exact: true }).selectOption({ label: `${b!.code} (mine)` });
  await t.getByRole('button', { name: 'Show check-in QR' }).click();
  const dlg = t.getByRole('dialog', { name: `Check-in for ${b!.code}` });
  await expect(dlg.getByTestId('checkin-code')).toHaveText(/^[A-Z0-9]{6}$/, { timeout: 15000 });
  await expect(dlg.getByRole('img', { name: 'Check-in QR code' }).locator('svg')).toBeVisible();
  const count = dlg.getByTestId('checkin-count');
  await expect(count).toHaveText(/^0 of \d+ checked in$/);
  await t.screenshot({ path: SHOT + 'trainer-1440.png' });
  const code = (await dlg.getByTestId('checkin-code').textContent())!.trim();

  const s = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await student(s);
  await s.getByRole('button', { name: 'Check in to class' }).click();
  await s.getByLabel('Check-in code').fill('ZZZZZZ');
  await s.getByRole('button', { name: 'Check in', exact: true }).click();
  await expect(s.getByText(/not valid for your class/)).toBeVisible();
  await s.getByLabel('Check-in code').fill(code);
  await s.getByRole('button', { name: 'Check in', exact: true }).click();
  await expect(s.getByText(/Checked in\. You are marked present/)).toBeVisible();
  await s.screenshot({ path: SHOT + 'student-390.png', fullPage: true });

  await expect(count).toHaveText(/^1 of \d+ checked in$/, { timeout: 10000 });
  await expect(dlg.getByText('Priya Reddy')).toBeVisible();
  await t.screenshot({ path: SHOT + 'trainer-after-1440.png' });
  await dlg.getByRole('button', { name: 'Stop' }).click();
  await expect(dlg).toBeHidden();

  await db.from('attendance').delete().eq('candidate_id', me!.id).eq('day', today);
  await db.from('checkin_log').delete().eq('candidate_id', me!.id).gte('at', t0);
});
