import { expect, test } from '@playwright/test';
import { login, service } from './helpers';

test('a new notification pops up as a card and can be dismissed', async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __stintAlertPollMs: number }).__stintAlertPollMs = 2000; });
  await login(page, 'harsha');
  const db = service();
  const { data: me } = await db.from('staff').select('id').eq('email', 'harsha@demo.stint.local').single();
  await page.waitForTimeout(1500);
  const title = 'E2E alert card ' + Date.now();
  const { data: n, error } = await db.from('notification').insert({ staff_id: me!.id, kind: 'task', title, body: 'Call back today', link: '/p/lead' }).select('id').single();
  expect(error).toBeNull();
  try {
    const card = page.getByRole('status').filter({ hasText: title });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/p/lead');
    await card.getByRole('button', { name: 'Dismiss ' + title }).click();
    await expect(card).toHaveCount(0);
  } finally {
    await db.from('notification').delete().eq('id', n!.id);
  }
});

test('the Amount filter narrows the quotes table', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/quote');
  await page.getByRole('button', { name: 'table', exact: true }).click();
  const count = page.getByText(/\d+ shown/);
  await expect(count).toBeVisible({ timeout: 15_000 });
  const before = Number((await count.textContent())!.match(/(\d+) shown/)![1]);
  await page.getByRole('button', { name: /^Filter/ }).click();
  await page.getByRole('button', { name: /^Amount/ }).click();
  const upTo = page.getByLabel('Amount up to, in rupees');
  const lo = Number(await page.getByLabel('Amount from, in rupees').inputValue());
  await upTo.fill(String(lo));
  await upTo.press('Enter');
  await expect(page.getByLabel('Active filters')).toContainText('Amount: ₹');
  const after = Number((await count.textContent())!.match(/(\d+) shown/)![1]);
  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThanOrEqual(before);
  if (before > 1) expect(after).toBeLessThan(before);
  await page.getByRole('button', { name: /^Filter/ }).click();
  await page.getByRole('button', { name: 'Remove filter Amount' }).click();
  await expect(page.getByText(before + ' shown')).toBeVisible();
});
