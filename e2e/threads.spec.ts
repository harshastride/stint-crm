import { expect, test } from '@playwright/test';
import { login, service } from './helpers';

test('discussion: harsha asks @Suresh, Suresh is notified, replies and resolves; resolved collapses to one line', async ({ browser }) => {
  const db = service();
  const { data: c } = await db.from('candidate').select('id').eq('full_name', 'Priya Reddy').single();
  const { data: su } = await db.from('staff').select('id').eq('email', 'suresh@demo.stint.local').single();
  const url = '/p/candidate?person=candidate:' + c!.id;
  await db.from('thread').delete().like('body', 'E2E fee issue%');
  await db.from('notification').delete().eq('staff_id', su!.id).ilike('title', '%discussion%');
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  try {
    await login(a, 'harsha');
    await a.goto(url);
    const box = a.getByTestId('threads').first();
    await box.getByRole('button', { name: 'Start discussion' }).click();
    const input = a.getByLabel('Discussion', { exact: true });
    await input.pressSequentially('E2E fee issue @Sur');
    await a.getByRole('listbox', { name: 'Mention someone' }).getByRole('option').first().click();
    await expect(a.getByTestId('mention-chip').filter({ hasText: 'Suresh' })).toBeVisible();
    await input.press('End');
    await input.pressSequentially('please check');
    await box.getByRole('button', { name: 'Post' }).click();
    await expect(box.getByTestId('thread').filter({ hasText: 'E2E fee issue @Suresh please check' })).toBeVisible();
    await expect(box.getByRole('button', { name: /Open discussions \(\d+\)/ })).toBeVisible();

    const { data: n } = await db.from('notification').select('link').eq('staff_id', su!.id).eq('kind', 'mention').ilike('title', '%discussion%');
    expect(n!.length).toBe(1);
    expect(n![0].link).toContain('candidate:' + c!.id);

    await login(b, 'suresh');
    await b.goto(url);
    const sb = b.getByTestId('threads').first();
    await sb.getByRole('button', { name: /Open discussions/ }).click();
    await expect(sb.getByTestId('thread-mine')).toBeVisible();
    const th = sb.getByTestId('thread').filter({ hasText: 'E2E fee issue' });
    await th.getByRole('button', { name: 'Reply' }).click();
    await b.getByLabel('Reply', { exact: true }).fill('Checked, fee is paid');
    await th.getByRole('button', { name: 'Send reply' }).click();
    await expect(th.getByText('Checked, fee is paid')).toBeVisible();
    await expect(th.getByText('Sending…')).toHaveCount(0);
    // own reply can be edited within 15 minutes
    await th.getByRole('button', { name: 'Edit', exact: true }).click();
    await th.getByLabel('Edit reply').fill('Checked, fee is fully paid');
    await th.getByRole('button', { name: 'Save' }).click();
    await expect(th.getByText('Checked, fee is fully paid')).toBeVisible();
    await expect(th.getByText(/edited/)).toBeVisible();
    await th.getByRole('button', { name: 'Resolve' }).click();
    await expect(sb.getByTestId('thread-resolved').filter({ hasText: 'Resolved by Suresh' })).toBeVisible();

    const { data: t } = await db.from('thread').select('status').like('body', 'E2E fee issue%').single();
    expect(t!.status).toBe('resolved');
  } finally {
    await db.from('thread').delete().like('body', 'E2E fee issue%');
    await db.from('notification').delete().ilike('title', '%discussion%').like('body', 'E2E fee%');
    await db.from('notification').delete().ilike('title', '%discussion%').like('body', 'Checked, fee%');
  }
});
