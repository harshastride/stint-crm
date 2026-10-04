import { expect, test } from '@playwright/test';
import { env, login, service } from './helpers';

const mobile = '7' + String(Date.now()).slice(-9);

test.afterAll(async () => {
  const db = service();
  await db.from('lead').delete().eq('mobile', mobile);
  await db.from('company').delete().like('name', 'E2E Co %');
  await db.from('integration_event').delete().like('person_name', 'E2E %');
});

test('admin signs in and sees the whole-CRM dashboard', async ({ page }) => {
  await login(page, 'harsha');
  await expect(page.getByText('Whole CRM at a glance')).toBeVisible();
  await expect(page.getByText('Student journey')).toBeVisible();
});

test('front desk records a walk-in enquiry and it is assigned', async ({ page }) => {
  await login(page, 'anita');
  await page.goto('/p/enquiry');
  await page.getByPlaceholder('As they say it').fill('E2E Walkin');
  await page.getByPlaceholder('10 digits').fill(mobile);
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'Python' }) }).first().selectOption({ label: 'Python' });
  await page.getByRole('button', { name: 'Save enquiry' }).click();
  await expect(page.getByText(/E2E Walkin saved as a new lead and assigned to/)).toBeVisible();
  // the same mobile again is refused
  await page.getByPlaceholder('As they say it').fill('E2E Again');
  await page.getByPlaceholder('10 digits').fill(mobile);
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'Python' }) }).first().selectOption({ label: 'Python' });
  await page.getByRole('button', { name: 'Save enquiry' }).click();
  await expect(page.getByText(/already in the CRM as E2E Walkin/)).toBeVisible();
});

test('telecaller sidebar has no fee pages', async ({ page }) => {
  await login(page, 'pooja');
  await expect(page.getByRole('link', { name: 'Leads' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Payments' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Fee plans' })).toHaveCount(0);
});

test('fee quote form splits the amount into editable instalments', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/quote');
  await page.getByRole('button', { name: 'New quote' }).click();
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'AI/ML' }) }).first().selectOption({ label: 'AI/ML' });
  await expect(page.getByText(/Adds up to ₹/)).toBeVisible();
  await page.getByRole('button', { name: 'One more instalment' }).click();
  await expect(page.getByText('4 instalments')).toBeVisible();
  await page.getByLabel('Instalment 1 amount').fill('1');
  await expect(page.getByText(/still to assign/)).toBeVisible();
  await page.getByRole('button', { name: 'Split evenly' }).click();
  await expect(page.getByText(/Adds up to ₹/)).toBeVisible();
});

test('placement form adds a new company by typing its name', async ({ page }) => {
  const name = 'E2E Co ' + Date.now();
  await login(page, 'harsha');
  await page.goto('/p/placement');
  await page.getByRole('button', { name: 'Record placement' }).click();
  await page.getByLabel('Company').fill(name);
  await page.getByRole('button', { name: `+ Add “${name}” as a new company` }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
});

test('lists can be searched and sorted', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/payment');
  await page.getByRole('tab', { name: 'All' }).click();
  await page.getByPlaceholder('Search this list').fill('rakesh');
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toContainText('Rakesh B');
  for (const t of await rows.allInnerTexts()) expect(t).toContain('Rakesh B');
  await page.getByRole('button', { name: 'Amount' }).click();
  await expect(page.locator('th[aria-sort="ascending"]')).toHaveCount(1);
});

test('alumni page lists everyone in the Alumni stage', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/alumni');
  await expect(page.locator('tbody tr').first()).toBeVisible();
  const db = service();
  const { data } = await db.from('candidate').select('full_name').eq('stage', 'Alumni');
  for (const c of data || []) await expect(page.locator('tbody')).toContainText(c.full_name);
});

