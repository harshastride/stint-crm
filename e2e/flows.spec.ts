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
  await page.locator('thead').getByRole('button', { name: 'Amount', exact: true }).click();
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
  await expect(page.locator('iframe[title="Activepieces automation builder"]')).toHaveAttribute('src', /localhost:808[01]/);
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

test('next-step buttons: by stage, on follow-ups, and forms open with the person filled in', async ({ page }) => {
  const db = service();
  const { data: c } = await db.from('candidate').select('id, full_name').eq('full_name', 'Priya Reddy').single();
  await login(page, 'harsha');
  await page.goto('/p/candidate?person=candidate:' + c!.id);
  const panel = page.getByRole('complementary', { name: 'Quick panel' });
  await expect(panel.getByText(/Next steps ·/)).toBeVisible();
  await page.goto('/p/payment?new=candidate:' + c!.id);
  const editor = page.getByRole('complementary', { name: 'New payment' });
  await expect(editor.getByText(c!.full_name)).toBeVisible();
  await page.goto('/p/lead');
  await page.getByRole('button', { name: 'table' }).click();
  await page.locator('tbody tr').filter({ hasText: 'New' }).first().click();
  await expect(panel.getByRole('button', { name: 'Log call' }).first()).toBeVisible();
});

test('Records tab: admin changes which stages a role sees', async ({ page }) => {
  const db = service();
  await login(page, 'harsha');
  await page.goto('/p/roles');
  await page.getByRole('button', { name: 'Records' }).click();
  const fd = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Front desk', exact: true }) });
  await expect(fd.getByRole('button', { name: 'Enrolled', pressed: true }).first()).toBeVisible();
  await fd.getByRole('button', { name: 'Training', exact: true }).first().click();
  await expect(page.getByText(/Front desk: sees students only in Enrolled, Training/)).toBeVisible();
  const { data } = await db.from('app_role').select('sees_candidate_stages').eq('name', 'Front desk').single();
  expect(data!.sees_candidate_stages).toEqual(['Enrolled', 'Training']);
  await db.from('app_role').update({ sees_candidate_stages: ['Enrolled'] }).eq('name', 'Front desk');
});

test('a role with no follow-ups sees a clear "all caught up" message', async ({ page }) => {
  await login(page, 'divya');
  await page.goto('/p/followups');
  await expect(page.getByText('Nothing to do')).toBeVisible();
  await expect(page.getByText(/You’re all caught up/)).toBeVisible();
});

test('logo loads on the login page while signed out', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/login');
  const logo = page.locator('img[alt="Stint"]');
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
});

