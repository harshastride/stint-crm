import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

// Each dashboard tile number must equal the count on the list it opens (same population, same rules).
const listCount = (page: Page, n: number) => page.getByText(new RegExp(`^(${n} shown|\\d+–\\d+ of ${n})`));

async function tileMatchesList(page: Page, id: string) {
  await page.goto('/');
  const tile = page.locator(`[data-tile="${id}"]`);
  await expect(tile).toBeVisible({ timeout: 20_000 });
  const n = Number((await tile.getByTestId('tile-value').innerText()).replace(/[^\d]/g, ''));
  await tile.getByTestId('tile-link').click();
  await expect(listCount(page, n)).toBeVisible({ timeout: 20_000 });
}

test('Admin: tile numbers equal the drill-through list counts', async ({ page }) => {
  await login(page, 'harsha');
  for (const id of ['fu_overdue', 'fu_today', 'alerts_open', 'leads_month', 'enrolled_month', 'leads_open', 'joining_soon']) await tileMatchesList(page, id);
});

test('Telecaller: own numbers match, no fee or enrolment tiles, needs-attention comes first', async ({ page }) => {
  await login(page, 'teja');
  await page.goto('/');
  await expect(page.locator('[data-tile="fu_overdue"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-tile="fees_overdue"]')).toHaveCount(0);
  await expect(page.locator('[data-tile="enrolled_month"]')).toHaveCount(0);
  const order = await page.locator('main section[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(order.filter((x) => x !== 'Getting started')[0]).toBe('Needs attention');
  for (const id of ['fu_today', 'leads_month', 'leads_open']) await tileMatchesList(page, id);
});

test('Dashboard does not download lead or candidate rows to count them', async ({ page }) => {
  await login(page, 'harsha');
  const bulk: string[] = [];
  page.on('request', (r) => { if (/\/rest\/v1\/(lead|lead_list|candidate|fee_payment)\?/.test(r.url())) bulk.push(r.url()); });
  await page.goto('/');
  await expect(page.locator('[data-tile="leads_month"]')).toBeVisible({ timeout: 20_000 });
  expect(bulk).toEqual([]);
});

test('Each tile explains how it is counted', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/');
  const tile = page.locator('[data-tile="fu_overdue"]');
  await tile.getByRole('button', { name: /How .* is counted/ }).click();
  await expect(tile).toContainText('India time');
});

test('Finance: overdue fees tile opens exactly the overdue payments it counts', async ({ page }) => {
  await login(page, 'suresh');
  await page.goto('/');
  const tile = page.locator('[data-tile="fees_overdue"]');
  await expect(tile).toBeVisible({ timeout: 20_000 });
  const n = Number(((await tile.innerText()).match(/(\d+) payments? marked Overdue/) || [])[1]);
  expect(n).toBeGreaterThanOrEqual(0);
  await tile.getByTestId('tile-link').click();
  await expect(listCount(page, n)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-tile="leads_month"]')).toHaveCount(0);
});
