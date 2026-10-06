import { test, expect, type Page } from '@playwright/test';
import zlib from 'node:zlib';
import { login, service, PASSWORD } from './helpers';

test.setTimeout(90_000);
const SHOTS = '/private/tmp/claude-501/-Users-kanalaharshareddy-Applications-stint-crm/44af8995-f50d-49d2-96fc-b1698d4bcbd0/scratchpad/';

// A small real PNG (40x30, two colours) built in memory so no fixture file is needed.
function png(w = 40, h = 30) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = x < w / 2 ? 68 : 255; raw[o + 1] = x < w / 2 ? 116 : 107; raw[o + 2] = x < w / 2 ? 185 : 53; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function uploadIn(page: Page) {
  const dlg = page.getByTestId('photo-dialog');
  await expect(dlg).toBeVisible();
  await dlg.getByTestId('photo-file').setInputFiles({ name: 'face.png', mimeType: 'image/png', buffer: png() });
  await expect(dlg.getByRole('slider', { name: 'Zoom' })).toBeVisible();
  await dlg.getByRole('application').focus();
  await page.keyboard.press('+'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('r');
  await dlg.getByTestId('photo-save').click();
  await expect(dlg).toBeHidden({ timeout: 15000 });
}

test('candidate 360: admin adds, sees and removes a candidate photo (512px, re-encoded)', async ({ page }) => {
  const db = service();
  const cand = (await db.from('candidate').select('id').eq('full_name', 'Priya Reddy').single()).data!;
  await db.from('candidate').update({ photo_path: null }).eq('id', cand.id);
  await login(page, 'harsha');
  await page.goto('/candidate/' + cand.id);
  await page.getByTestId('photo-open').click();
  await uploadIn(page);
  await expect(page.getByTestId('photo-open').getByTestId('avatar-photo')).toBeVisible({ timeout: 15000 });
  const row = (await db.from('candidate').select('photo_path').eq('id', cand.id).single()).data!;
  expect(row.photo_path).toMatch(new RegExp('^candidate/' + cand.id + '/[a-z0-9]+\\.(webp|jpg)$'));
  const file = await db.storage.from('photos').download(row.photo_path!);
  const bytes = Buffer.from(await file.data!.arrayBuffer());
  const isWebp = bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  expect(isWebp || (bytes[0] === 0xff && bytes[1] === 0xd8)).toBeTruthy();
  expect(bytes.includes(Buffer.from('Exif'))).toBeFalsy();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: SHOTS + 'pe-photos-candidate-1440.png' });
  await page.getByTestId('photo-open').click();
  await page.getByTestId('photo-remove').click();
  await expect(page.getByTestId('photo-dialog')).toBeHidden();
  await expect(page.getByTestId('photo-open').getByTestId('avatar-photo')).toHaveCount(0);
  expect((await db.from('candidate').select('photo_path').eq('id', cand.id).single()).data!.photo_path).toBeNull();
});

test('account menu: staff sets "My photo" and it shows in the header', async ({ page }) => {
  const db = service();
  await db.from('staff').update({ photo_path: null }).eq('email', 'teja@demo.stint.local');
  await login(page, 'teja');
  await page.getByRole('button', { name: /^Account menu/ }).click();
  await page.getByRole('menuitem', { name: 'My photo' }).click();
  await uploadIn(page);
  await expect(page.getByRole('button', { name: /^Account menu/ }).getByTestId('avatar-photo')).toBeVisible({ timeout: 15000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /^Account menu/ }).click();
  await page.screenshot({ path: SHOTS + 'pe-photos-menu-390.png' });
  await page.getByRole('menuitem', { name: 'My photo' }).click();
  await page.getByTestId('photo-remove').click();
  await expect(page.getByRole('button', { name: /^Account menu/ }).getByTestId('avatar-photo')).toHaveCount(0);
});

test('student portal: student sets and removes own photo; telecaller has no change-photo control', async ({ page }) => {
  const db = service();
  const cand = (await db.from('candidate').select('id').eq('full_name', 'Priya Reddy').single()).data!;
  await db.from('candidate').update({ photo_path: null }).eq('id', cand.id);
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email').fill('priya@demo.stint.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/portal/, { timeout: 20000 });
  await page.getByRole('button', { name: 'Add my photo' }).click();
  await uploadIn(page);
  await expect(page.getByRole('button', { name: 'Change my photo' }).getByTestId('avatar-photo')).toBeVisible({ timeout: 15000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Change my photo' }).getByTestId('avatar-photo')).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: SHOTS + 'pe-photos-portal-390.png' });
  await page.getByRole('button', { name: 'Change my photo' }).click();
  await page.getByTestId('photo-remove').click();
  await expect(page.getByRole('button', { name: 'Add my photo' })).toBeVisible();

  await login(page, 'kiran'); // trainer: can view candidates, cannot edit them
  await page.goto('/candidate/' + cand.id);
  await expect(page.getByRole('heading', { name: 'Priya Reddy' }).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('photo-open')).toHaveCount(0);
});