test('a junior telecaller sees only their own leads', async ({ page }) => {
  await login(page, 'pooja');
  await page.goto('/p/lead');
  await page.getByRole('button', { name: 'table' }).click();
  const db = service();
  const { data: me } = await db.from('staff').select('id').eq('email', 'pooja@demo.stint.local').single();
  const { count } = await db.from('lead').select('id', { count: 'exact', head: true }).eq('owner_id', me!.id);
  await expect(page.locator('tbody tr')).toHaveCount(count || 0);
});

test('admin sees the Activepieces setup and the automation log', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/deliveries');
  await expect(page.getByRole('heading', { name: 'Activepieces setup' })).toBeVisible();
  await expect(page.getByText('/api/integrations/lead')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Failed' })).toBeVisible();
});

test('enquiry form records marketing consent', async ({ page }) => {
  const m = '4' + String(Date.now()).slice(-9);
  await login(page, 'anita');
  await page.goto('/p/enquiry');
  await page.getByPlaceholder('As they say it').fill('E2E Consent');
  await page.getByPlaceholder('10 digits').fill(m);
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'Python' }) }).first().selectOption({ label: 'Python' });
  await page.getByLabel(/agree to get course updates/).check();
  await page.getByRole('button', { name: 'Save enquiry' }).click();
  await expect(page.getByText(/E2E Consent saved as a new lead/)).toBeVisible();
  const db = service();
  const { data } = await db.from('lead').select('id, marketing_consent').eq('mobile', m).single();
  expect(data?.marketing_consent).toBe(true);
  await db.from('integration_event').delete().eq('entity_id', data!.id);
  await db.from('lead').delete().eq('id', data!.id);
});

test('record button needs the consent tick before recording', async ({ page }) => {
  await login(page, 'teja');
  await page.goto('/p/lead');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  const start = page.getByRole('button', { name: /Start recording/ });
  await expect(start).toBeDisabled();
  await page.getByLabel(/they agreed/).check();
  await expect(start).toBeEnabled();
});

test('phone layout: menu folds away and the quick panel opens as a sheet', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, 'harsha');
  await page.goto('/p/lead');
  await expect(page.getByRole('link', { name: 'Payments' })).not.toBeInViewport();
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('link', { name: 'Payments' })).toBeVisible();
  await page.getByRole('button', { name: 'Close menu' }).click();
  await page.locator('tbody tr').first().click();
  await expect(page.getByRole('complementary', { name: 'Quick panel' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('automation builder opens inside the CRM for admins only', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/builder');
  await expect(page.locator('iframe[title="Activepieces automation builder"]')).toHaveAttribute('src', /localhost:8080/);
  await login(page, 'teja');
  await expect(page.getByRole('link', { name: 'Automation builder' })).toHaveCount(0);
  await page.goto('/p/builder');
  await expect(page.getByText('This page isn’t open to your role')).toBeVisible();
});

test('change password: the window opens and the new password works', async ({ page }) => {
  const db = service();
  const email = `pw${Date.now()}@demo.stint.local`, oldPw = 'Old-pass-123456', newPw = 'New-pass-654321';
  const { data } = await db.auth.admin.createUser({ email, password: oldPw, email_confirm: true });
  await db.from('staff').insert({ id: data.user!.id, full_name: 'PW Test', email, role: 'Telecaller', level: 'Junior', status: 'Active' });
  try {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(oldPw);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: 'Change password' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change password' });
    await expect(dialog).toBeInViewport();
    await dialog.getByLabel('New password').fill(newPw);
    await dialog.getByLabel('Type it again').fill(newPw);
    await dialog.getByRole('button', { name: 'Save new password' }).click();
    await expect(dialog.getByText('Password changed')).toBeVisible();
    // the new password signs in, the old one does not
    const anon = (await import('@supabase/supabase-js')).createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    expect((await anon.auth.signInWithPassword({ email, password: newPw })).error).toBeNull();
    expect((await anon.auth.signInWithPassword({ email, password: oldPw })).error).not.toBeNull();
  } finally {
    await db.auth.admin.deleteUser(data.user!.id);
  }
});
