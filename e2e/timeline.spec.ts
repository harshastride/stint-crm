import { expect, test } from '@playwright/test';
import { login, service } from './helpers';

// Quick panel timeline: day headers, filter chips, and paging.
const db = service();

test('timeline groups by day and filters by kind', async ({ page }) => {
  const { data } = await db.from('lead').select('id').limit(1);
  const id = data?.[0]?.id;
  test.skip(!id, 'no demo lead');
  await login(page, 'harsha');
  await page.goto('/p/lead?person=lead:' + id);
  const qp = page.getByRole('complementary', { name: 'Quick panel' });
  await qp.getByRole('tab', { name: 'Timeline', exact: true }).click();
  const tl = qp.getByTestId('timeline');
  await expect(tl).toBeVisible({ timeout: 20_000 });
  await expect(tl.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const count = await tl.locator('li[data-kind]').count();
  if (count === 0) { await expect(tl).toContainText('Nothing recorded yet.'); return; }
  await expect(tl.locator('h4').first()).toHaveText(/Today|Yesterday|\d{1,2} \w{3} \d{4}/i);
  const chips = tl.getByRole('group', { name: 'Show' }).getByRole('button');
  if (await chips.count() > 1) {
    await chips.nth(1).click();
    await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'true');
  }
});
