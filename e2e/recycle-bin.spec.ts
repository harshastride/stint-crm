import { expect, test } from '@playwright/test';
import { login, service } from './helpers';

// Deleting moves a record to the Recycle bin; Admin restores it (with what was removed along with it).
test('recycle bin: delete a lead, see it in the bin, restore it', async ({ page }) => {
  const db = service();
  const name = 'Bin E2E ' + Date.now();
  const { data: lead } = await db.from('lead').insert({ full_name: name, mobile: '9' + String(Date.now()).slice(-9), stage: 'New' }).select('id').single();
  try {
    await db.from('note').insert({ lead_id: lead!.id, body: 'Note that goes with it' });
    await login(page, 'harsha');
    await page.goto('/p/lead?edit=lead:' + lead!.id);
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const bubble = page.getByRole('dialog', { name: 'Delete this lead?' });
    await expect(bubble).toContainText('Recycle bin');
    await bubble.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(async () => (await db.from('lead').select('id').eq('id', lead!.id)).data!.length).toBe(0);

    await page.goto('/p/recycle');
    await page.getByLabel('Search deleted records').fill(name);
    const row = page.locator('[data-testid=bin-row]:visible').filter({ hasText: name });   // phone list and desktop table both exist; use the one on screen
    await expect(row).toContainText('1 linked: Note');
    await row.getByRole('button', { name: 'Restore' }).click();
    await page.getByRole('dialog', { name: `Restore ${name}?` }).getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText(`Restored ${name} with 1 linked record.`)).toBeVisible();
    await expect.poll(async () => (await db.from('note').select('id').eq('lead_id', lead!.id)).data!.length).toBe(1);
  } finally {
    await db.from('lead').delete().eq('id', lead!.id);
  }
});

test('recycle bin is Admin-only', async ({ page }) => {
  await login(page, 'teja');
  await page.goto('/p/recycle');
  await expect(page.getByTestId('bin-row')).toHaveCount(0);
  await expect(page.getByText(/isn.t open to your role|not open to your role/)).toBeVisible();
});
