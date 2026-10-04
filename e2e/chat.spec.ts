import { expect, test } from '@playwright/test';
import { login, service } from './helpers';

// Quick panel Chat tab: calls and notes as bubbles, staff on the right, no raw numbers.
const db = service();

test('chat tab shows bubbles with day separators and no contact numbers', async ({ page }) => {
  const { data } = await db.from('lead').select('id, mobile').limit(1);
  const lead = data?.[0] as { id: string; mobile: string | null };
  test.skip(!lead, 'no demo lead');
  await login(page, 'teja');
  await page.goto('/p/lead?person=lead:' + lead.id);
  const qp = page.getByRole('complementary', { name: 'Quick panel' });
  await qp.getByRole('tab', { name: 'Chat', exact: true }).click();
  const chat = qp.getByTestId('chat');
  await expect(chat).toBeVisible({ timeout: 20_000 });
  const bubbles = chat.locator('[data-side]');
  if (await bubbles.count() === 0) await expect(chat).toContainText('No calls or notes yet.');
  else {
    await expect(chat.locator('h4').first()).toHaveText(/Today|Yesterday|\d{1,2} \w{3} \d{4}/i);
    await expect(chat.locator('[data-kind="call"], [data-kind="note"]').first()).toHaveAttribute('data-side', 'me');
  }
  if (lead.mobile) await expect(chat).not.toContainText(String(lead.mobile));
});
