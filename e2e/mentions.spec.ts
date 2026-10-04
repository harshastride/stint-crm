import { expect, test } from '@playwright/test';
import { login, service } from './helpers';

test('@mention picker: keyboard pick makes a chip, saved mention notifies only staff who can open the record', async ({ page }) => {
  const db = service();
  const { data: staff } = await db.from('staff').select('id,email').in('email', ['praveen@demo.stint.local', 'kiran@demo.stint.local']);
  const pr = staff!.find((s) => s.email.startsWith('praveen'))!.id;
  const { data: c } = await db.from('candidate').select('id').eq('full_name', 'Priya Reddy').single();
  await db.from('notification').delete().eq('staff_id', pr);
  try {
    await login(page, 'harsha');
    await page.goto('/p/candidate?person=candidate:' + c!.id);
    await page.getByRole('button', { name: 'Add note' }).click();
    const box = page.getByLabel('Note', { exact: true });
    await box.pressSequentially('E2E mention chip @Pra');
    await expect(page.getByRole('listbox', { name: 'Mention someone' })).toBeVisible();
    await box.press('Escape');
    await expect(page.getByRole('listbox', { name: 'Mention someone' })).toHaveCount(0);
    await box.pressSequentially('v');
    await expect(page.getByRole('listbox', { name: 'Mention someone' }).getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
    await box.press('ArrowDown'); await box.press('ArrowUp');
    await box.press('Enter');
    await expect(page.getByTestId('mention-chip').filter({ hasText: 'Praveen' })).toBeVisible();
    await expect(box).toHaveValue(/@Praveen /);
    await page.getByRole('button', { name: 'Save note' }).click();
    await expect(page.getByText('Note saved on the timeline.')).toBeVisible();
    const { data: note } = await db.from('note').select('mentioned').like('body', 'E2E mention chip%').single();
    expect(note!.mentioned).toContain(pr);
    const { data: n } = await db.from('notification').select('link').eq('staff_id', pr).eq('kind', 'mention');
    expect(n!.length).toBe(1);
    expect(n![0].link).toContain('candidate:' + c!.id);
  } finally {
    await db.from('note').delete().like('body', 'E2E mention chip%');
    await db.from('notification').delete().eq('staff_id', pr);
  }
});
