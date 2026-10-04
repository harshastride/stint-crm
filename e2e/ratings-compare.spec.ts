import { expect, test } from '@playwright/test';
import { login, service } from './helpers';

test('rating card shows on a candidate with SME feedback', async ({ page }) => {
  const db = service();
  const sme = (await db.from('staff').select('id').eq('email', 'hemanth@demo.stint.local').single()).data!;
  const c = (await db.from('candidate').insert({ code: 'STA-RT-' + String(Date.now()).slice(-6), full_name: 'Rating Test', stage: 'Training' }).select('id').single()).data!;
  try {
    await db.from('sme_feedback').insert([
      { candidate_id: c.id, sme_id: sme.id, rating: 4, verdict: 'Ready', comments: 'Clear answers on joins' },
      { candidate_id: c.id, sme_id: sme.id, rating: 5, verdict: 'Ready', comments: 'Strong project walk-through' },
    ]);
    await login(page, 'harsha');
    await page.goto('/candidate/' + c.id);
    const card = page.getByRole('region', { name: 'Rating summary' });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('4.5');
    await expect(card).toContainText('2 reviews');
    await expect(card).toContainText('Strong project walk-through');
  } finally {
    await db.from('sme_feedback').delete().eq('candidate_id', c.id);
    await db.from('candidate').delete().eq('id', c.id);
  }
});

test('compare table on counselling shows two programs side by side', async ({ page }) => {
  await login(page, 'manish');
  await page.goto('/p/counsel');
  await page.getByRole('button', { name: 'Compare programs' }).click();
  const table = page.getByRole('table', { name: 'Program comparison' });
  await expect(table).toBeVisible();
  await expect(table.locator('thead th')).toHaveCount(3);
  await expect(table).toContainText('Placement rate');
  await expect(table).toContainText('₹');
});
