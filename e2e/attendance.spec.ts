import { test, expect } from '@playwright/test';
import { login, service } from './helpers';

const SHOTS = '/private/tmp/claude-501/-Users-kanalaharshareddy-Applications-stint-crm/44af8995-f50d-49d2-96fc-b1698d4bcbd0/scratchpad/pe-training';
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

test('trainer: my batch today, mark all present, one exception, save once; % shown', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const db = service();
  const { data: kiran } = await db.from('staff').select('id').ilike('full_name', 'Kiran%').single();
  const { data: b } = await db.from('batch').select('id,code').eq('trainer_id', kiran!.id).order('code').limit(1).single();
  await db.from('attendance').delete().eq('batch_id', b!.id).eq('day', iso(new Date()));
  await login(page, 'kiran');
  await page.goto('/p/attendance');
  await expect(page.getByLabel('Batch', { exact: true })).toHaveValue(b!.id);
  await expect(page.getByLabel('Class day')).toHaveValue(iso(new Date()));
  await page.getByRole('button', { name: 'Mark all present' }).click();
  const rows = page.getByRole('list', { name: 'Register' }).getByRole('listitem');
  const n = await rows.count();
  await rows.first().getByRole('button', { name: 'Absent' }).click();
  await page.screenshot({ path: SHOTS + '-kiran-390.png', fullPage: true });
  const save = page.getByRole('button', { name: 'Save register' });
  await save.click();
  await expect(page.getByText(`Saved ${n} marks`)).toBeVisible();
  await expect(save).toBeDisabled();
  const { data } = await db.from('attendance').select('mark').eq('batch_id', b!.id).eq('day', iso(new Date()));
  expect(data!.length).toBe(n);
  expect(data!.filter((r) => r.mark === 'A').length).toBe(1);
  await expect(rows.first()).toContainText(/% · \d+ of \d+ sessions/);
});

test('trainer: marks survive a failed save and retry', async ({ page }) => {
  const db = service();
  const { data: kiran } = await db.from('staff').select('id').ilike('full_name', 'Kiran%').single();
  const { data: b } = await db.from('batch').select('id').eq('trainer_id', kiran!.id).order('code').limit(1).single();
  await db.from('attendance').delete().eq('batch_id', b!.id).eq('day', iso(new Date()));
  await login(page, 'kiran');
  await page.goto('/p/attendance');
  await page.getByRole('button', { name: 'Mark all present' }).click();
  await page.route('**/rest/v1/attendance*', (r) => (r.request().method() === 'POST' ? r.abort() : r.continue()));
  await page.getByRole('button', { name: 'Save register' }).click();
  await expect(page.getByText(/Not saved/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Unsaved marks from earlier/)).toBeVisible();
  await page.unroute('**/rest/v1/attendance*');
  await page.getByRole('button', { name: 'Save register' }).click();
  await expect(page.getByText(/^Saved \d+ marks?/)).toBeVisible();
});

test('SME has no attendance register; desktop render for admin', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'hemanth');
  await page.goto('/p/attendance');
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('This page isn’t open to your role')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save register' })).toHaveCount(0);
  await page.screenshot({ path: SHOTS + '-hemanth-390.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'harsha');
  await page.goto('/p/attendance');
  await expect(page.getByRole('list', { name: 'Register' })).toBeVisible();
  await page.screenshot({ path: SHOTS + '-harsha-1440.png', fullPage: true });
});
