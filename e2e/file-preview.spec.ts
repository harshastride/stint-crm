import { expect, test, type Page } from '@playwright/test';
import { login, service, PASSWORD } from './helpers';

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function expectPreviewClosesOnEsc(page: Page) {
  const dlg = page.getByRole('dialog').filter({ has: page.locator('#fp-title') });
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
}

test('fee quote PDF opens in a preview window on top of the page', async ({ page, context }) => {
  const db = service();
  const { data: q } = await db.from('fee_quote').select('id').limit(1).single();
  await login(page, 'harsha');
  await page.goto('/p/quote?edit=quote:' + q!.id);
  await expect(page.getByRole('button', { name: 'Fee quote PDF' })).toBeVisible({ timeout: 20000 });
  await expect(page).toHaveURL(/\/p\/quote$/);
  const url = page.url();
  await page.getByRole('button', { name: 'Fee quote PDF' }).click();
  const dlg = page.getByRole('dialog', { name: 'Fee quote PDF' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByText(/Page 1 of \d+/)).toBeVisible({ timeout: 20000 });
  await expect(dlg.locator('canvas').first()).toBeVisible();
  expect(page.url()).toBe(url);
  expect(context.pages().length).toBe(1);
  await expectPreviewClosesOnEsc(page);
  await expect(page.getByRole('button', { name: 'Fee quote PDF' })).toBeFocused();
});

test('portal: receipt and an uploaded photo preview in place', async ({ page, context }) => {
  const db = service();
  const { data: c } = await db.from('candidate').select('id').eq('full_name', 'Priya Reddy').single();
  const cid = c!.id;
  const made: string[] = [];
  let pid: string | null = null;
  let did: string | null = null;
  const path = `${cid}/doc/${crypto.randomUUID()}-photo.png`;
  try {
    const { data: paid } = await db.from('fee_payment').select('id').eq('candidate_id', cid).eq('status', 'Received').limit(1);
    if (!paid?.length) {
      const { data: p } = await db.from('fee_payment').insert({ candidate_id: cid, amount: 1000, status: 'Received', mode: 'UPI' }).select('id').single();
      pid = p!.id;
    }
    expect((await db.storage.from('candidate-files').upload(path, PNG, { contentType: 'image/png' })).error).toBeNull();
    made.push(path);
    const { data: d } = await db.from('candidate_document').insert({ candidate_id: cid, doc_type: 'Photo preview test', status: 'Received', file_path: path }).select('id').single();
    did = d!.id;

    await page.context().clearCookies();
    await page.goto('/login');
    await page.getByLabel('Email').fill('priya@demo.stint.local');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/portal/, { timeout: 20000 });
    const url = page.url();

    await page.getByRole('tab', { name: 'Fees' }).click();
    await page.getByRole('button', { name: 'Receipt' }).first().click();
    const dlg = page.getByRole('dialog', { name: /Receipt/ });
    await expect(dlg.getByText(/Page 1 of \d+/)).toBeVisible({ timeout: 20000 });
    expect(page.url()).toBe(url);
    expect(context.pages().length).toBe(1);
    await expectPreviewClosesOnEsc(page);

    await page.getByRole('tab', { name: 'My files' }).click();
    await page.getByRole('treeitem', { name: /Photo preview test/ }).click();
    const img = page.getByRole('dialog', { name: 'Photo preview test' }).locator('img');
    await expect(img).toBeVisible({ timeout: 15000 });
    expect(await img.evaluate((e: HTMLImageElement) => e.naturalWidth)).toBe(1);
    // click outside closes
    await page.mouse.click(5, 5);
    await expect(page.getByRole('dialog', { name: 'Photo preview test' })).toHaveCount(0);
    expect(context.pages().length).toBe(1);
  } finally {
    if (did) await db.from('candidate_document').delete().eq('id', did);
    if (pid) await db.from('fee_payment').delete().eq('id', pid);
    if (made.length) await db.storage.from('candidate-files').remove(made);
  }
});
