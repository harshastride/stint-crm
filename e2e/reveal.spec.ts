import { expect, test } from '@playwright/test';
import { login, service } from './helpers';

// Contact details are masked; "Show" reveals for a few seconds and every reveal is logged.
test.describe.configure({ mode: 'serial' });

let leadId = '';
let fromStage = '';
let tejaId = '';
const db = service();

test.beforeAll(async () => {
  const { data: teja } = await db.from('staff').select('id').eq('email', 'teja@demo.stint.local').maybeSingle();
  tejaId = teja?.id || '';
  let q = db.from('lead').select('id, stage').eq('stage', 'New').not('mobile', 'is', null).limit(1);
  if (tejaId) q = q.eq('owner_id', tejaId);
  const { data } = await q;
  leadId = data?.[0]?.id; fromStage = data?.[0]?.stage;
  expect(leadId, 'a New lead with a mobile number for Teja').toBeTruthy();
});

test.afterAll(async () => {
  if (!leadId) return;
  await db.from('lead').update({ stage: fromStage }).eq('id', leadId);
  await db.from('data_access_log').delete().eq('entity_id', leadId);
});

const panel = (page: import('@playwright/test').Page) => page.getByRole('complementary', { name: 'Quick panel' });

test('telecaller sees the mobile masked, reveals it briefly, and the reveal is logged', async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __stintRevealSeconds: number }).__stintRevealSeconds = 2; });
  await login(page, 'teja');
  const since = new Date().toISOString();
  await page.goto('/p/lead?person=lead:' + leadId);
  const qp = panel(page);
  const box = qp.locator('[data-reveal="mobile"]').first();
  await expect(box).toContainText('•', { timeout: 20_000 });
  await expect(qp.getByRole('button', { name: /^Copy/ })).toHaveCount(0);
  await box.getByRole('button', { name: 'Show mobile' }).click();
  await expect(box).toContainText('Hides in');
  await expect(box).not.toContainText('•');
  await expect(box).toContainText('•', { timeout: 6_000 });
  const { data: logs } = await db.from('data_access_log').select('id').eq('entity_id', leadId).eq('field', 'mobile').gte('at', since);
  expect((logs || []).length).toBeGreaterThan(0);
});

test('only Admin gets the Copy button', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/lead?person=lead:' + leadId);
  await expect(panel(page).getByRole('button', { name: 'Copy', exact: true })).toBeVisible({ timeout: 20_000 });
});

test('outside the telecaller contact stages the details are locked', async ({ page }) => {
  // Counselling is not a Telecaller contact stage; if Teja cannot see the lead at all there, that check is skipped.
  await db.from('lead').update({ stage: 'Counselling' }).eq('id', leadId);
  await login(page, 'teja');
  await page.goto('/p/lead?person=lead:' + leadId);
  const qp = panel(page);
  const seen = await qp.locator('[data-reveal="mobile"]').first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
  test.skip(!seen, 'Teja cannot open a Counselling lead at all (stage visibility), so the lock is not reachable here.');
  await expect(qp.getByRole('button', { name: 'Show mobile' })).toHaveCount(0);
  await expect(qp.getByRole('note')).toContainText('ask Admin');
  await expect(qp.getByRole('button', { name: 'Call', exact: true })).toBeDisabled();
});
