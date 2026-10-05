import { expect, test } from '@playwright/test';
import { login, service } from './helpers';

// Stage rules (migration 073): only allowed moves are offered, requirements show as a checklist,
// the database refuses anything else, and Admin can override with a reason.
const SHOTS = process.env.PE_SHOTS || '';
const db = service();
const tag = String(Date.now()).slice(-6);
let cid = ''; let lid = '';

test.beforeAll(async () => {
  cid = (await db.from('candidate').insert({ code: 'STA-SR-' + tag, full_name: 'Stage Rules Student ' + tag, stage: 'Enrolled' }).select('id').single()).data!.id;
  const teja = (await db.from('staff').select('id').eq('email', 'teja@demo.stint.local').single()).data;
  lid = (await db.from('lead').insert({ full_name: 'Stage Rules Lead ' + tag, mobile: '6' + String(Date.now()).slice(-9), stage: 'New', owner_id: teja?.id }).select('id').single()).data!.id;
});
test.afterAll(async () => {
  for (const x of [cid, lid]) await db.from('status_history').delete().eq('entity_id', x);
  await db.from('candidate').delete().eq('id', cid); await db.from('lead').delete().eq('id', lid);
});

test('candidate: checklist before moving, move off until met, Admin override with a reason', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'harsha');
  await page.goto('/candidate/' + cid);
  const stage = page.getByRole('region', { name: 'Candidate summary' }).getByTestId('stage-control');
  await expect(stage).toContainText('Stage: Enrolled');
  const list = stage.getByTestId('stage-checklist');
  await expect(list).toContainText('Assigned to a batch');
  await expect(list).toContainText('no fee payment has been received');
  await stage.getByRole('button', { name: 'Move to Training' }).click();
  const panel = stage.getByTestId('stage-move-panel');
  await expect(panel.getByRole('button', { name: 'Move to Training' })).toBeDisabled();
  if (SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: SHOTS + '-checklist-1440.png' }); }
  await panel.getByRole('button', { name: 'Override…' }).click();
  const go = panel.getByRole('button', { name: 'Override and move' });
  await expect(go).toBeDisabled();
  await panel.getByLabel('Override reason').fill('Batch starts Monday, paid in cash');
  await go.click();
  await expect(stage).toContainText('Stage: Training');
  await expect.poll(async () => (await db.from('candidate').select('stage').eq('id', cid).single()).data!.stage).toBe('Training');
  const h = (await db.from('status_history').select('what').eq('entity_id', cid)).data || [];
  expect(h.some((x) => x.what === 'Stage override by Admin: Batch starts Monday, paid in cash')).toBe(true);
  // only allowed next stages are offered (Training → Mocks, back to Enrolled), plus the Admin override group
  const opts = await stage.getByLabel('Move to another stage').locator('option').allTextContents();
  expect(opts).toContain('Enrolled');
  expect(opts.some((o) => /Placed \(not an allowed move\)/.test(o))).toBe(true);
});

test('lead: Not interested asks for a reason in the same save', async ({ page }) => {
  await db.from('call_log').insert({ lead_id: lid, outcome: 'Not interested' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'harsha');
  await page.goto('/p/lead?person=lead:' + lid);
  const panel = page.getByRole('complementary', { name: 'Quick panel' });
  const stage = panel.getByTestId('stage-control');
  await expect(stage).toContainText('Stage: New');
  await stage.getByLabel('Move to another stage').selectOption('Not interested');
  const ask = stage.getByTestId('stage-move-panel');
  await expect(ask).toContainText('A reason for not interested');
  const yes = ask.getByRole('button', { name: 'Yes, mark it' });
  await expect(yes).toBeDisabled();
  await ask.getByLabel('Reason not interested').selectOption('Fee too high');
  await expect(yes).toBeEnabled();
  if (SHOTS) await page.screenshot({ path: SHOTS + '-reason-1440.png' });
  await yes.click();
  await expect.poll(async () => (await db.from('lead').select('stage, lost_reason').eq('id', lid).single()).data).toEqual({ stage: 'Not interested', lost_reason: 'Fee too high' });
});

test('board: a drop on a column the rules do not allow is refused with the reason', async ({ page }) => {
  await db.from('lead').update({ stage: 'New' }).eq('id', lid); // service role: setup only
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'harsha');
  await page.goto('/p/lead');
  await page.getByRole('button', { name: /board/i }).first().click().catch(() => {});
  const board = page.getByTestId('board');
  await expect(board).toBeVisible();
  await page.getByLabel(/search/i).first().fill('Stage Rules Lead ' + tag);
  const card = board.locator(`[data-card="${lid}"]`);
  await expect(card).toBeVisible();
  await card.focus();
  await page.keyboard.press('Space');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight'); // New → Converted
  await expect(board.locator('section[data-stage="Converted"]')).toHaveAttribute('data-blocked', '');
  await page.keyboard.press('Space');
  await expect(page.getByText(/from New to Converted: that move isn’t allowed/)).toBeVisible();
  expect((await db.from('lead').select('stage').eq('id', lid).single()).data!.stage).toBe('New');
});

test('Stage rules page: Admin switches a requirement off and on; HR cannot open it', async ({ page }) => {
  for (const [w, h] of [[1440, 900], [390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await login(page, 'harsha');
    await page.goto('/p/stage_rules');
    const root = page.getByTestId('stage-rules');
    await expect(root.getByRole('checkbox', { name: 'New to Callback' })).toHaveAttribute('aria-checked', 'true');
    await root.getByRole('tab', { name: 'Candidates' }).click();
    const att = root.locator('[data-req="attendance_min"]').getByRole('switch');
    await expect(att).toHaveAttribute('aria-checked', 'false');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}-page-${w}.png`, fullPage: true });
    if (w === 390) expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
  const att = page.getByTestId('stage-rules').locator('[data-req="attendance_min"]').getByRole('switch');
  await att.click();
  await expect(att).toHaveAttribute('aria-checked', 'true');
  await att.click();
  await expect(att).toHaveAttribute('aria-checked', 'false');
  expect((await db.from('stage_requirement').select('active').eq('code', 'attendance_min').single()).data!.active).toBe(false);

  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'praveen');
  await page.goto('/p/stage_rules');
  await expect(page.getByTestId('stage-rules').getByRole('switch').first()).toHaveCount(0);
});
