import { expect, test } from '@playwright/test';
import { login, service } from './helpers';

const name = 'E2E Compare ' + Date.now();
let cid = '';
const paths: string[] = [];

// A tiny valid one-page PDF with a line of text.
const pdf = (text: string) => Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${30 + text.length}>>stream
BT /F1 18 Tf 20 50 Td (${text}) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`);

test.beforeAll(async () => {
  const db = service();
  const c = await db.from('candidate').insert({ full_name: name }).select('id').single();
  if (c.error) throw c.error;
  cid = c.data.id;
  for (const v of ['v1', 'v2']) {
    const path = `${cid}/resume/${crypto.randomUUID()}-resume-${v}.pdf`;
    const up = await db.storage.from('candidate-files').upload(path, pdf('Resume ' + v), { contentType: 'application/pdf' });
    if (up.error) throw up.error;
    paths.push(path);
    const r = await db.from('resume_version').insert({ candidate_id: cid, version: v, file_path: path, status: v === 'v1' ? 'Rejected' : 'Pending', reason: v === 'v1' ? 'E2E too long' : null });
    if (r.error) throw r.error;
    await new Promise((ok) => setTimeout(ok, 20));
  }
  const d = await db.from('candidate_document').insert([{ candidate_id: cid, doc_type: 'E2E Aadhaar', status: 'Missing' }]);
  if (d.error) throw d.error;
});

test.afterAll(async () => {
  const db = service();
  if (paths.length) await db.storage.from('candidate-files').remove(paths);
  if (cid) await db.from('candidate').delete().eq('id', cid);
});

test('resume editor compares two versions side by side', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/resume');
  await page.getByRole('tab', { name: 'All' }).click();
  await page.getByPlaceholder('Search this list').fill(name);
  // board view: v2 is the only card in Pending; table view: the row's edit button
  const edit = page.getByRole('button', { name: `Edit Resume v2 · ${name}` }).or(page.getByRole('button', { name: 'Edit', exact: true })).first();
  await edit.click();
  await page.getByRole('button', { name: 'Compare with another version' }).click();
  const dlg = page.getByRole('dialog', { name: 'Compare resume versions' });
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('iframe')).toHaveCount(2);
  await expect(dlg.getByText('E2E too long')).toBeVisible();
  await expect(dlg.getByText('Rejected')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
});

test('Candidate 360 documents tab shows a file tree', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/candidate/' + cid);
  await page.getByRole('group', { name: 'Candidate sections' }).getByRole('button', { name: 'Documents', exact: true }).click();
  const tree = page.getByRole('tree', { name: 'Candidate files' });
  await expect(tree.getByText('Identity & education')).toBeVisible();
  await expect(tree.getByText('Resumes')).toBeVisible();
  await expect(tree.getByText('E2E Aadhaar')).toBeVisible();
  await expect(tree.getByText('Not uploaded')).toBeVisible();
  await expect(tree.getByRole('treeitem', { name: /v1/ })).toBeVisible();
  // keyboard: collapse the first folder
  await tree.getByRole('treeitem', { name: /Identity & education/ }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(tree.getByText('E2E Aadhaar')).toHaveCount(0);
});
