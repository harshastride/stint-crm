import { expect, test } from '@playwright/test';
import { login, service } from './helpers';

// Board view: counts, fold a column, keyboard move with undo, pointer drag.
test.describe.configure({ mode: 'serial' });
const db = service();
let id = ''; let from = '';

test.beforeAll(async () => {
  const { data } = await db.from('campaign').select('id, status').limit(1);
  id = data?.[0]?.id; from = data?.[0]?.status;
  expect(id, 'a demo campaign').toBeTruthy();
});
test.afterAll(async () => { if (id) await db.from('campaign').update({ status: from }).eq('id', id); });

test('board: counts, fold, keyboard move, undo, drag', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/campaign');
  await page.getByRole('button', { name: 'board', exact: false }).first().click().catch(() => {});
  const board = page.getByTestId('board');
  await expect(board).toBeVisible();
  await expect(board.getByTestId('col-count').first()).toBeVisible();

  const card = board.locator(`[data-card="${id}"]`);
  await card.focus();
  await page.keyboard.press('Space');
  await expect(page.getByText(/Picked up/)).toBeAttached();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await expect.poll(async () => (await db.from('campaign').select('status').eq('id', id).single()).data?.status).not.toBe(from);

  await page.getByRole('button', { name: /undo/i }).first().click();
  await expect.poll(async () => (await db.from('campaign').select('status').eq('id', id).single()).data?.status).toBe(from);

  // Esc cancels a keyboard pick-up
  await board.locator(`[data-card="${id}"]`).focus();
  await page.keyboard.press('Space'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Escape');
  await expect(page.getByText('Move cancelled.')).toBeAttached();

  // pointer drag to the next column
  const cols = board.locator('section[data-stage]');
  const fromCol = board.locator(`section[data-stage="${from}"]`);
  const idx = await cols.evaluateAll((els, f) => els.findIndex((e) => e.getAttribute('data-stage') === f), from);
  const target = cols.nth(idx + 1 < (await cols.count()) ? idx + 1 : idx - 1);
  const a = await board.locator(`[data-card="${id}"]`).boundingBox(); const b = await target.boundingBox();
  await page.mouse.move(a!.x + 20, a!.y + 10); await page.mouse.down();
  await page.mouse.move(a!.x + 40, a!.y + 20, { steps: 3 });
  await page.mouse.move(b!.x + 40, b!.y + 40, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await db.from('campaign').select('status').eq('id', id).single()).data?.status).not.toBe(from);

  // fold a column, then open it again
  await fromCol.getByRole('button', { name: new RegExp('^Fold ' + from) }).click();
  await expect(fromCol.getByRole('button', { name: new RegExp('^Open ' + from) })).toBeVisible();
  await fromCol.getByRole('button', { name: new RegExp('^Open ' + from) }).click();
});
