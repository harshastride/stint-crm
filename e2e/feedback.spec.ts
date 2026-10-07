import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { env, login, PASSWORD, service } from './helpers';

const SHOT = '/private/tmp/claude-501/-Users-kanalaharshareddy-Applications-stint-crm/44af8995-f50d-49d2-96fc-b1698d4bcbd0/scratchpad/pe-feedback-';

test('student rates a mock once; admin sees the average; trainer sees the comment without the name', async ({ page }) => {
  test.setTimeout(150_000);
  const db = service();
  const tag = String(Date.now()).slice(-6), secret = 'Clear questions, more SQL please ' + tag;
  const priya = (await db.from('candidate').select('id,batch_id').eq('full_name', 'Priya Reddy').single()).data!;
  const mock = (await db.from('mock_session').select('id').eq('candidate_id', priya.id).in('status', ['Passed', 'Failed']).limit(1).single()).data!;
  await db.from('student_feedback').delete().eq('candidate_id', priya.id);
  await db.from('student_notification').delete().eq('candidate_id', priya.id).eq('kind', 'feedback');
  const peers = (await db.from('candidate').select('id').neq('id', priya.id).limit(2)).data || [];
  const extra: string[] = [];
  try {
    // 1. Priya rates her mock with the keyboard, name hidden (default)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');
    await page.getByLabel('Email').fill('priya@demo.stint.local');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    const ask = page.getByRole('region', { name: 'Rate your training' });
    await expect(ask).toBeVisible({ timeout: 20_000 });
    await expect(ask.getByRole('heading', { name: /Rate your mock interview/ })).toBeVisible();
    await ask.getByRole('radio', { name: /^1 star/ }).focus();
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    await expect(ask.getByRole('radio', { name: /^4 stars/ })).toHaveAttribute('aria-checked', 'true');
    await expect(ask.getByText('Very good')).toBeVisible();
    await ask.getByLabel(/What went well/).fill(secret);
    await expect(ask.getByLabel('Keep my name hidden from the trainer')).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: SHOT + 'portal-390.png', fullPage: true });
    await ask.getByRole('button', { name: 'Send rating' }).click();
    await expect(page.getByText(/Thank you|Thanks, saved/).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /Rate your mock interview/ })).toHaveCount(0);
    await page.screenshot({ path: SHOT + 'portal-thanks-390.png', fullPage: true });

    // 2. Rating the same mock again is refused by the database
    const st = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    await st.auth.signInWithPassword({ email: 'priya@demo.stint.local', password: PASSWORD });
    const again = await st.rpc('portal_feedback_submit', { p_subject: 'mock', p_ref: mock.id, p_rating: 1, p_comment: null, p_anonymous: false });
    expect(again.error?.message).toMatch(/already rated/);

    // two more ratings in the batch so an average is shown (3 or more)
    for (const [i, p] of peers.entries()) {
      const r = await db.from('student_feedback').insert({ candidate_id: p.id, batch_id: priya.batch_id, subject: 'module', subject_ref: '2026-W0' + (i + 1), rating: 5, created_at: new Date().toISOString() }).select('id').single();
      if (r.data) extra.push(r.data.id);
    }

    // 3. Harsha sees the average with n
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, 'harsha');
    await page.goto('/p/feedback');
    const sum = page.getByTestId('feedback-summary');
    await expect(sum).toBeVisible({ timeout: 20_000 });
    expect(extra.length).toBe(2);
    await expect(sum).toContainText('/ 5');
    await expect(page.getByTestId('feedback-comments')).toContainText('Priya Reddy');
    await page.screenshot({ path: SHOT + 'staff-1440.png', fullPage: true });

    // 4. Kiran (batch trainer) sees the comment but not who wrote it
    await login(page, 'kiran');
    await page.goto('/p/feedback');
    const list = page.getByTestId('feedback-comments');
    await expect(list).toContainText(secret, { timeout: 20_000 });
    await expect(list).toContainText('Name hidden');
    await expect(list).not.toContainText('Priya Reddy');
    await page.screenshot({ path: SHOT + 'trainer-1440.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(list).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: SHOT + 'trainer-390.png', fullPage: true });
  } finally {
    await db.from('student_feedback').delete().eq('candidate_id', priya.id);
    if (extra.length) await db.from('student_feedback').delete().in('id', extra);
    await db.from('student_notification').delete().eq('candidate_id', priya.id).eq('kind', 'feedback');
  }
});
