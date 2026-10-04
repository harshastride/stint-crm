import { expect, test } from '@playwright/test';
import { login, service } from './helpers';

test('student portal: progress, resumes, files, alerts, help', async ({ page }) => {
  test.setTimeout(120_000);
  const db = service();
  const stamp = String(Date.now());
  const email = `portalmore${stamp}@example.com`;
  const { data: c } = await db.from('candidate').insert({ code: 'STA-PM-' + stamp.slice(-5), full_name: 'Portal More', stage: 'Enrolled' }).select('id').single();
  const cid = c!.id as string;
  await db.from('candidate_private').insert({ candidate_id: cid, contact: { email, mobile: '8' + stamp.slice(-9) } });
  const files = [`${cid}/resume/${crypto.randomUUID()}-v1.pdf`, `${cid}/resume/${crypto.randomUUID()}-v2.pdf`];
  let userId: string | undefined;
  try {
    await login(page, 'harsha');
    const inv = await page.request.post('/api/portal/invite', { data: { candidate_id: cid } });
    expect(inv.status()).toBe(200);
    const { password } = await inv.json();
    userId = (await db.from('student_account').select('user_id').eq('candidate_id', cid).single()).data!.user_id;

    // seed after the invite so the notification triggers fire for this student
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    for (const f of files) expect((await db.storage.from('candidate-files').upload(f, pdf, { contentType: 'application/pdf' })).error).toBeNull();
    const { data: sme } = await db.from('staff').select('id').ilike('email', 'hemanth@%').maybeSingle();
    expect((await db.from('sme_feedback').insert({ candidate_id: cid, sme_id: sme?.id ?? null, rating: 4, verdict: 'Good', comments: 'Clear answers' })).error).toBeNull();
    expect((await db.from('resume_version').insert([
      { candidate_id: cid, version: 'v1', file_path: files[0], status: 'Rejected', reason: 'Add projects', created_at: new Date(Date.now() - 86400000).toISOString() },
      { candidate_id: cid, version: 'v2', file_path: files[1], status: 'Pending', created_at: new Date().toISOString() },
    ])).error).toBeNull();
    expect((await db.from('interview_practice').insert({ candidate_id: cid, attempt_ref: 'e2e-' + stamp, topic: 'SQL', question: 'What is a join?', overall: 78, accuracy: 80, fluency: 75, completeness: 79, wpm: 120, filler_count: 3 })).error).toBeNull();
    const { data: doc } = await db.from('candidate_document').insert({ candidate_id: cid, doc_type: 'PAN', status: 'Missing' }).select('id').single();

    await page.addInitScript(() => { (window as unknown as { __stintAlertPollMs: number }).__stintAlertPollMs = 1000; });
    await page.context().clearCookies();
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/portal/, { timeout: 20000 });
    await page.getByLabel('New password').fill('Student-pass-2026');
    await page.getByLabel('Type it again').fill('Student-pass-2026');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByRole('heading', { name: 'Hi Portal' })).toBeVisible();

    // My progress
    await page.getByRole('tab', { name: 'My progress' }).click();
    await expect(page.getByRole('link', { name: 'Practise interview' }).first()).toHaveAttribute('href', '/api/portal/coach');
    await expect(page.getByText('4.0')).toBeVisible();
    await expect(page.getByText('Latest score')).toBeVisible();
    await expect(page.getByText(/^78/).first()).toBeVisible();

    // My resumes
    await page.getByRole('tab', { name: 'My resumes' }).click();
    const list = page.getByRole('list', { name: 'Resume versions' });
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list.getByText('Reason: Add projects')).toBeVisible();
    await page.getByRole('button', { name: 'Compare two versions' }).click();
    const dlg = page.getByRole('dialog', { name: 'Compare resume versions' });
    await expect(dlg.locator('iframe')).toHaveCount(2, { timeout: 15000 });
    await dlg.getByRole('button', { name: 'Close' }).click();

    // My files
    await page.getByRole('tab', { name: 'My files' }).click();
    await expect(page.getByRole('treeitem', { name: /My documents/ })).toBeVisible();
    await expect(page.getByRole('treeitem', { name: /My resumes/ })).toBeVisible();
    await expect(page.getByRole('treeitem', { name: /PAN/ })).toContainText('Not uploaded');
    await expect(page.getByText('Use the Documents tab to upload them')).toBeVisible();

    // Alerts
    const badge = page.getByTestId('unread-badge');
    await expect(badge).toBeVisible();
    await page.getByRole('tab', { name: /Alerts/ }).click();
    const alerts = page.getByRole('list', { name: 'Alerts list' });
    await expect(alerts.getByText('Please upload: PAN')).toBeVisible();
    await expect(alerts.getByText(/Practice score saved: 78/)).toBeVisible();
    await page.getByRole('button', { name: 'Mark all as read' }).click();
    await expect(badge).toHaveCount(0);

    // a live alert pops while the student is here
    expect((await db.from('candidate_document').update({ status: 'Verified' }).eq('id', doc!.id)).error).toBeNull();
    const card = page.getByRole('status').filter({ hasText: 'Your PAN was verified' });
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByRole('tab', { name: 'My files' })).toHaveAttribute('aria-selected', 'true');

    // Help
    await page.getByRole('tab', { name: 'Help' }).click();
    await expect(page.getByText('How do I fill my details?')).toBeVisible();
    await page.getByLabel('Search help').fill('password');
    await expect(page.getByText('Why does it ask me to choose a password?')).toBeVisible();
    await expect(page.getByText('How do I fill my details?')).toHaveCount(0);
  } finally {
    await db.storage.from('candidate-files').remove(files);
    if (userId) await db.auth.admin.deleteUser(userId);
    await db.from('candidate').delete().eq('id', cid);
    await db.from('integration_event').delete().eq('person_name', 'Portal More');
  }
});
