import { expect, test } from '@playwright/test';
import { login, service } from './helpers';

const SHOT = '/private/tmp/claude-501/-Users-kanalaharshareddy-Applications-stint-crm/44af8995-f50d-49d2-96fc-b1698d4bcbd0/scratchpad/pe-portal-';

for (const [w, h] of [[390, 844], [1440, 900]]) {
  test(`student portal shows Next up first (${w}px)`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/login');
    await page.getByLabel('Email').fill('priya@demo.stint.local');
    await page.getByLabel('Password').fill('stint-demo-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/portal/, { timeout: 20000 });
    const next = page.getByRole('region', { name: 'Next up' });
    await expect(next).toBeVisible({ timeout: 20000 });
    await expect(next.locator('li, p').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `${SHOT}overview-${w}.png`, fullPage: true });
    await page.getByRole('tab', { name: 'Fees' }).click();
    await expect(page.getByTestId('fee-summary')).toBeVisible();
    await page.screenshot({ path: `${SHOT}fees-${w}.png`, fullPage: true });
  });
}

test('first login, no fee plan, rejected document with reason', async ({ page }) => {
  test.setTimeout(120_000);
  const db = service();
  const stamp = String(Date.now());
  const email = `portalnext${stamp}@example.com`;
  const { data: c } = await db.from('candidate').insert({ code: 'STA-PN-' + stamp.slice(-5), full_name: 'Portal Next', stage: 'Enrolled' }).select('id').single();
  const cid = c!.id as string;
  await db.from('candidate_private').insert({ candidate_id: cid, contact: { email, mobile: '7' + stamp.slice(-9) } });
  let userId: string | undefined;
  try {
    await login(page, 'harsha');
    const inv = await page.request.post('/api/portal/invite', { data: { candidate_id: cid } });
    expect(inv.status()).toBe(200);
    const { password } = await inv.json();
    userId = (await db.from('student_account').select('user_id').eq('candidate_id', cid).single()).data!.user_id;
    expect((await db.from('candidate_document').insert({ candidate_id: cid, doc_type: 'PAN', status: 'Rejected' })).error).not.toBeNull(); // reason required
    expect((await db.from('candidate_document').insert({ candidate_id: cid, doc_type: 'PAN', status: 'Rejected', reject_reason: 'Name is cut off' })).error).toBeNull();

    await page.context().clearCookies();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Choose your own password')).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: `${SHOT}first-login-390.png` });
    await page.getByLabel('New password').fill('Student-pass-2026');
    await page.getByLabel('Type it again').fill('Student-pass-2026');
    await page.getByRole('button', { name: 'Save and continue' }).click();

    const next = page.getByRole('region', { name: 'Next up' });
    await expect(next.getByTestId('next-doc-fix')).toContainText('Name is cut off');
    await page.screenshot({ path: `${SHOT}new-student-390.png`, fullPage: true });
    await expect(page.getByText('1 document still to upload or fix.')).toBeVisible();
    await page.getByRole('tab', { name: 'Documents' }).click();
    await expect(page.getByText(/Not accepted · Reason: Name is cut off/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Replace' })).toBeVisible();
    await page.getByRole('tab', { name: 'Fees' }).click();
    await expect(page.getByTestId('fee-summary')).toHaveCount(0);
    await expect(page.getByText('No payments yet.')).toBeVisible();
  } finally {
    if (userId) await db.auth.admin.deleteUser(userId);
    await db.from('candidate').delete().eq('id', cid);
    await db.from('integration_event').delete().eq('person_name', 'Portal Next');
  }
});