test('tables: tick rows, bulk reassign, export ticked, hide a column', async ({ page }) => {
  const db = service();
  await login(page, 'harsha');
  await page.goto('/p/followups');
  await page.getByRole('tab', { name: 'Open' }).click();
  const boxes = page.getByRole('checkbox', { name: /^Select (?!all)/ });
  await boxes.nth(0).click();
  await boxes.nth(1).click();
  await expect(page.getByText('2 selected')).toBeVisible();
  const ids = await page.locator('tbody tr').evaluateAll((trs) => trs.slice(0, 2).map((t) => t.textContent));
  const { data: before } = await db.from('follow_up').select('id, owner_id').eq('status', 'Open').order('due_at').limit(2);
  await page.getByRole('button', { name: 'Reassign to …' }).click();
  await page.getByRole('menuitem', { name: /^Teja/ }).click();
  await expect(page.getByText(/Reassign to Teja: 2 updated/)).toBeVisible();
  const { data: teja } = await db.from('staff').select('id').eq('email', 'teja@demo.stint.local').single();
  const { data: after } = await db.from('follow_up').select('id, owner_id').in('id', before!.map((r) => r.id));
  expect(after!.every((r) => r.owner_id === teja!.id)).toBe(true);
  for (const r of before!) await db.from('follow_up').update({ owner_id: r.owner_id }).eq('id', r.id);   // put them back
  expect(ids.length).toBe(2);
  // hide a column, and it stays hidden after reload
  await page.getByRole('button', { name: /Columns/ }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Team' }).click();
  await expect(page.locator('thead')).not.toContainText('Team');
  await page.reload();
  await expect(page.locator('thead')).not.toContainText('Team');
  await page.getByRole('button', { name: /Columns/ }).click();
  await page.getByRole('button', { name: 'Show all' }).click();
  await expect(page.locator('thead')).toContainText('Team');
});

test('tables: a role without edit rights gets no bulk actions', async ({ page }) => {
  await login(page, 'anita');
  await page.goto('/p/lead');
  await page.getByRole('button', { name: 'table' }).click();
  await page.getByRole('checkbox', { name: /^Select (?!all)/ }).first().click();
  await expect(page.getByText('1 selected')).toBeVisible();
  await expect(page.getByRole('button', { name: /Reassign to/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export 1' })).toBeVisible();
});

test('dashboard: trends, target and tiles follow the role', async ({ page }) => {
  await login(page, 'harsha');
  await expect(page.getByRole('heading', { name: 'New leads and enrolments' })).toBeVisible();
  await expect(page.getByText('This month’s target')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Target progress' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View →' }).first()).toBeVisible();
  await login(page, 'suresh');   // Finance: fees, no leads
  await expect(page.getByRole('heading', { name: 'Fees collected' })).toBeVisible();
  await expect(page.getByText('New leads this month')).toHaveCount(0);
  await login(page, 'kiran');    // Trainer: no leads, no fees, no targets
  await expect(page.getByRole('heading', { name: /New leads and enrolments|Fees collected/ })).toHaveCount(0);
  await expect(page.getByText('My follow-ups').first()).toBeVisible();
});

test('PDF: fee quote and receipt download for allowed roles only', async ({ page }) => {
  const db = service();
  const { data: q } = await db.from('fee_quote').select('id').limit(1).single();
  const { data: p } = await db.from('fee_payment').select('id').eq('status', 'Received').limit(1).single();
  const { data: due } = await db.from('fee_payment').select('id').eq('status', 'Due').limit(1).single();
  await login(page, 'harsha');
  for (const url of ['/api/pdf/quote/' + q!.id, '/api/pdf/receipt/' + p!.id]) {
    const r = await page.request.get(url);
    expect(r.status()).toBe(200);
    expect(r.headers()['content-type']).toContain('application/pdf');
    expect((await r.body()).subarray(0, 4).toString()).toBe('%PDF');
  }
  expect((await page.request.get('/api/pdf/receipt/' + due!.id)).status()).toBe(400);
  await login(page, 'kiran');   // Trainer cannot see quotes or payments
  expect((await page.request.get('/api/pdf/quote/' + q!.id)).status()).toBe(404);
  expect((await page.request.get('/api/pdf/receipt/' + p!.id)).status()).toBe(404);
});

test('calendar: month and week views, items open their record, role filtering', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/calendar');
  await expect(page.getByRole('button', { name: 'Counselling', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 })).toContainText(new Date().toLocaleDateString('en-IN', { month: 'long' }));
  await page.getByRole('button', { name: 'week', exact: true }).click();
  await expect(page.getByText(/items in this week/)).toBeVisible();
  const first = page.locator('section button').first();
  if (await first.count()) { await first.click(); await expect(page).toHaveURL(/\/p\/(counsel|mock|followups|batch)/); }
  await login(page, 'kiran');   // Trainer: no counselling legend
  await page.goto('/p/calendar');
  await expect(page.getByRole('button', { name: 'Mock interview' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Counselling', exact: true })).toHaveCount(0);
});

test('command menu: Ctrl+K finds people, pages and actions', async ({ page }) => {
  await login(page, 'harsha');
  await page.keyboard.press('Control+k');
  const dlg = page.getByRole('dialog', { name: 'Command menu' });
  await expect(dlg).toBeVisible();
  await dlg.getByRole('combobox').fill('priya');
  await expect(dlg.getByRole('option', { name: /Priya Reddy/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/person=candidate:/);
  await page.keyboard.press('Control+k');
  await dlg.getByRole('combobox').fill('record payment');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary', { name: 'New payment' })).toBeVisible();
  await login(page, 'kiran');   // Trainer: no fee actions offered
  await page.keyboard.press('Control+k');
  await dlg.getByRole('combobox').fill('payment');
  await expect(dlg.getByRole('option', { name: /Record a payment/ })).toHaveCount(0);
});

test('saved views: save, share with team, reopen, delete', async ({ page }) => {
  const db = service();
  await db.from('saved_view').delete().like('name', 'E2E view%');
  await login(page, 'teja');
  await page.goto('/p/lead');
  await page.getByRole('button', { name: 'table' }).click();
  await page.getByPlaceholder('Search this list').fill('ravi');
  await page.getByRole('button', { name: 'Save this view' }).click();
  await page.getByLabel('View name').fill('E2E view ravi');
  await page.getByLabel('Who sees it').selectOption('team');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('View “E2E view ravi” saved for your team.')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /^E2E view ravi/ }).click();
  await expect(page.getByPlaceholder('Search this list')).toHaveValue('ravi');
  await login(page, 'pooja');    // same team sees it
  await page.goto('/p/lead');
  await expect(page.getByRole('button', { name: /^E2E view ravi/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete view E2E view ravi' })).toHaveCount(0);   // only the owner deletes
  await login(page, 'manish');   // Sales: another team, does not see it
  await page.goto('/p/lead');
  await expect(page.getByRole('button', { name: /^E2E view ravi/ })).toHaveCount(0);
  await db.from('saved_view').delete().like('name', 'E2E view%');
});

test('board: drag a card to another column', async ({ page }) => {
  const db = service();
  const started = new Date().toISOString();
  const { data: q } = await db.from('fee_quote').select('id, status, lead:lead_id(full_name)').neq('status', 'Expired').limit(1).single();
  await login(page, 'harsha');
  await page.goto('/p/quote');
  await page.getByRole('tab', { name: 'All' }).click();
  await page.getByRole('button', { name: 'board' }).click();
  const name = (q!.lead as unknown as { full_name: string }).full_name;
  const card = page.locator('[draggable="true"]').filter({ hasText: name });
  await expect(card).toHaveCount(1);
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await card.dispatchEvent('dragstart', { dataTransfer: dt });
  const target = page.getByRole('region', { name: 'Expired' });
  await target.dispatchEvent('dragover', { dataTransfer: dt });
  await target.dispatchEvent('drop', { dataTransfer: dt });
  await expect(page.getByText(new RegExp(name + '.*moved to Expired'))).toBeVisible();
  await db.from('fee_quote').update({ status: q!.status }).eq('id', q!.id);
  await db.from('status_history').delete().eq('entity_id', q!.id).gte('at', started);   // leave no trace in the history
  await db.from('integration_event').delete().eq('person_name', name).gte('created_at', started);
});

test('table: click a cell to change it in place', async ({ page }) => {
  const db = service();
  const started = new Date().toISOString();
  const { data: f } = await db.from('follow_up').select('id, title, owner_id').eq('status', 'Open').order('due_at').limit(1).single();
  await login(page, 'harsha');
  await page.goto('/p/followups');
  await page.getByRole('tab', { name: 'Open' }).click();
  const row = page.locator('tbody tr').filter({ hasText: f!.title }).first();
  await row.getByRole('button', { name: /^Owner:/ }).click();
  await row.getByLabel('Owner').selectOption({ label: 'Teja' });
  await expect(page.getByText(/Owner updated/)).toBeVisible();
  const { data: teja } = await db.from('staff').select('id').eq('email', 'teja@demo.stint.local').single();
  const { data: after } = await db.from('follow_up').select('owner_id').eq('id', f!.id).single();
  expect(after!.owner_id).toBe(teja!.id);
  await db.from('follow_up').update({ owner_id: f!.owner_id }).eq('id', f!.id);
  await db.from('integration_event').delete().gte('created_at', started).eq('entity', 'lead').eq('event', 'lead.assigned');
});

test('duplicates page: admin sees it, others cannot open it', async ({ page }) => {
  await login(page, 'harsha');
  await page.goto('/p/duplicates');
  await expect(page.getByRole('heading', { name: 'Duplicates' })).toBeVisible();
  await expect(page.getByText(/No duplicates found|Keep this one/).first()).toBeVisible();
  await login(page, 'teja');
  await page.goto('/p/duplicates');
  await expect(page.getByText('This page isn’t open to your role')).toBeVisible();
});

test('@mention: suggestion, note saved, bell shows it to the colleague', async ({ page }) => {
  const db = service();
  const { data: pr } = await db.from('staff').select('id').eq('email', 'praveen@demo.stint.local').single();
  await db.from('notification').delete().eq('staff_id', pr!.id);
  const { data: c } = await db.from('candidate').select('id').eq('full_name', 'Priya Reddy').single();
  await login(page, 'harsha');
  await page.goto('/p/candidate?person=candidate:' + c!.id);
  await page.getByRole('button', { name: 'Add note' }).click();
  const box = page.getByLabel('Note', { exact: true });
  await box.pressSequentially('E2E check this @Pra');
  await page.getByRole('option', { name: /@Praveen/ }).click();
  await box.pressSequentially('please');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByText('Note saved on the timeline.')).toBeVisible();
  await login(page, 'praveen');
  await page.getByRole('button', { name: /Notifications, \d+ unread/ }).click();
  await page.getByRole('dialog', { name: 'Notifications' }).getByText(/mentioned you on Priya Reddy/).click();
  await expect(page).toHaveURL(new RegExp('person=candidate:' + c!.id));
  await db.from('note').delete().like('body', 'E2E check this%');
  await db.from('notification').delete().eq('staff_id', pr!.id);
});

test('custom fields: admin adds one, it shows in the form and the list', async ({ page }) => {
  const db = service();
  await db.from('custom_field').delete().eq('label', 'E2E Laptop issued');
  const { data: c } = await db.from('candidate').select('id, full_name, custom').eq('full_name', 'Priya Reddy').single();
  await login(page, 'harsha');
  await page.goto('/p/fields');
  await page.getByRole('button', { name: 'Add field' }).click();
  const form = page.getByRole('complementary', { name: 'New custom field' });
  await form.getByLabel('Add it to').selectOption('candidate');
  await form.getByLabel('Field name').fill('E2E Laptop issued');
  await form.getByLabel('Type').selectOption('Yes / No');
  await form.getByLabel('Show as a column in the list').selectOption('Yes');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Custom field added.')).toBeVisible();
  await page.goto('/p/candidate?edit=candidate:' + c!.id);
  await page.getByRole('button', { name: 'table' }).click().catch(() => {});
  await page.goto('/p/candidate');
  await page.getByRole('button', { name: 'table' }).click();
  await expect(page.locator('thead')).toContainText('E2E Laptop issued');
  await page.goto('/p/candidate?edit=candidate:' + c!.id);
  const ed = page.getByRole('complementary', { name: 'Candidate' });
  await ed.getByLabel('E2E Laptop issued').selectOption('Yes');
  await ed.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  const { data: after } = await db.from('candidate').select('custom').eq('id', c!.id).single();
  expect(after!.custom.e2e_laptop_issued).toBe(true);
  await db.from('candidate').update({ custom: c!.custom || {} }).eq('id', c!.id);
  await db.from('custom_field').delete().eq('label', 'E2E Laptop issued');
});

test('student portal: invite, first password, details, document upload, receipt', async ({ page }) => {
  const db = service();
  const email = `portal${Date.now()}@example.com`;
  const { data: c } = await db.from('candidate').insert({ code: 'STA-TEST-' + String(Date.now()).slice(-5), full_name: 'Portal Test', stage: 'Enrolled' }).select('id').single();
  await db.from('candidate_private').insert({ candidate_id: c!.id, contact: { email, mobile: '9' + String(Date.now()).slice(-9) } });
  await db.from('fee_plan').insert({ candidate_id: c!.id, total: 30000, plan: '2 instalments' });
  await db.from('fee_payment').insert({ candidate_id: c!.id, amount: 15000, status: 'Received', mode: 'UPI' });
  const { data: doc } = await db.from('candidate_document').insert({ candidate_id: c!.id, doc_type: 'PAN', status: 'Missing' }).select('id').single();
  let userId: string | undefined;
  try {
    await login(page, 'harsha');
    const inv = await page.request.post('/api/portal/invite', { data: { candidate_id: c!.id } });
    expect(inv.status()).toBe(200);
    const { password } = await inv.json();
    userId = (await db.from('student_account').select('user_id').eq('candidate_id', c!.id).single()).data!.user_id;
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
    await expect(page.getByText('₹15,000 still due of ₹30,000')).toBeVisible();
    // details
    await page.getByRole('tab', { name: 'My details' }).click();
    await page.getByLabel('City').fill('Mysuru');
    await page.getByRole('button', { name: 'Save my details' }).click();
    await expect(page.getByText(/Saved\. The institute can see/)).toBeVisible();
    const { data: priv } = await db.from('candidate_private').select('contact').eq('candidate_id', c!.id).single();
    expect(priv!.contact.city).toBe('Mysuru');
    // document
    await page.getByRole('tab', { name: 'Documents' }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload' }).click();
    await (await chooser).setFiles({ name: 'pan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
    await expect(page.getByText('PAN uploaded. The institute will verify it.')).toBeVisible();
    const { data: d } = await db.from('candidate_document').select('status, file_path').eq('id', doc!.id).single();
    expect(d!.status).toBe('Received');
    // receipt
    await page.getByRole('tab', { name: 'Fees' }).click();
    const href = await page.getByRole('link', { name: 'Receipt' }).getAttribute('href');
    const pdf = await page.request.get(href!);
    expect(pdf.status()).toBe(200);
    // a student cannot use the staff CRM
    await page.goto('/p/lead');
    await expect(page).toHaveURL(/\/portal/);
    if (d!.file_path) await db.storage.from('candidate-files').remove([d!.file_path]);
  } finally {
    if (userId) await db.auth.admin.deleteUser(userId);
    await db.from('candidate').delete().eq('id', c!.id);
    await db.from('integration_event').delete().eq('person_name', 'Portal Test');
  }
});
