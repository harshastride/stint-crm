import { expect, test } from '@playwright/test';
import { login, service } from './helpers';

// Follow-ups: round ✓ "Mark done" at the start of each row (optimistic, with Undo; only the owner or their team head),
// rows grouped into Overdue / Today / Upcoming / No date with counts, tab counts from the database, no Team column.
test.describe.configure({ mode: 'serial' });
const db = service();
const tag = 'E2E Done ' + String(Date.now()).slice(-6);

test.beforeAll(async () => {
  const { data: staff } = await db.from('staff').select('id, email').in('email', ['harsha@demo.stint.local', 'teja@demo.stint.local']);
  const id = (who: string) => staff!.find((x) => x.email.startsWith(who))!.id;
  const yesterday = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
  const later = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
  const { error } = await db.from('follow_up').insert([
    { title: tag + ' mine', owner_id: id('harsha'), owner_role: 'Admin', due_at: yesterday, status: 'Open' },
    { title: tag + ' theirs', owner_id: id('teja'), owner_role: 'Telecaller', due_at: yesterday, status: 'Open' },
    { title: tag + ' later', owner_id: id('harsha'), owner_role: 'Admin', due_at: later, status: 'Open' },
  ]);
  if (error) throw error;
});
test.afterAll(async () => { await db.from('follow_up').delete().like('title', tag + '%'); });

test('sections, tab counts and no Team column', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'harsha');
  await page.goto('/p/followups');
  // the tab's number is the database count of open follow-ups (other tests may add some meanwhile, so compare a fresh count)
  await expect(page.getByRole('tab', { name: /^Open/ })).toHaveText(/^Open\d+$/, { timeout: 20_000 });
  await expect.poll(async () => {
    const shown = Number((await page.getByRole('tab', { name: /^Open/ }).innerText()).replace(/\D/g, ''));
    const { count } = await db.from('follow_up').select('id', { count: 'exact', head: true }).eq('status', 'Open');
    return shown === count;
  }).toBe(true);
  await expect(page.locator('thead')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('thead')).not.toContainText('Team');
  await page.getByPlaceholder('Search this list').fill(tag);
  await expect(page.locator('tbody tr[data-clickable]')).toHaveCount(3, { timeout: 20_000 });
  const sections = page.getByTestId('list-section');
  await expect(sections).toHaveText([/Overdue\s*2/, /Upcoming\s*1/]);
  // Status is Open on every row: it collapses into a chip instead of a column
  await page.getByRole('tab', { name: /^Open/ }).click();
  await expect(page.locator('thead')).not.toContainText('Status');
  await expect(page.getByTestId('same-cols')).toContainText('Open');
});

test('mark done: optimistic, Undo puts it back, blocked when it is someone else’s', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'harsha');
  await page.goto('/p/followups');
  await page.getByRole('tab', { name: /^Open/ }).click();
  await page.getByPlaceholder('Search this list').fill(tag);
  await expect(page.locator('tbody tr[data-clickable]')).toHaveCount(3, { timeout: 20_000 });
  const theirs = page.getByRole('button', { name: 'Mark done: ' + tag + ' theirs' });
  // someone else's follow-up: no circle at all (no dead control)
  await expect(theirs).toHaveCount(0);

  const mine = page.getByRole('button', { name: 'Mark done: ' + tag + ' mine' });
  await mine.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Mark done: ' + tag + ' mine.')).toBeVisible();
  await expect.poll(async () => (await db.from('follow_up').select('status').eq('title', tag + ' mine').single()).data!.status).toBe('Done');
  await expect(page.locator('tbody tr[data-clickable]', { hasText: tag + ' mine' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await db.from('follow_up').select('status').eq('title', tag + ' mine').single()).data!.status).toBe('Open');
  // the other person's one was never changed
  expect((await db.from('follow_up').select('status').eq('title', tag + ' theirs').single()).data!.status).toBe('Open');
});
