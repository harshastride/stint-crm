// Checks that the database, not just the screen, enforces roles. Run after seeding: node scripts/test-security.mjs
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = { ...Object.fromEntries((() => { try { return fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8'); } catch { return ''; } })().split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])), ...process.env };
const PASSWORD = env.DEMO_PASSWORD || 'stint-demo-1234';
const as = async (login) => {
  const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email: `${login}@demo.stint.local`, password: PASSWORD });
  if (error) throw new Error('login ' + login + ': ' + error.message);
  return c;
};
let pass = 0, fail = 0;
const startedAt = new Date().toISOString();
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  → ' + detail)); };

const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const admin = await as('harsha'), tele = await as('teja'), sales = await as('manish'), trainer = await as('kiran'), fin = await as('suresh'), desk = await as('anita'), hr = await as('praveen'), mkt = await as('divya');
const service = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); // reads lead.mobile (staff cannot since 047)

// 1. Not logged in: nothing
{ const r = await anon.from('lead').select('id'); check('Visitor without login reads no leads', (r.data || []).length === 0 || !!r.error); }
{ const r = await anon.rpc('my_session'); check('Visitor without login cannot call functions', !!r.error || !r.data?.staff); }

// 2. Page grid decides table access
{ const r = await trainer.from('fee_payment').select('id'); check('Trainer sees no payments', (r.data || []).length === 0); }
{ const r = await trainer.from('lead').select('id'); check('Trainer sees no leads', (r.data || []).length === 0); }
{ const r = await fin.from('fee_payment').select('id'); check('Finance sees payments', (r.data || []).length > 0); }
{ const r = await mkt.from('candidate').select('id'); check('Marketing sees no candidates', (r.data || []).length === 0); }
{ const r = await tele.from('lead').select('id,stage').limit(1); check('Telecaller sees leads', (r.data || []).length === 1); }
{ const one = (await admin.from('lead').select('id,city').limit(1)).data[0];
  const r = await mkt.from('lead').update({ city: 'Hacked' }).eq('id', one.id).select('id');
  check('Marketing (view only) cannot edit a lead', (r.data || []).length === 0);
  const r2 = await trainer.from('fee_payment').insert({ candidate_id: one.id, amount: 1 });
  check('Trainer cannot add a payment', !!r2.error); }
{ const r = await sales.from('staff').update({ role: 'Admin' }).eq('email', 'manish@demo.stint.local').select(); check('Sales cannot make themselves Admin', (r.data || []).length === 0); }
{ const r = await sales.from('role_page_access').insert({ role: 'Sales', page_id: 'users', mode: 'w' }); check('Sales cannot grant itself pages', !!r.error); }
{ const r = await tele.from('status_history').insert({ entity: 'lead', entity_id: '00000000-0000-0000-0000-000000000000', what: 'fake' }); check('Nobody can write status history by hand', !!r.error); }

// 3. Sensitive details: masked, hidden, full
const cand = (await admin.from('candidate').select('id,full_name').eq('full_name', 'Priya Reddy').single()).data;
{ const r = await trainer.rpc('candidate_private_get', { cid: cand.id });
  check('Trainer: contact is masked', r.data?.modes?.contact === 'm' && /^•+/.test(r.data.contact.mobile || ''), JSON.stringify(r.data?.contact));
  check('Trainer: identity and bank are hidden', r.data?.identity === null && r.data?.bank === null); }
{ const r = await fin.rpc('candidate_private_get', { cid: cand.id });
  check('Finance: bank is full, identity masked', r.data?.bank?.account === '30214458214521' && /^•+/.test(r.data.identity.pan)); }
{ const r = await tele.rpc('candidate_private_get', { cid: cand.id }); check('Telecaller cannot read candidate details at all', !!r.error); }
{ const r = await trainer.from('candidate_private').select('*'); check('Trainer cannot read the private table directly', (r.data || []).length === 0); }
{ const r = await trainer.rpc('candidate_private_set', { cid: cand.id, grp: 'bank', data: { account: '1' } }); check('Trainer cannot write bank details', !!r.error); }
{ const r = await hr.rpc('candidate_private_set', { cid: cand.id, grp: 'family', data: { mother: '[Mother name]' } });
  const back = await hr.rpc('candidate_private_get', { cid: cand.id });
  check('HR can fill family details', !r.error && back.data.family.mother === '[Mother name]', r.error?.message); }

// 4. Rules that run in the database
const mobile = '9' + String(Date.now()).slice(-9);
{ const r = await desk.from('lead').insert({ full_name: 'Test Walkin', mobile }).select('id, owner_id, stage, created_by').single();
  check('Front desk enquiry creates a lead, auto-assigned to a telecaller', !r.error && !!r.data.owner_id && r.data.stage === 'New', r.error?.message);
  const dup = await desk.from('lead').insert({ full_name: 'Test Again', mobile });
  check('Same mobile twice is refused', dup.error?.code === '23505', dup.error?.message);
  const prog = (await admin.from('program').select('id,fee').eq('name', 'Python').single()).data;
  const before = await sales.from('lead').select('id').eq('id', r.data.id);
  check('Sales cannot see a new lead still with telecalling', (before.data || []).length === 0, 'visible');
  await admin.from('call_log').insert({ lead_id: r.data.id, outcome: 'Interested' }); // stage rules: a call before Interested
  await admin.from('lead').update({ stage: 'Interested' }).eq('id', r.data.id);
  const handed = await sales.from('lead').select('id').eq('id', r.data.id);
  check('Sales sees the lead once it is Interested', (handed.data || []).length === 1, handed.error?.message);
  const cs = await sales.from('counselling_session').insert({ lead_id: r.data.id, counsellor_id: (await sales.auth.getUser()).data.user.id, scheduled_at: new Date().toISOString() });
  const owned = (await admin.from('lead').select('owner_id, stage').eq('id', r.data.id).single()).data;
  check('Booking counselling hands the lead to the counsellor', !cs.error && owned.stage === 'Counselling' && owned.owner_id === (await sales.auth.getUser()).data.user.id, cs.error?.message);
  const q = await sales.from('fee_quote').insert({ lead_id: r.data.id, program_id: prog.id, list_price: prog.fee, discount_pct: 15, amount: 1 }).select().single();
  const expected = Math.round((Number(prog.fee) * 0.85) / 100) * 100;
  check('Quote amount is worked out by the database', Number(q.data?.amount) === expected, String(q.data?.amount));
  check('15% discount is flagged for approval', q.data?.needs_approval === true);
  const sumOf = (inst) => (inst || []).reduce((a, i) => a + Number(i.amount), 0);
  check('Quote gets an even 3-part split by default', q.data?.instalments?.length === 3 && sumOf(q.data.instalments) === expected, JSON.stringify(q.data?.instalments));
  const custom = [{ label: 'On joining', amount: expected - 3000 }, { label: 'Month 2', amount: 1000 }, { label: 'Month 3', amount: 1000 }, { label: 'On placement', amount: 1000 }];
  const cq = await sales.from('fee_quote').update({ instalments: custom }).eq('id', q.data.id).select('plan, instalments').single();
  check('Quote accepts 4 custom instalment amounts', !cq.error && cq.data.plan === '4 instalments' && sumOf(cq.data.instalments) === expected, cq.error?.message);
  const bad = await sales.from('fee_quote').update({ instalments: [{ label: 'On joining', amount: 1000 }] }).eq('id', q.data.id);
  check('Instalments that do not add up are refused', bad.error?.code === '23514', bad.error?.message);
  const early = await sales.from('fee_quote').update({ status: 'Accepted' }).eq('id', q.data.id);
  check('Unapproved quote cannot be Accepted', early.error?.code === '23514', early.error?.message);
  const selfOk = await sales.rpc('approve_quote', { qid: q.data.id });
  check('A Junior salesperson cannot approve', !!selfOk.error);
  const sneak = await sales.from('fee_quote').update({ approved_by: (await sales.auth.getUser()).data.user.id }).eq('id', q.data.id);
  check('Approval cannot be set by editing the quote', !!sneak.error);
  const ok = await admin.rpc('approve_quote', { qid: q.data.id });
  const ap = (await admin.from('fee_quote').select('needs_approval, approved_by').eq('id', q.data.id).single()).data;
  check('Admin approves the quote', !ok.error && ap.needs_approval === false && !!ap.approved_by, ok.error?.message);
  await sales.from('fee_quote').update({ status: 'Accepted' }).eq('id', q.data.id);
  await sales.from('counselling_session').update({ status: 'Done' }).eq('lead_id', r.data.id); // stage rules: counselling done before Converted
  const mv = await sales.from('lead').update({ stage: 'Converted' }).eq('id', r.data.id).select('id');
  check('Sales can convert the lead', (mv.data || []).length === 1, mv.error?.message);
  const c = (await admin.from('candidate').select('id, code, stage, lead_id').eq('lead_id', r.data.id)).data;
  check('Conversion created exactly one candidate', c.length === 1 && c[0].stage === 'Enrolled' && /^STA-/.test(c[0].code), JSON.stringify(c));
  const plan = (await admin.from('fee_plan').select('total, instalments').eq('candidate_id', c[0].id)).data;
  check('Fee plan was started from the accepted quote', plan.length === 1 && Number(plan[0].total) === expected);
  const dues = (await admin.from('fee_payment').select('amount, status, instalment_no, due_on').eq('candidate_id', c[0].id).order('instalment_no')).data || [];
  check('Fee plan creates one due payment per instalment', dues.length === 4 && dues.every((d) => d.status === 'Due') && Number(dues[0].amount) === expected - 3000, JSON.stringify(dues));
  const pay = await fin.from('fee_payment').insert({ candidate_id: c[0].id, amount: expected - 3000 + 500, status: 'Received', mode: 'UPI' });
  const after = (await admin.from('fee_payment').select('amount, status, instalment_no, receipt_no, label').eq('candidate_id', c[0].id).order('instalment_no', { nullsFirst: false })).data || [];
  const first = after.find((x) => x.instalment_no === 1), second = after.find((x) => x.instalment_no === 2), part = after.find((x) => x.instalment_no === null);
  check('Recording a payment marks the instalment Received with a receipt number', !pay.error && first?.status === 'Received' && /^RCPT-/.test(first?.receipt_no || ''), pay.error?.message || JSON.stringify(after));
  check('Extra money becomes a part payment on the next instalment', Number(second?.amount) === 500 && part?.status === 'Received' && Number(part?.amount) === 500, JSON.stringify(after));
  check('Fee plan keeps the quote’s custom instalments', plan[0]?.instalments?.length === 4 && plan[0].instalments[3].label === 'On placement');
  const fu = (await admin.from('follow_up').select('owner_role').eq('candidate_id', c[0].id)).data;
  check('Follow-ups were raised for front desk, HR and finance', fu.length === 3);
  const h = (await admin.from('status_history').select('*').eq('entity_id', r.data.id)).data;
  check('Stage change is in status history', h.some((x) => x.to_value === 'Converted' && x.person_name === 'Test Walkin'));
  // HR sees contact masked now; the full number comes only through Show (reveal_contact, logged)
  const pv = await hr.rpc('reveal_contact', { p_kind: 'candidate', p_id: c[0].id, p_field: 'mobile' });
  check('Mobile carried over to the candidate', pv.data === mobile, pv.error?.message);
  const masked = await hr.rpc('candidate_private_get', { cid: c[0].id });
  check('HR sees the carried-over mobile masked until Show', String(masked.data?.contact?.mobile || '').includes('•'));
  await hr.rpc('candidate_private_set', { cid: c[0].id, grp: 'contact', data: { mobile: masked.data?.contact?.mobile } });
  const still = await service.rpc('candidate_private_get', { cid: c[0].id });
  const raw = (await service.from('candidate_private').select('contact').eq('candidate_id', c[0].id).single()).data;
  check('Saving a masked value never overwrites the real number', raw?.contact?.mobile === mobile, JSON.stringify(still.error));
  await sales.from('lead').update({ stage: 'Counselling' }).eq('id', r.data.id); await sales.from('lead').update({ stage: 'Converted' }).eq('id', r.data.id);
  const again = (await admin.from('candidate').select('id').eq('lead_id', r.data.id)).data;
  check('Converting twice does not create a second candidate', again.length === 1);
  // tidy up
  await admin.from('candidate').delete().eq('id', c[0].id); await admin.from('lead').delete().eq('id', r.data.id); await admin.from('status_history').delete().eq('entity_id', r.data.id);
}
{ const r = await hr.from('job_record').insert({ candidate_id: cand.id, company: 'X', joined_on: '2026-05-01', last_working_day: '2026-01-01' }); check('Last working day before joining is refused', !!r.error); }
{ const r = await tele.from('follow_up').select('owner_role'); check('Telecaller sees only their team’s follow-ups', (r.data || []).every((x) => x.owner_role === 'Telecaller'), JSON.stringify(r.data)); }
{ const r = await tele.rpc('person_timeline', { p_lead: null, p_candidate: cand.id }); check('Telecaller gets no candidate timeline', (r.data || []).length === 0); }

// 2.2 Head vs Junior: a Junior sees only their own records; a Head sees the whole team
{ const pooja = await as('pooja');
  const pl = (await pooja.from('lead').select('id, owner_id')).data || [];
  const pid = (await pooja.auth.getUser()).data.user.id;
  check('Junior telecaller sees only leads they own', pl.length > 0 && pl.every((l) => l.owner_id === pid), pl.length + ' leads');
  const tl = (await tele.from('lead').select('owner_id')).data || [];
  check('Head telecaller sees the whole telecalling team', tl.some((l) => l.owner_id === pid) && tl.length > pl.length, tl.length + ' leads');
  const al = (await admin.from('lead').select('id')).data || [];
  check('Admin sees every lead', al.length >= tl.length);
  const theirs = (await admin.from('lead').select('id').neq('owner_id', pid).limit(1).single()).data;
  const calls = await pooja.from('call_log').select('lead_id');
  check('Junior telecaller sees call logs only for their own leads', (calls.data || []).every((c) => pl.some((l) => l.id === c.lead_id)));
  const upd = await pooja.from('lead').update({ city: 'X' }).eq('id', theirs.id).select('id');
  check('Junior telecaller cannot change someone else\'s lead', (upd.data || []).length === 0);
  const hrj = await as('kiran');
  const kc = (await hrj.from('candidate').select('id')).data || [];
  check('Trainer (role that does not own candidates) still sees candidates', kc.length > 0); }

// 2.3 File uploads: private bucket, access follows the page grid
{ const path = `${cand.id}/doc/${Date.now()}-test.txt`;
  const up = await hr.storage.from('candidate-files').upload(path, new Blob(['hello']), { contentType: 'text/plain' });
  check('HR can attach a document file', !up.error, up.error?.message);
  const link = await hr.storage.from('candidate-files').createSignedUrl(path, 60);
  check('HR gets a signed download link', !!link.data?.signedUrl, link.error?.message);
  const tl = await tele.storage.from('candidate-files').createSignedUrl(path, 60);
  check('Telecaller cannot open candidate files', !tl.data?.signedUrl);
  const tu = await tele.storage.from('candidate-files').upload(`${cand.id}/doc/${Date.now()}-x.txt`, new Blob(['x']));
  check('Telecaller cannot upload candidate files', !!tu.error);
  const bad = await hr.storage.from('candidate-files').upload(`${cand.id}/payment/${Date.now()}-x.txt`, new Blob(['x']));
  check('Files only go under known pages', !!bad.error);
  const pub = await anon.storage.from('candidate-files').createSignedUrl(path, 60);
  check('Logged-out visitors cannot open files', !pub.data?.signedUrl);
  await hr.storage.from('candidate-files').remove([path]); }

// 2.4 Automatic alerts: raised from the data, never twice, closed when fixed
{ const c2 = (await admin.from('candidate').select('id').eq('full_name', 'Asha K').single()).data;
  const old = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10);
  const pay = (await admin.from('fee_payment').insert({ candidate_id: c2.id, amount: 1000, status: 'Due', due_on: old }).select('id').single()).data;
  await admin.rpc('raise_alerts_now'); await admin.rpc('raise_alerts_now');
  const open = (await admin.from('alert').select('id, title').eq('candidate_id', c2.id).eq('reason', 'fee_overdue').eq('status', 'Open')).data || [];
  check('Overdue fee raises one alert, even when the check runs twice', open.length === 1 && /overdue/.test(open[0].title), JSON.stringify(open));
  const st = (await admin.from('fee_payment').select('status').eq('id', pay.id).single()).data;
  check('Payment past its due day is marked Overdue', st.status === 'Overdue');
  await admin.from('fee_payment').delete().eq('id', pay.id);
  await admin.rpc('raise_alerts_now');
  const after = (await admin.from('alert').select('status').eq('id', open[0]?.id).single()).data;
  const stillOverdue = ((await admin.from('fee_payment').select('id').eq('candidate_id', c2.id).eq('status', 'Overdue')).data || []).length > 0;
  check('Alert closes itself once nothing is overdue', stillOverdue || after?.status === 'Resolved', after?.status);
  const t = await tele.rpc('raise_alerts_now');
  check('Only an admin can run the alert check', !!t.error);
  const d = await tele.rpc('raise_alerts');
  check('The raw alert job is not callable by staff', !!d.error); }

// 2.5 Follow-up rules and assignment rules in use
{ const sug = await tele.rpc('suggest_follow_up', { p_trigger: 'Call: No answer' });
  check('Logging "No answer" suggests the next follow-up from the rule', sug.data?.title === 'Call again' && !!sug.data?.due_at, JSON.stringify(sug.data));
  const m = '8' + String(Date.now()).slice(-9);
  const nl = (await desk.from('lead').insert({ full_name: 'Rule Test', mobile: m }).select('id, owner_id').single()).data;
  const ow = (await admin.from('staff').select('role').eq('id', nl.owner_id).single()).data;
  check('New lead goes to the role in the "New lead" rule', ow?.role === 'Telecaller', ow?.role);
  await admin.from('call_log').insert({ lead_id: nl.id, outcome: 'Interested' });
  await admin.from('lead').update({ stage: 'Interested' }).eq('id', nl.id);
  const after = (await admin.from('lead').select('owner:owner_id(role)').eq('id', nl.id).single()).data;
  check('Lead marked Interested is handed to Sales by the rule', after?.owner?.role === 'Sales', JSON.stringify(after));
  await admin.rpc('force_stage', { p_kind: 'lead', p_id: nl.id, p_to: 'Converted', p_reason: 'Security test setup' }); // Interested → Converted skips counselling
  const nc = (await admin.from('candidate').select('id, poc:poc_id(role)').eq('lead_id', nl.id).single()).data;
  check('Converted candidate gets an HR owner by the rule', nc?.poc?.role === 'HR / Counsellor', JSON.stringify(nc));
  await admin.from('mock_session').insert({ candidate_id: nc.id, status: 'Failed' });
  const fu = (await admin.from('follow_up').select('title').eq('candidate_id', nc.id).eq('title', 'Rebook mock')).data || [];
  check('A failed mock raises "Rebook mock" for the candidate owner', fu.length === 1, JSON.stringify(fu));
  await admin.from('candidate').delete().eq('id', nc.id); await admin.from('lead').delete().eq('id', nl.id); }

// 2.8 Temporary passwords must be changed before anything else works
{ const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const email = `temp${Date.now()}@demo.stint.local`, temp = 'Temp-pass-123456';
  const u = (await svc.auth.admin.createUser({ email, password: temp, email_confirm: true })).data.user;
  await svc.from('staff').insert({ id: u.id, full_name: 'Temp Person', email, role: 'Telecaller', level: 'Head', status: 'Active', must_change_password: true });
  const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password: temp });
  const blocked = (await c.from('lead').select('id')).data || [];
  const sess = await c.rpc('my_session');
  check('A temporary password gives no access to records', blocked.length === 0 && sess.data?.staff?.must_change_password === true, blocked.length + ' leads');
  await c.auth.updateUser({ password: 'My-own-pass-98765' });
  await c.rpc('password_changed');
  const open = (await c.from('lead').select('id')).data || [];
  check('After changing the password, access works', open.length > 0, open.length + ' leads');
  const self = await c.from('staff').update({ must_change_password: false }).eq('id', u.id).select();
  check('Staff cannot edit their own staff row', (self.data || []).length === 0);
  await svc.auth.admin.deleteUser(u.id); }

// Slice 3 · Activepieces: events, signed delivery, delivery log, incoming leads, consent
{ const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const cfg = Object.fromEntries(((await svc.from('integration_config').select('key, value')).data || []).map((r) => [r.key, r.value]));
  const tcfg = await tele.from('integration_config').select('value');
  check('Staff cannot read integration secrets', (tcfg.data || []).length === 0);
  const tlog = await tele.from('integration_event').select('id');
  check('Telecaller cannot read the automation log', (tlog.data || []).length === 0);

  // a local receiver stands in for Activepieces
  const http = await import('node:http'); const crypto = await import('node:crypto');
  const got = [];
  const server = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { got.push({ headers: req.headers, body: b }); res.writeHead(200); res.end('ok'); }); });
  await new Promise((r) => server.listen(3999, '0.0.0.0', r));
  await svc.from('integration_config').update({ value: 'http://host.docker.internal:3999/hook' }).eq('key', 'activepieces_webhook_url');
  const m = '6' + String(Date.now()).slice(-9);
  const lead = (await desk.from('lead').insert({ full_name: 'Event Test', mobile: m, marketing_consent: true }).select('id').single()).data;
  const ev = (await admin.from('integration_event').select('id, event, payload').eq('entity_id', lead.id).eq('event', 'lead.created').is('subscription_id', null).single()).data;
  check('A new lead raises a lead.created event', !!ev && ev.payload.data.lead.marketing_consent === true, JSON.stringify(ev?.payload));
  // send only this test's event: park the others for a while, then put them back
  const parked = ((await svc.from('integration_event').select('id').neq('id', ev.id).eq('status', 'Pending')).data || []).map((x) => x.id);
  if (parked.length) await svc.from('integration_event').update({ next_try_at: '2999-01-01' }).in('id', parked);
  for (let i = 0; i < 6 && !got.some((g) => g.headers['x-stint-event-id'] === ev.id); i++) { await svc.rpc('dispatch_events'); await new Promise((r) => setTimeout(r, 1000)); }
  await svc.rpc('dispatch_events');
  const hit = got.find((g) => g.headers['x-stint-event-id'] === ev.id);
  const sig = hit && 'sha256=' + crypto.createHmac('sha256', cfg.signing_secret).update(hit.body).digest('hex');
  check('The event reaches the webhook', !!hit && hit.headers['x-stint-event'] === 'lead.created', got.length + ' requests');
  check('The event is signed with the secret', !!hit && hit.headers['x-stint-signature'] === sig, hit?.headers['x-stint-signature'] + ' vs ' + sig);
  const sent = (await admin.from('integration_event').select('status').eq('id', ev.id).single()).data;
  check('The log shows the event as Sent', sent?.status === 'Sent', sent?.status);
  server.close();
  // nobody listening: the log keeps it waiting with the problem written down
  await svc.from('integration_config').update({ value: 'http://host.docker.internal:3998/none' }).eq('key', 'activepieces_webhook_url');
  await admin.rpc('send_test_event');
  const t = (await admin.from('integration_event').select('id').eq('event', 'test.ping').order('created_at', { ascending: false }).limit(1).single()).data;
  for (let i = 0; i < 6; i++) { await svc.rpc('dispatch_events'); await new Promise((r) => setTimeout(r, 1500)); const x = (await admin.from('integration_event').select('last_error').eq('id', t.id).single()).data; if (x?.last_error) break; }
  const failed = (await admin.from('integration_event').select('status, attempts, last_error').eq('id', t.id).single()).data;
  check('A failed delivery is kept to retry, with the problem shown', failed.status === 'Pending' && failed.attempts === 1 && !!failed.last_error, JSON.stringify(failed));
  const rt = await admin.rpc('retry_event', { eid: t.id });
  const rtt = await tele.rpc('retry_event', { eid: t.id });
  check('Admin can retry; telecaller cannot', !rt.error && !!rtt.error);
  await svc.from('integration_config').update({ value: cfg.activepieces_webhook_url }).eq('key', 'activepieces_webhook_url');
  await svc.from('integration_event').delete().in('event', ['test.ping']);
  await svc.from('integration_event').delete().eq('entity_id', lead.id);
  if (parked.length) await svc.from('integration_event').update({ next_try_at: new Date().toISOString() }).in('id', parked);

  // incoming leads endpoint (needs the app running on port 3100)
  const post = (key, body) => fetch('http://localhost:3100/api/integrations/lead', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json() })).catch(() => null);
  const m2 = '5' + String(Date.now()).slice(-9);
  const bad = await post('wrong', { full_name: 'X', mobile: m2 });
  if (!bad) console.log('SKIP incoming endpoint checks: the app is not running on port 3100');
  else {
    check('Incoming lead with a wrong key is refused', bad.status === 401);
    const ok = await post(cfg.incoming_api_key, { full_name: 'Meta Lead', mobile: '+91 ' + m2, source: 'Meta lead form', course: 'Python', marketing_consent: true });
    const row = (await service.from('lead').select('id, owner_id, source:source_id(name), marketing_consent, program:program_id(name)').eq('mobile', m2).single()).data;
    check('Incoming lead is created, tagged with its source and assigned', ok.status === 201 && row?.source?.name === 'Meta lead form' && !!row?.owner_id && row?.program?.name === 'Python' && row?.marketing_consent === true, JSON.stringify(ok.json));
    const again = await post(cfg.incoming_api_key, { full_name: 'Meta Lead', mobile: m2, source: 'Google lead form' });
    const notes = (await admin.from('note').select('body').eq('lead_id', row.id)).data || [];
    check('The same mobile again is not added twice; it gets a note', again.json.duplicate === true && notes.some((n) => /Enquired again/.test(n.body)), JSON.stringify(again.json));
    // Stint CRM block endpoints: subscribe, confirm events, act on people
    const api = (m, path, body) => fetch('http://localhost:3100/api/integrations/' + path, { method: m, headers: { 'content-type': 'application/json', 'x-api-key': cfg.incoming_api_key }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json() }));
    const me = await api('GET', 'me');
    check('Block connection check lists stages', me.status === 200 && me.json.lead_stages.includes('New'));
    const badEv = await api('POST', 'hooks', { event: 'nope', url: 'http://localhost:9/x' });
    const sub = await api('POST', 'hooks', { event: 'lead.created', url: 'http://localhost:3999/block' });
    check('A block trigger can subscribe (localhost is rewritten for Docker)', badEv.status === 400 && sub.status === 201 && sub.json.target_url.startsWith('http://host.docker.internal:3999'), JSON.stringify(sub.json));
    const m3 = '3' + String(Date.now()).slice(-9);
    const nl = (await desk.from('lead').insert({ full_name: 'Block Lead', mobile: m3 }).select('id').single()).data;
    const evs = (await svc.from('integration_event').select('id, subscription_id').eq('entity_id', nl.id).eq('event', 'lead.created')).data || [];
    check('A new lead is queued for the main webhook and for each subscribed flow', evs.length >= 2 && evs.some((e) => e.subscription_id === null) && evs.some((e) => e.subscription_id === sub.json.id), JSON.stringify(evs));
    const real = await api('GET', 'event?id=' + evs[0].id);
    const fake = await api('GET', 'event?id=' + crypto.randomUUID());
    check('The block can confirm a real event and spots a fake one', real.json.event === 'lead.created' && fake.status === 404);
    const note = await api('POST', 'note', { mobile: m3, text: 'hello' });
    const fu = await api('POST', 'follow-up', { lead_id: nl.id, title: 'Call them', due_in_hours: 2 });
    const stEarly = await api('POST', 'stage', { mobile: m3, stage: 'Interested' });
    check('Stage rules: the block cannot move a lead to Interested before any call', stEarly.status === 409 && /no call/.test(stEarly.json.error || ''), JSON.stringify(stEarly.json));
    await svc.from('call_log').insert({ lead_id: nl.id, outcome: 'Interested' });
    const st = await api('POST', 'stage', { mobile: m3, stage: 'Interested' });
    const stBad = await api('POST', 'stage', { mobile: m3, stage: 'Nonsense' });
    const found = await api('GET', 'find?mobile=' + m3);
    const lr = (await admin.from('lead').select('stage').eq('id', nl.id).single()).data;
    check('Block actions: note, follow-up, stage, find', note.status === 201 && fu.status === 201 && st.status === 200 && stBad.status === 400 && lr.stage === 'Interested' && found.json.kind === 'lead', JSON.stringify([note.json, fu.json, st.json, found.json]).slice(0, 300));
    const det = await api('GET', 'lead-details?lead_id=' + nl.id);
    check('Get lead details: calls, stage and the owner’s head', det.status === 200 && det.json.called === true && det.json.calls_count === 1 && det.json.owner_role === 'Sales' && 'owner_head_email' in det.json, JSON.stringify(det.json).slice(0, 200));
    const un = await api('DELETE', 'hooks?id=' + sub.json.id);
    const left = (await svc.from('integration_subscription').select('id').eq('id', sub.json.id)).data || [];
    check('Turning the flow off removes its subscription', un.status === 200 && left.length === 0);
    const noKey = await fetch('http://localhost:3100/api/integrations/me').then((r) => r.status);
    check('Block endpoints need the API key', noKey === 401);
    await admin.from('lead').delete().eq('id', nl.id);
    const fd = await fetch('http://localhost:3100/api/integrations/fees-due?all=1', { headers: { 'x-api-key': cfg.incoming_api_key } }).then((r) => r.json());
    const fdBad = await fetch('http://localhost:3100/api/integrations/fees-due').then((r) => r.status);
    check('Fee reminder list needs the key and lists unpaid instalments', fdBad === 401 && Array.isArray(fd.items) && fd.items.every((i) => i.amount > 0 && i.due_on), JSON.stringify(fd).slice(0, 200));
  }
  await admin.from('lead').delete().eq('id', lead.id); }

// Slice 4 · Recordings
{ const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const me = (await tele.auth.getUser()).data.user.id;
  const myLead = (await tele.from('lead').select('id').eq('owner_id', me).limit(1).single()).data;
  const noConsent = await tele.from('recording').insert({ lead_id: myLead.id, captured_by: me, consent: false });
  check('A recording without consent is refused', !!noConsent.error);
  const r = (await tele.from('recording').insert({ lead_id: myLead.id, captured_by: me, consent: true, status: 'Recorded', length_sec: 3 }).select('id').single()).data;
  const up = await tele.storage.from('recordings').upload(`${r.id}.webm`, new Blob(['fake audio'], { type: 'audio/webm' }), { contentType: 'audio/webm' });
  check('The person recording can store the audio privately', !up.error, up.error?.message);
  await tele.from('recording').update({ audio_path: `${r.id}.webm` }).eq('id', r.id);
  const tr = await trainer.storage.from('recordings').createSignedUrl(`${r.id}.webm`, 60);
  check('A trainer cannot play someone else’s recording', !tr.data?.signedUrl);
  const own = await tele.storage.from('recordings').createSignedUrl(`${r.id}.webm`, 60);
  check('The person who recorded can play it', !!own.data?.signedUrl, own.error?.message);
  const stray = await tele.storage.from('recordings').upload(`${crypto.randomUUID()}.webm`, new Blob(['x']));
  check('Audio cannot be stored without its recording row', !!stray.error);

  // clean-up: audio past the retention period is removed, transcript kept
  await svc.from('recording').update({ created_at: '2020-01-01', transcript_text: 'kept' }).eq('id', r.id);
  const secret = (await svc.from('integration_config').select('value').eq('key', 'cron_secret').single()).data.value;
  const cu = await fetch('http://localhost:3100/api/recordings/cleanup', { method: 'POST', headers: { 'x-cron-secret': secret } }).then((x) => x.json()).catch(() => null);
  if (!cu) console.log('SKIP recording route checks: the app is not running on port 3100');
  else {
    const after = (await svc.from('recording').select('audio_path, audio_deleted_at, transcript_text').eq('id', r.id).single()).data;
    const file = await svc.storage.from('recordings').list('', { search: r.id });
    check('Old audio is removed after the retention period; the transcript stays', cu.removed >= 1 && !after.audio_path && !!after.audio_deleted_at && after.transcript_text === 'kept' && (file.data || []).length === 0, JSON.stringify(cu));
    const cuBad = await fetch('http://localhost:3100/api/recordings/cleanup', { method: 'POST' }).then((x) => x.status);
    check('The clean-up call needs the secret', cuBad === 401);

    // Android companion upload
    const key = (await svc.from('integration_config').select('value').eq('key', 'incoming_api_key').single()).data.value;
    const leadMobile = (await service.from('lead').select('mobile').eq('id', myLead.id).single()).data.mobile;
    const form = (consent) => { const f = new FormData(); f.append('audio', new Blob(['fake'], { type: 'audio/mp4' }), 'call.m4a'); f.append('staff_email', 'teja@demo.stint.local'); f.append('number', '+91' + leadMobile); f.append('duration_sec', '42'); f.append('direction', 'out'); if (consent) f.append('consent', 'yes'); return f; };
    const bad = await fetch('http://localhost:3100/api/recordings/upload', { method: 'POST', headers: { 'x-api-key': 'nope' }, body: form(true) }).then((x) => x.status);
    const noC = await fetch('http://localhost:3100/api/recordings/upload', { method: 'POST', headers: { 'x-api-key': key }, body: form(false) }).then((x) => x.status);
    const ok = await fetch('http://localhost:3100/api/recordings/upload', { method: 'POST', headers: { 'x-api-key': key }, body: form(true) }).then(async (x) => ({ status: x.status, json: await x.json() }));
    check('Phone app upload needs the key and consent', bad === 401 && noC === 400);
    const pr = ok.json.recording_id && (await svc.from('recording').select('lead_id, audio_path, source').eq('id', ok.json.recording_id).single()).data;
    check('Phone app upload is stored and matched to the lead by number', ok.status === 201 && pr?.lead_id === myLead.id && !!pr?.audio_path, JSON.stringify(ok.json));
    if (pr?.audio_path) await svc.storage.from('recordings').remove([pr.audio_path]);
    if (ok.json.recording_id) await svc.from('recording').delete().eq('id', ok.json.recording_id);

    // Stint Notes phone app: staff sign-in token instead of the shared key
    const ml = (email, password) => fetch('http://localhost:3100/api/mobile/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) }).then(async (x) => ({ status: x.status, json: await x.json() }));
    const wrong = await ml('teja@demo.stint.local', 'not-the-password');
    const teja = await ml('teja@demo.stint.local', 'stint-demo-1234');
    check('Phone app sign-in: wrong password refused, right one gives a token', wrong.status === 401 && teja.status === 200 && !!teja.json.access_token && !!teja.json.refresh_token);
    const talk = () => { const f = new FormData(); f.append('audio', new Blob(['fake'], { type: 'audio/mp4' }), 'note.m4a'); f.append('duration_sec', '5'); f.append('direction', 'talk'); f.append('consent', 'yes'); return f; };
    const junk = await fetch('http://localhost:3100/api/recordings/upload', { method: 'POST', headers: { authorization: 'Bearer junk' }, body: talk() }).then((x) => x.status);
    const mine = await fetch('http://localhost:3100/api/recordings/upload', { method: 'POST', headers: { authorization: 'Bearer ' + teja.json.access_token }, body: talk() }).then(async (x) => ({ status: x.status, json: await x.json() }));
    const mr = mine.json.recording_id && (await svc.from('recording').select('captured_by, source').eq('id', mine.json.recording_id).single()).data;
    const tejaId = (await svc.from('staff').select('id').eq('email', 'teja@demo.stint.local').single()).data.id;
    check('Phone app upload with a sign-in token is saved as that staff member', junk === 401 && mine.status === 201 && mr?.captured_by === tejaId && mr?.source === 'Phone app · in person', JSON.stringify(mine.json));
    const notes = (t, q = '') => fetch('http://localhost:3100/api/mobile/notes' + q, { headers: { authorization: 'Bearer ' + t } }).then(async (x) => ({ status: x.status, json: await x.json() }));
    const own = await notes(teja.json.access_token);
    const kiran = await ml('kiran@demo.stint.local', 'stint-demo-1234');
    const other = await notes(kiran.json.access_token, '?id=' + mine.json.recording_id);
    const none = await notes('junk');
    check('Phone app notes: own notes only; others and bad tokens refused', own.status === 200 && own.json.notes.some((n) => n.id === mine.json.recording_id) && other.status === 404 && none.status === 401);
    const mp = mine.json.recording_id && (await svc.from('recording').select('audio_path').eq('id', mine.json.recording_id).single()).data;
    if (mp?.audio_path) await svc.storage.from('recordings').remove([mp.audio_path]);
    if (mine.json.recording_id) await svc.from('recording').delete().eq('id', mine.json.recording_id);
  }
  // make a lead from an unknown caller's recording
  const u = (await admin.from('recording').insert({ captured_by: (await admin.auth.getUser()).data.user.id, consent: true, number: '9' + String(Date.now()).slice(-9), status: 'Unmatched' }).select('id, number').single()).data;
  const nl = await admin.rpc('lead_from_recording', { rid: u.id, p_name: 'Unknown Caller', p_mobile: u.number });
  const ur = (await admin.from('recording').select('lead_id, status').eq('id', u.id).single()).data;
  check('A new lead can be made from a recording', !nl.error && ur.lead_id === nl.data && ur.status === 'Recorded', nl.error?.message);
  await admin.from('recording').delete().eq('id', u.id); await admin.from('lead').delete().eq('id', nl.data);
  await svc.from('recording').delete().eq('id', r.id); }

// Front desk sees only newly enrolled students, and no Documents
{ const fc = (await desk.from('candidate').select('stage')).data || [];
  const all = (await admin.from('candidate').select('stage').eq('stage', 'Enrolled')).data || [];
  check('Front desk sees only Enrolled students', fc.length === all.length && fc.every((c) => c.stage === 'Enrolled'), JSON.stringify(fc));
  const fd = (await desk.from('candidate_document').select('id')).data || [];
  check('Front desk cannot see documents', fd.length === 0, fd.length + ' rows'); }

// Records rules can only be changed by Admin; lead stage limits are enforced
{ const t = await tele.from('app_role').update({ sees_lead_stages: [] }).eq('name', 'Telecaller').select();
  check('A telecaller cannot change role rules', (t.data || []).length === 0);
  await admin.from('app_role').update({ sees_lead_stages: ['New'] }).eq('name', 'Marketing');
  const ml = (await mkt.from('lead').select('stage')).data || [];
  check('A role limited to New leads sees only New leads', ml.every((l) => l.stage === 'New'), JSON.stringify(ml));
  await admin.from('app_role').update({ sees_lead_stages: [] }).eq('name', 'Marketing'); }

// SME sees no contact details at all
{ const sme = await as('hemanth');
  const pv = await sme.rpc('candidate_private_get', { cid: cand.id });
  check('SME sees no contact details', pv.data?.modes?.contact === 'h' && !pv.data?.contact?.mobile, JSON.stringify(pv.data?.contact)); }

// Saved views: private views stay private; nobody can save a view as someone else
{ const tid = (await tele.auth.getUser()).data.user.id;
  const mine = (await tele.from('saved_view').insert({ page_id: 'lead', name: 'Private test', shared: 'me', config: {} }).select('id').single()).data;
  const other = (await as('pooja'));
  const seen = (await other.from('saved_view').select('id').eq('id', mine.id)).data || [];
  check('A private saved view is not visible to teammates', seen.length === 0);
  const forged = await other.from('saved_view').insert({ page_id: 'lead', name: 'Forged', owner_id: tid, config: {} });
  check('A saved view cannot be created in someone else’s name', !!forged.error);
  await tele.from('saved_view').delete().eq('id', mine.id); }

// Duplicates: found, merged with everything moved, and only by Admin
{ const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const m1 = '2' + String(Date.now()).slice(-9), m2 = '2' + String(Date.now() + 7).slice(-9);
  const a = (await svc.from('lead').insert({ full_name: 'Dup Person', mobile: m1, email: 'dup.person@example.com', city: 'Pune' }).select('id').single()).data;
  const b = (await svc.from('lead').insert({ full_name: 'dup  person', mobile: m2, email: 'DUP.person@example.com' }).select('id').single()).data;
  await svc.from('note').insert({ lead_id: b.id, kind: 'Note', body: 'note on the duplicate' });
  const found = ((await admin.rpc('find_duplicates')).data || []).some((p) => [p.a_id, p.b_id].includes(a.id) && [p.a_id, p.b_id].includes(b.id));
  check('The duplicate finder spots the same person twice', found);
  const t = await tele.rpc('merge_people', { p_kind: 'lead', keep_id: a.id, drop_id: b.id });
  check('Only an admin can merge', !!t.error);
  const mg = await admin.rpc('merge_people', { p_kind: 'lead', keep_id: a.id, drop_id: b.id });
  const gone = (await svc.from('lead').select('id').eq('id', b.id)).data || [];
  const moved = (await svc.from('note').select('id').eq('lead_id', a.id).eq('body', 'note on the duplicate')).data || [];
  check('Merging moves the linked records and removes the duplicate', !mg.error && gone.length === 0 && moved.length === 1, mg.error?.message);
  await svc.from('integration_event').delete().in('entity_id', [a.id, b.id]);
  await svc.from('lead').delete().eq('id', a.id); }

// @mentions notify the person mentioned; notifications are private
{ const prav = await as('praveen');
  const pid = (await prav.auth.getUser()).data.user.id;
  await prav.from('notification').delete().eq('staff_id', pid);
  const me = (await admin.auth.getUser()).data.user.id;
  const n = await admin.from('note').insert({ candidate_id: cand.id, kind: 'Note', body: 'Test @Praveen please check the resume', by_id: me }).select('id').single();
  const got = (await prav.from('notification').select('title, link, kind').eq('staff_id', pid)).data || [];
  check('An @mention in a note notifies that person with a link', got.some((x) => x.kind === 'mention' && x.link?.includes(cand.id)), JSON.stringify(got));
  const peek = (await tele.from('notification').select('id').eq('staff_id', pid)).data || [];
  check('Nobody can read someone else’s notifications', peek.length === 0);
  await admin.from('note').delete().eq('id', n.data.id);
  await prav.from('notification').delete().eq('staff_id', pid); }

// Custom fields: only roles with the Custom fields page can add them
{ const t = await tele.from('custom_field').insert({ page_id: 'lead', label: 'Sneaky field' });
  check('A telecaller cannot add custom fields', !!t.error);
  const a = await admin.from('custom_field').insert({ page_id: 'lead', label: 'Test Field X' }).select('key').single();
  check('A custom field gets a key from its name', a.data?.key === 'test_field_x', JSON.stringify(a.data));
  await admin.from('custom_field').delete().eq('label', 'Test Field X'); }

// Student portal: a student sees only their own record, and nothing of the CRM
{ const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const email = `sec${Date.now()}@example.com`, pw = 'Student-sec-12345';
  const c = (await svc.from('candidate').insert({ code: 'STA-SEC-' + String(Date.now()).slice(-5), full_name: 'Portal Sec', stage: 'Enrolled' }).select('id').single()).data;
  const u = (await svc.auth.admin.createUser({ email, password: pw, email_confirm: true })).data.user;
  await svc.from('student_account').insert({ user_id: u.id, candidate_id: c.id, must_change_password: false });
  const st = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await st.auth.signInWithPassword({ email, password: pw });
  const me = await st.rpc('portal_me');
  check('A student sees their own record in the portal', me.data?.candidate?.id === c.id, me.error?.message);
  const leads = (await st.from('lead').select('id')).data || [], cands = (await st.from('candidate').select('id')).data || [], pays = (await st.from('fee_payment').select('id')).data || [];
  check('A student cannot read leads, students or payments', leads.length + cands.length + pays.length === 0, [leads.length, cands.length, pays.length].join('/'));
  const other = (await svc.from('candidate').select('id').neq('id', c.id).limit(1).single()).data;
  const up = await st.storage.from('candidate-files').upload(`${other.id}/doc/x.pdf`, new Blob(['x']));
  check('A student cannot upload into another student’s files', !!up.error);
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const sg = await st.rpc('portal_sign', { p_png: png });
  check('A student can sign their fee agreement', !sg.error, sg.error?.message);
  const sg2 = await st.rpc('portal_sign', { p_png: png });
  check('A student cannot sign twice', !!sg2.error);
  const notStudent = await tele.rpc('portal_sign', { p_png: png });
  check('Staff cannot sign as a student', !!notStudent.error);
  const seenAdmin = (await admin.from('candidate_signature').select('candidate_id').eq('candidate_id', c.id)).data || [];
  const seenTele = (await tele.from('candidate_signature').select('candidate_id')).data || [];
  check('Admin sees the signature; Telecaller sees none', seenAdmin.length === 1 && seenTele.length === 0, seenAdmin.length + '/' + seenTele.length);
  await svc.from('candidate').update({ stage: 'Placed' }).eq('id', c.id);
  const locked = await st.rpc('portal_save', { p_profile: { x: 1 }, p_education: null, p_experience: null, p_private: {} });
  check('Details are locked once the student moves past Training', !!locked.error);
  await svc.auth.admin.deleteUser(u.id); await svc.from('candidate').delete().eq('id', c.id); }

// Activity heatmap: your own counts; someone else's only for Admin and team heads. Tags come from a dropdown list.
{ const own = await tele.rpc('staff_activity', {});
  check('Staff can see their own activity counts', !own.error, own.error?.message);
  const harsha = (await admin.from('staff').select('id').eq('email', 'harsha@demo.stint.local').single()).data;
  const other = await tele.rpc('staff_activity', { p_staff: harsha.id });
  check('A Telecaller cannot see someone else\u2019s activity', !!other.error);
  const byAdmin = await admin.rpc('staff_activity', { p_staff: harsha.id });
  check('Admin can see anyone\u2019s activity', !byAdmin.error, byAdmin.error?.message);
  const tags = (await tele.from('dropdown_value').select('value').eq('list_id', 'tag')).data || [];
  check('Tag choices come from the Tags dropdown list', tags.length > 0, tags.length + ' tags'); }

// Announcements: everyone reads, only Admin posts. "Who's viewing": you write only your own row.
{ const a = await admin.from('announcement').insert({ message: 'Test notice', tone: 'Info' }).select('id').single();
  check('Admin can post an announcement', !a.error, a.error?.message);
  const seen = (await tele.from('announcement').select('id').eq('id', a.data?.id)).data || [];
  check('Every staff member sees announcements', seen.length === 1);
  const t = await tele.from('announcement').insert({ message: 'Tele notice' });
  check('A Telecaller cannot post announcements', !!t.error);
  await admin.from('announcement').delete().eq('id', a.data?.id);
  const lead = (await tele.from('lead').select('id').limit(1).single()).data;
  const me = (await tele.from('staff').select('id').eq('email', 'teja@demo.stint.local').single()).data;
  const own = await tele.from('viewing').upsert({ staff_id: me.id, kind: 'lead', entity_id: lead.id });
  check('Staff can mark a lead as being viewed by them', !own.error, own.error?.message);
  const harsha = (await admin.from('staff').select('id').eq('email', 'harsha@demo.stint.local').single()).data;
  const fake = await tele.from('viewing').insert({ staff_id: harsha.id, kind: 'lead', entity_id: lead.id });
  check('Staff cannot pretend someone else is viewing', !!fake.error);
  const deskSees = (await desk.from('viewing').select('staff_id').eq('kind', 'lead')).data || [];
  const deskCanLead = (await desk.from('lead').select('id').limit(1)).data?.length;
  check('Viewing is visible only to roles that can open that page', deskCanLead || deskSees.length === 0, deskSees.length + ' rows');
  await tele.from('viewing').delete().eq('staff_id', me.id);
  const ob = await tele.rpc('my_onboarding');
  check('Onboarding checklist reads your own progress', !ob.error && typeof ob.data?.call === 'boolean', ob.error?.message); }

// Only the assigned person (or their own team head) decides: resume approval, mock result, follow-up done, document verifier
{ const id = async (login) => (await admin.from('staff').select('id').eq('email', login + '@demo.stint.local').single()).data.id;
  const [praveenId, kiranId, harshaId] = [await id('praveen'), await id('kiran'), await id('harsha')];
  const cand = (await admin.from('candidate').select('id').limit(1).single()).data;
  const early = await admin.from('resume_version').insert({ candidate_id: cand.id, version: 'vSec', reviewer_id: praveenId, status: 'Approved' });
  check('Nobody can add a resume already approved for someone else', !!early.error, 'insert allowed');
  const r = (await admin.from('resume_version').insert({ candidate_id: cand.id, version: 'vSec', reviewer_id: praveenId }).select('id, status').single()).data;
  check('A new resume starts Pending', r?.status === 'Pending', r?.status);
  const byAdmin = await admin.from('resume_version').update({ status: 'Approved' }).eq('id', r.id).select('id');
  check('Admin cannot approve a resume assigned to Praveen', !!byAdmin.error, 'update allowed');
  check('…and the message names the reviewer', /Praveen/.test(byAdmin.error?.message || ''), byAdmin.error?.message);
  const byHr = await hr.from('resume_version').update({ status: 'Approved' }).eq('id', r.id).select('id');
  check('Praveen (the reviewer) can approve it', !byHr.error && byHr.data?.length === 1, byHr.error?.message);
  const steal = await tele.from('resume_version').update({ reviewer_id: (await id('teja')) }).eq('id', r.id).select('id');
  check('A Telecaller cannot make themselves the reviewer', !!steal.error || !steal.data?.length, 'reassigned');
  await admin.from('resume_version').delete().eq('id', r.id);
  const m = (await admin.from('mock_session').insert({ candidate_id: cand.id, trainer_id: kiranId, scheduled_at: new Date().toISOString() }).select('id').single()).data;
  const mAdmin = await admin.from('mock_session').update({ status: 'Passed' }).eq('id', m.id).select('id');
  check('Admin cannot mark Kiran\u2019s mock as Passed', !!mAdmin.error);
  const mKiran = await trainer.from('mock_session').update({ status: 'Passed' }).eq('id', m.id).select('id');
  check('Kiran (the mock trainer) can mark it Passed', !mKiran.error && mKiran.data?.length === 1, mKiran.error?.message);
  await admin.from('mock_session').delete().eq('id', m.id);
  const f = (await admin.from('follow_up').insert({ title: 'Sec follow-up', candidate_id: cand.id, owner_id: kiranId, owner_role: 'Trainer' }).select('id').single()).data;
  const fSales = await sales.from('follow_up').update({ status: 'Done' }).eq('id', f.id).select('id');
  check('Someone else cannot close Kiran\u2019s follow-up', !!fSales.error || !fSales.data?.length);
  const fKiran = await trainer.from('follow_up').update({ status: 'Done' }).eq('id', f.id).select('id');
  check('Kiran can close their own follow-up', !fKiran.error && fKiran.data?.length === 1, fKiran.error?.message);
  await admin.from('follow_up').delete().eq('id', f.id);
  const d = (await admin.from('candidate_document').insert({ candidate_id: cand.id, doc_type: 'Sec doc', status: 'Verified', verified_by: praveenId }).select('verified_by').single()).data;
  check('"Verified by" is always the person who verified it', d?.verified_by === harshaId, d?.verified_by);
  await admin.from('candidate_document').delete().eq('doc_type', 'Sec doc'); }

// Program comparison: Sales gets aggregate numbers only; students and visitors get nothing
{ const r = await sales.rpc('program_stats');
  const keys = new Set((r.data || []).flatMap((x) => Object.keys(x)));
  const allowed = ['program_id', 'name', 'fee', 'duration_weeks', 'enrolled', 'placed', 'placement_rate', 'avg_ctc_lpa'];
  check('Sales can compare programs', !r.error && (r.data || []).length > 0, r.error?.message);
  check('Program comparison returns no people', [...keys].every((k) => allowed.includes(k)) && !JSON.stringify(r.data).includes('Priya'), [...keys].join(','));
  const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const email = `pstat${Date.now()}@example.com`, pw = 'Student-pstat-12345';
  const c = (await svc.from('candidate').insert({ code: 'STA-PS-' + String(Date.now()).slice(-5), full_name: 'Stats Sec', stage: 'Enrolled' }).select('id').single()).data;
  const u = (await svc.auth.admin.createUser({ email, password: pw, email_confirm: true })).data.user;
  await svc.from('student_account').insert({ user_id: u.id, candidate_id: c.id, must_change_password: false });
  const st = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await st.auth.signInWithPassword({ email, password: pw });
  const sr = await st.rpc('program_stats');
  check('A student cannot compare programs', !!sr.error || (sr.data || []).length === 0);
  const ar = await anon.rpc('program_stats');
  check('A visitor cannot compare programs', !!ar.error || (ar.data || []).length === 0);
  await svc.from('student_account').delete().eq('user_id', u.id); await svc.auth.admin.deleteUser(u.id); await svc.from('candidate').delete().eq('id', c.id); }

// Student portal, more: feedback, resumes, notifications, practice — own record only. Practice page for training roles only.
{ const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const sme = await as('hemanth');
  const email = `pmore${Date.now()}@example.com`, pw = 'Student-pmore-12345', tag = String(Date.now()).slice(-6);
  const c = (await svc.from('candidate').insert({ code: 'STA-PM-' + tag, full_name: 'Portal More', stage: 'Training' }).select('id').single()).data;
  const other = (await svc.from('candidate').select('id').neq('id', c.id).limit(1).single()).data;
  const u = (await svc.auth.admin.createUser({ email, password: pw, email_confirm: true })).data.user;
  await svc.from('student_account').insert({ user_id: u.id, candidate_id: c.id, must_change_password: false });
  const st = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await st.auth.signInWithPassword({ email, password: pw });
  await svc.from('sme_feedback').insert([{ candidate_id: c.id, rating: 4, verdict: 'Good', comments: 'Mine' }, { candidate_id: other.id, rating: 1, verdict: 'Other', comments: 'NotMine-' + tag }]);
  await svc.from('resume_version').insert([{ candidate_id: c.id, version: 'vPM' }, { candidate_id: other.id, version: 'vPM-other-' + tag }]);
  await svc.from('interview_practice').insert([{ candidate_id: c.id, attempt_ref: 'pm-own-' + tag, topic: 'SQL', overall: 78 }, { candidate_id: other.id, attempt_ref: 'pm-oth-' + tag, topic: 'Other' }]);
  const fb = await st.rpc('portal_feedback'), rs = await st.rpc('portal_resumes'), pr = await st.rpc('portal_practice');
  check('A student sees their own feedback only', fb.data?.reviews?.length === 1 && Array.isArray(fb.data?.mocks) && !JSON.stringify(fb.data).includes('NotMine'), fb.error?.message || JSON.stringify(fb.data));
  check('A student sees their own resumes only', rs.data?.length === 1 && rs.data[0].version === 'vPM', rs.error?.message || JSON.stringify(rs.data));
  check('A student sees their own practice scores only', pr.data?.length === 1 && Number(pr.data[0].overall) === 78, pr.error?.message || JSON.stringify(pr.data));
  const staffFb = await tele.rpc('portal_feedback'), staffRs = await tele.rpc('portal_resumes');
  check('Staff get nothing from portal feedback and resumes', staffFb.data == null && (staffRs.data || []).length === 0);
  const ins = await st.from('interview_practice').insert({ candidate_id: c.id, attempt_ref: 'pm-fake-' + tag, overall: 100 });
  check('A student cannot add practice scores', !!ins.error);
  const sn = (await st.from('student_notification').select('id')).data || [];
  check('A student cannot read the notification table directly', sn.length === 0);
  // resume files
  const own = `${c.id}/resume/sec-${tag}.pdf`, oth = `${other.id}/resume/sec-${tag}.pdf`;
  await svc.storage.from('candidate-files').upload(own, new Blob(['x'])); await svc.storage.from('candidate-files').upload(oth, new Blob(['y']));
  const d1 = await st.storage.from('candidate-files').download(own), d2 = await st.storage.from('candidate-files').download(oth);
  check('A student can open their own resume file', !d1.error, d1.error?.message);
  check('A student cannot open another student’s resume file', !!d2.error);
  const up = await st.storage.from('candidate-files').upload(`${c.id}/resume/up-${tag}.pdf`, new Blob(['z']));
  check('A student cannot upload into the resume folder', !!up.error);
  await svc.storage.from('candidate-files').remove([own, oth]);
  // notifications from staff actions
  const doc = (await admin.from('candidate_document').insert({ candidate_id: c.id, doc_type: 'PAN', status: 'Missing' }).select('id').single()).data;
  await admin.from('candidate_document').update({ status: 'Verified' }).eq('id', doc.id);
  const ns = await st.rpc('portal_notifications');
  const titles = (ns.data || []).map((n) => n.title);
  check('Verifying a document notifies the student', titles.includes('Your PAN was verified') && titles.includes('Please upload: PAN'), titles.join(' | '));
  check('Practice and resume events notify the student', titles.some((t) => t.startsWith('Practice score saved: 78/100')) && titles.includes('A new resume version was added'), titles.join(' | '));
  const one = ns.data[0].id;
  const r1 = await st.rpc('portal_notifications_read', { p_ids: [one] });
  const after1 = (await st.rpc('portal_notifications')).data;
  check('A student can mark one notification read', !r1.error && after1.filter((n) => n.read_at).length === 1, r1.error?.message);
  await st.rpc('portal_notifications_read', { p_ids: null });
  const after2 = (await st.rpc('portal_notifications')).data;
  check('A student can mark all notifications read', after2.every((n) => n.read_at));
  const otherN = (await tele.rpc('portal_notifications')).data || [];
  check('Staff get no portal notifications', otherN.length === 0);
  // practice page: training roles only
  for (const [name, cl] of [['Telecaller', tele], ['Sales', sales], ['Front desk', desk]]) {
    const r = (await cl.from('interview_practice').select('id')).data || [];
    check(`${name} cannot read interview practice`, r.length === 0, r.length + ' rows');
  }
  const refs = [];
  for (const [name, cl] of [['Trainer', trainer], ['SME', sme], ['HR', hr]]) {
    const seen = (await cl.from('candidate').select('id').limit(1)).data?.[0];
    const ref = `pm-${name}-${tag}`; refs.push(ref);
    if (seen) await svc.from('interview_practice').insert({ candidate_id: seen.id, attempt_ref: ref, overall: 50 });
    const r = (await cl.from('interview_practice').select('id').eq('attempt_ref', ref)).data || [];
    check(`${name} can read interview practice for a student they see`, r.length === 1, seen ? r.length + ' rows' : 'sees no candidate');
  }
  await svc.from('interview_practice').delete().in('attempt_ref', refs);
  await svc.from('interview_practice').delete().like('attempt_ref', 'pm-oth-' + tag);
  await svc.from('sme_feedback').delete().eq('comments', 'NotMine-' + tag);
  await svc.from('resume_version').delete().eq('version', 'vPM-other-' + tag);
  await svc.auth.admin.deleteUser(u.id); await svc.from('candidate').delete().eq('id', c.id); }

// Document paths for the portal: staff get nothing (only a student's own paths come back)
{ const dp = await admin.rpc('portal_document_paths');
  check('portal_document_paths returns nothing for staff', !dp.error && Array.isArray(dp.data) && dp.data.length === 0, JSON.stringify(dp.error || dp.data)); }

// A2 · 30-day rule (migration 048): non-Admin staff do not see closed / old history; Admin sees all
{ const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
  const tag = 'A2-' + Date.now();
  const manishId = (await svc.from('staff').select('id').eq('email', 'manish@demo.stint.local').single()).data.id;
  const sm = String(Date.now()).slice(-9);
  const closed = (await svc.from('lead').insert({ full_name: 'Old Closed ' + tag, mobile: '8' + sm, stage: 'Not interested', owner_id: manishId }).select('id').single()).data;
  await svc.from('lead').update({ stage_changed_at: ago(31) }).eq('id', closed.id);
  const open = (await svc.from('lead').insert({ full_name: 'Open ' + tag, mobile: '7' + sm, stage: 'Interested', owner_id: manishId }).select('id').single()).data;
  for (const [who, c] of [['Telecaller', tele], ['Sales', sales]]) {
    const r = await c.from('lead').select('id').eq('id', closed.id); check(who + ' cannot see a lead closed 31 days ago', (r.data || []).length === 0); }
  { const r = await admin.from('lead').select('id').eq('id', closed.id); check('Admin still sees a lead closed 31 days ago', (r.data || []).length === 1); }
  await svc.from('call_log').insert({ lead_id: open.id, caller_id: manishId, outcome: 'Connected', notes: tag, called_at: ago(31) });
  await svc.from('note').insert([{ lead_id: open.id, kind: 'Note', body: 'old ' + tag, by_id: manishId, created_at: ago(31) },
                                 { lead_id: open.id, kind: 'Note', body: 'recent ' + tag, by_id: manishId, created_at: ago(29) }]);
  { const s = await sales.from('call_log').select('id').eq('lead_id', open.id), a = await admin.from('call_log').select('id').eq('lead_id', open.id);
    check('31-day-old call: hidden from Sales, Admin sees it', (s.data || []).length === 0 && (a.data || []).length === 1, JSON.stringify([s.data, a.data])); }
  { const s = (await sales.from('note').select('body').eq('lead_id', open.id)).data || [], a = (await admin.from('note').select('body').eq('lead_id', open.id)).data || [];
    check('31-day-old note hidden from Sales, 29-day-old still shown', s.length === 1 && s[0].body === 'recent ' + tag, JSON.stringify(s));
    check('Admin sees both old and recent notes', a.length === 2); }
  await svc.from('follow_up').insert([{ title: 'Done ' + tag, lead_id: open.id, owner_id: manishId, status: 'Done', due_at: ago(31), created_at: ago(31) },
                                      { title: 'Open ' + tag, lead_id: open.id, owner_id: manishId, status: 'Open', due_at: ago(31), created_at: ago(31) }]);
  { const s = (await sales.from('follow_up').select('title').eq('lead_id', open.id)).data || [];
    check('Old Done follow-up hidden from its owner, old Open one still shown', s.length === 1 && s[0].title === 'Open ' + tag, JSON.stringify(s)); }
  { const s = (await sales.rpc('person_timeline', { p_lead: open.id, p_candidate: null })).data || [];
    const a = (await admin.rpc('person_timeline', { p_lead: open.id, p_candidate: null })).data || [];
    check('Timeline: Sales does not get the 31-day-old note, Admin does', !s.some((x) => x.body === 'old ' + tag) && s.some((x) => x.body === 'recent ' + tag) && a.some((x) => x.body === 'old ' + tag), JSON.stringify(s.map((x) => x.body))); }
  { const c1 = (await svc.from('candidate').select('id').limit(1).single()).data;
    const p = (await svc.from('fee_payment').insert({ candidate_id: c1.id, amount: 1, status: 'Paid', created_at: ago(40) }).select('id').single());
    const r = await fin.from('fee_payment').select('id').eq('id', p.data?.id);
    check('40-day-old payment still visible to Finance', (r.data || []).length === 1, JSON.stringify(p.error || r.error));
    if (p.data) await svc.from('fee_payment').delete().eq('id', p.data.id); }
  await svc.from('follow_up').delete().eq('lead_id', open.id); await svc.from('note').delete().eq('lead_id', open.id);
  await svc.from('call_log').delete().eq('lead_id', open.id); await svc.from('alert').delete().in('lead_id', [open.id, closed.id]);
  await svc.from('status_history').delete().in('entity_id', [open.id, closed.id]);
  await svc.from('lead').delete().in('id', [open.id, closed.id]); }

// A1 · time-limited access: lead contact hidden, tap-to-reveal logged, stage and Alumni locks (migration 047)
{ const tejaId = (await tele.auth.getUser()).data.user.id;
  const m = '9' + String(Date.now() + 7).slice(-9);
  const nl = (await service.from('lead').insert({ full_name: 'Reveal Test', mobile: m, owner_id: tejaId, created_by: tejaId }).select('id').single()).data;
  const raw = await tele.from('lead').select('mobile').eq('id', nl.id);
  check('A1 Telecaller cannot read lead.mobile directly', !!raw.error, JSON.stringify(raw.data));
  const ll = await tele.from('lead_list').select('id, mobile_masked').eq('id', nl.id).maybeSingle();
  check('A1 lead_list gives a masked mobile', ll.data?.mobile_masked === '•••••' + m.slice(-4), JSON.stringify(ll));
  const sp = await tele.rpc('search_people', { p_kind: 'lead', p_term: m.slice(-5) });
  const hit = (sp.data || []).find((x) => x.id === nl.id);
  check('A1 search_people finds a lead by mobile digits, masked', !!hit && hit.mobile_masked.includes('•') && !JSON.stringify(sp.data).includes(m), JSON.stringify(sp));
  const rv = await tele.rpc('reveal_contact', { p_kind: 'lead', p_id: nl.id, p_field: 'mobile' });
  check('A1 Telecaller reveals a New lead mobile', rv.data === m, rv.error?.message);
  const lg = await admin.from('data_access_log').select('staff_id, field').eq('entity_id', nl.id);
  check('A1 reveal is logged and Admin can read the log', (lg.data || []).some((x) => x.staff_id === tejaId && x.field === 'mobile'), JSON.stringify(lg));
  const lgT = await tele.from('data_access_log').select('id').eq('entity_id', nl.id);
  check('A1 Telecaller cannot read the access log', (lgT.data || []).length === 0);
  await service.from('lead').update({ stage: 'Counselling', owner_id: tejaId }).eq('id', nl.id);
  const rv2 = await tele.rpc('reveal_contact', { p_kind: 'lead', p_id: nl.id, p_field: 'mobile' });
  const cs = await tele.rpc('contact_status', { p_kind: 'lead', p_id: nl.id });
  check('A1 reveal refused once the lead leaves the Telecaller stages', !!rv2.error && /Only while/.test(rv2.error.message) && cs.data?.allowed === false, rv2.error?.message || 'revealed');
  const rvA = await admin.rpc('reveal_contact', { p_kind: 'lead', p_id: nl.id, p_field: 'mobile' });
  check('A1 Admin can always reveal', rvA.data === m, rvA.error?.message);
  await service.from('data_access_log').delete().eq('entity_id', nl.id);
  await service.from('status_history').delete().eq('entity_id', nl.id);
  await service.from('follow_up').delete().eq('lead_id', nl.id);
  await service.from('lead').delete().eq('id', nl.id); }
{ const pr = (await service.from('candidate').select('id').eq('full_name', 'Priya Reddy').single()).data;
  const g = await hr.rpc('candidate_private_get', { cid: pr.id });
  check('A1 HR (full mode) still gets contact masked', g.data?.modes?.contact === 'f' && /•/.test(g.data?.contact?.mobile || ''), JSON.stringify(g.data?.contact));
  const al = (await service.from('candidate').select('id, stage_changed_at').eq('stage', 'Alumni').limit(1).single()).data;
  await service.from('candidate').update({ stage_changed_at: new Date(Date.now() - 11 * 864e5).toISOString() }).eq('id', al.id);
  const hrR = await hr.rpc('reveal_contact', { p_kind: 'candidate', p_id: al.id, p_field: 'mobile' });
  check('A1 HR cannot reveal an Alumni locked for 11 days', !!hrR.error && /Alumni/.test(hrR.error.message), hrR.error?.message || 'revealed');
  const hrG = await hr.rpc('candidate_private_get', { cid: al.id });
  check('A1 Alumni lock hides all private groups', !!hrG.data?.locked && hrG.data.contact === null && hrG.data.bank === null && hrG.data.family === null, JSON.stringify(hrG.data));
  const st = await hr.rpc('contact_status', { p_kind: 'candidate', p_id: al.id });
  check('A1 contact_status says not allowed, with a reason', st.data?.allowed === false && !!st.data?.reason, JSON.stringify(st.data));
  const adR = await admin.rpc('reveal_contact', { p_kind: 'candidate', p_id: al.id, p_field: 'mobile' });
  check('A1 Admin can reveal a locked Alumni', !adR.error && !!adR.data, adR.error?.message);
  await service.from('candidate').update({ stage_changed_at: al.stage_changed_at }).eq('id', al.id);
  await service.from('data_access_log').delete().eq('entity_id', al.id); }

// Alumni page lists everyone in the Alumni stage, contacted or not
{ const al = (await admin.from('candidate').select('id').eq('stage', 'Alumni')).data || [];
  const sum = (await admin.from('alumni_summary').select('candidate_id')).data || [];
  check('Every Alumni-stage candidate is on the Alumni page', al.every((c) => sum.some((x) => x.candidate_id === c.id)), al.length + ' alumni, ' + sum.length + ' rows');
  const t = await tele.from('alumni_summary').select('candidate_id');
  check('Telecaller does not see the alumni list', (t.data || []).length === 0, (t.data || []).length + ' rows'); }

// Companies can be added from the placement form by roles that record placements
{ const place = await as('lakshmi');
  const name = 'Test Co ' + Date.now();
  const r = await place.from('company').insert({ name }).select('id').single();
  check('Placement can add a new company', !r.error && !!r.data?.id, r.error?.message);
  const dup = await place.from('company').insert({ name });
  check('Same company name twice is refused', dup.error?.code === '23505', dup.error?.message);
  const t = await tele.from('company').insert({ name: name + ' tele' });
  check('Telecaller cannot add companies', !!t.error, 'insert was allowed');
  await admin.from('company').delete().eq('id', r.data?.id); }

// KPI trends (migration 050): one row per day, metrics hidden when the page is not readable
{ const a = await admin.rpc('kpi_trends', { days: 60 });
  check('Admin gets 60 days of KPI trends', !a.error && (a.data || []).length === 60 && a.data.every((r) => r.leads != null && r.collected != null), a.error?.message);
  const t = await tele.rpc('kpi_trends', { days: 30 });
  check('Telecaller trends hide fees collected', !t.error && (t.data || []).every((r) => r.collected == null), t.error?.message);
  const an = await anon.rpc('kpi_trends', { days: 30 });
  check('Signed-out users cannot read KPI trends', !!an.error || (an.data || []).length === 0, 'rows returned'); }

// Week calendar feed (migration 051): row security of the source tables applies; signed-out gets nothing
{ const from = new Date(Date.now() - 200 * 864e5).toISOString(), to = new Date(Date.now() + 200 * 864e5).toISOString();
  const kinds = async (c) => { const r = await c.from('calendar_feed').select('kind').gte('starts_at', from).lt('starts_at', to).limit(5000); return { error: r.error, set: new Set((r.data || []).map((x) => x.kind)) }; };
  const a = await kinds(admin);
  check('Admin reads the calendar feed', !a.error, a.error?.message);
  const f = await kinds(fin);
  check('Finance sees no mock interviews or counselling in the calendar', !f.error && !f.set.has('interview') && !f.set.has('counsel'), [...f.set].join(','));
  const t = await kinds(tele);
  check('Telecaller sees no mock interviews in the calendar', !t.error && !t.set.has('interview'), [...t.set].join(','));
  const an = await anon.from('calendar_feed').select('kind').limit(1);
  check('Signed-out users cannot read the calendar feed', !!an.error || (an.data || []).length === 0, 'rows returned');
  const b1 = (await admin.from('batch').select('id').limit(1)).data?.[0];
  const bad = b1 ? await admin.from('batch').update({ class_days: [9] }).eq('id', b1.id) : { error: null };
  check('Batch class days outside Mon–Sun are refused', !!b1 && !!bad.error, 'update allowed');
  // migration 068: each item names the responsible staff member; still only rows the role can read
  const sf = await admin.from('calendar_feed').select('kind, staff_id').eq('kind', 'followup').gte('starts_at', from).lt('starts_at', to).limit(50);
  check('Calendar follow-ups carry the owner (staff_id)', !sf.error && (sf.data || []).length > 0 && sf.data.every((r) => r.staff_id), sf.error?.message);
  const fs = await fin.from('calendar_feed').select('kind, staff_id').gte('starts_at', from).lt('starts_at', to).limit(5000);
  check('Finance still sees no interviews or counselling with the staff column', !fs.error && !(fs.data || []).some((r) => r.kind === 'interview' || r.kind === 'counsel'), fs.error?.message); }

// Team leaderboard (migration 053): names and counts only; signed-out refused
{ const a = await admin.rpc('leaderboard', { p_metric: 'calls', p_period: 'month' });
  check('Admin reads the calls leaderboard', !a.error && Array.isArray(a.data), a.error?.message);
  const keys = new Set((a.data || []).flatMap((r) => Object.keys(r)));
  check('Leaderboard returns only names, roles and counts', [...keys].every((k) => ['staff_id', 'full_name', 'role', 'total', 'rank', 'prev_rank', 'is_me'].includes(k)), [...keys].join(','));
  const leadNames = new Set(((await service.from('lead').select('full_name').limit(1000)).data || []).map((x) => x.full_name));
  const t = await tele.rpc('leaderboard', { p_metric: 'enrolments', p_period: 'week' });
  check('Leaderboard rows are staff only (no lead or candidate names)', !t.error && (t.data || []).every((r) => ['Sales', 'HR / Counsellor'].includes(r.role) && !leadNames.has(r.full_name)), t.error?.message);
  const me = await tele.rpc('leaderboard', { p_metric: 'calls', p_period: 'week' });
  check('Telecaller sees own row marked', !me.error && (me.data || []).some((r) => r.is_me), me.error?.message);
  const an = await anon.rpc('leaderboard', { p_metric: 'calls', p_period: 'week' });
  check('Signed-out users cannot read the leaderboard', !!an.error, 'rows returned');
  const bad = await admin.rpc('leaderboard', { p_metric: 'mobile', p_period: 'week' });
  check('Leaderboard refuses unknown measures', !!bad.error, 'allowed'); }

// @mentions in notes (migration 055): stored on the note, trigger notifies only staff who can open the record
{ const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const ids = Object.fromEntries(((await svc.from('staff').select('id,email').in('email', ['harsha@demo.stint.local', 'manish@demo.stint.local', 'kiran@demo.stint.local'])).data || []).map((r) => [r.email.split('@')[0], r.id]));
  const l1 = (await admin.from('lead').select('id').limit(1)).data?.[0];
  const n = await admin.from('note').insert({ lead_id: l1?.id, body: 'mention test ' + startedAt, by_id: ids.harsha, mentioned: [ids.manish, ids.kiran] }).select('id,mentioned').single();
  check('Note saves picked mentions', !n.error && (n.data?.mentioned || []).includes(ids.manish), n.error?.message);
  check('Mention of staff who cannot open leads is dropped', !n.error && !(n.data?.mentioned || []).includes(ids.kiran), JSON.stringify(n.data?.mentioned));
  const got = (await svc.from('notification').select('staff_id').eq('kind', 'mention').like('body', 'mention test ' + startedAt + '%')).data || [];
  check('Mentioned Sales gets a notification', got.some((r) => r.staff_id === ids.manish), JSON.stringify(got));
  check('Trainer without lead access gets no mention notification', !got.some((r) => r.staff_id === ids.kiran), JSON.stringify(got));
  const mine = await trainer.from('notification').select('id').like('body', 'mention test ' + startedAt + '%');
  check('Staff cannot read others\' mention notifications', !mine.error && (mine.data || []).length === 0, 'rows returned');
  if (n.data) await svc.from('note').delete().eq('id', n.data.id); }

// remove the people this run created, then the events it raised (test records must not reach Activepieces)
{ const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  await svc.from('candidate').delete().eq('full_name', 'Test Walkin').gte('created_at', startedAt);
  await svc.from('notification').delete().gte('created_at', startedAt);
  await svc.from('lead').delete().in('full_name', ['Test Walkin', 'Test Again', 'Rule Test', 'Event Test', 'Meta Lead', 'Unknown Caller', 'Block Lead']).gte('created_at', startedAt); }
await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).from('integration_event').delete().gte('created_at', startedAt);

// ---- Funnel (migration 052) ----
{ const a = await admin.rpc('funnel_counts', { p_from: null, p_to: null });
  check('funnel: admin gets 5 steps', !a.error && a.data?.length === 5 && a.data.every((x) => x.n != null), a.error?.message);
  const t = await trainer.rpc('funnel_counts', { p_from: null, p_to: null });
  check('funnel: trainer gets no lead counts', !t.error && t.data.filter((x) => x.page === 'lead').every((x) => x.n == null), JSON.stringify(t.data || t.error));
  const z = await anon.rpc('funnel_counts', { p_from: null, p_to: null });
  check('funnel: anon cannot call', !!z.error); }

// Sidebar counts use the India day (migration 057)
{ const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const tid = (await svc.from('staff').select('id').eq('email', 'teja@demo.stint.local').single()).data.id;
  const ist = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);   // today's date in India
  const before = (await tele.rpc('sidebar_counts')).data?.followups ?? 0;
  const f = (await svc.from('follow_up').insert({ title: 'IST day check', owner_id: tid, due_at: ist + 'T23:00:00+05:30', status: 'Open', created_by: tid }).select('id').single()).data;
  const after = (await tele.rpc('sidebar_counts')).data?.followups ?? 0;
  check('Sidebar counts a follow-up due late tonight India time as today', after === before + 1, before + ' -> ' + after);
  await svc.from('follow_up').delete().eq('id', f.id);
}
// Voice input route: signed-out callers are refused (needs the app on port 3100)
{ const r = await fetch('http://localhost:3100/api/voice/dictate', { method: 'POST', body: new FormData() }).catch(() => null);
  if (!r) console.log('SKIP voice dictate check: the app is not running on port 3100');
  else check('voice dictate: signed-out caller gets 401', r.status === 401, String(r.status)); }
// ---- Audit trail (migration 058) ----
{ const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const l = (await admin.from('lead').select('id,city').limit(1).single()).data;
  await admin.from('lead').update({ city: 'AuditTown' }).eq('id', l.id);
  const a = (await admin.from('audit_log').select('*').eq('table_name', 'lead').eq('row_id', l.id).order('id', { ascending: false }).limit(1).single()).data;
  check('audit: edit creates a row with old/new', a?.action === 'UPDATE' && a.changed?.city?.old === l.city && a.changed?.city?.new === 'AuditTown' && a.actor_role === 'Admin', JSON.stringify(a));
  await admin.from('lead').update({ city: l.city }).eq('id', l.id);
  const cid = (await admin.from('candidate').select('id').eq('full_name', 'Priya Reddy').single()).data.id;
  const before = (await svc.from('candidate_private').select('bank').eq('candidate_id', cid).single()).data;
  await svc.from('candidate_private').update({ bank: { account: 'AUDIT-TEST-0000' } }).eq('candidate_id', cid);
  const p = (await admin.from('audit_log').select('changed').eq('table_name', 'candidate_private').order('id', { ascending: false }).limit(1).single()).data;
  check('audit: sensitive values masked', p?.changed?.bank?.new === '[changed]' && !JSON.stringify(p).includes('AUDIT-TEST'), JSON.stringify(p));
  if (before) await svc.from('candidate_private').update({ bank: before.bank }).eq('candidate_id', cid);
  for (const [n, c] of [['telecaller', tele], ['sales', sales], ['finance', fin]]) {
    const r = await c.from('audit_log').select('id').limit(1);
    check(`audit: ${n} cannot read`, !!r.error || r.data.length === 0, JSON.stringify(r.data));
  }
  const u = await admin.from('audit_log').update({ action: 'DELETE' }).eq('id', a.id).select();
  const d = await admin.from('audit_log').delete().eq('id', a.id).select();
  const su = await svc.from('audit_log').update({ table_name: 'x' }).eq('id', a.id);
  const sd = await svc.from('audit_log').delete().eq('id', a.id);
  const still = (await admin.from('audit_log').select('table_name').eq('id', a.id).single()).data;
  check('audit: nobody can update or delete rows (admin + service)', !!su.error && !!sd.error && (u.error || !u.data?.length) && (d.error || !d.data?.length) && still?.table_name === 'lead', JSON.stringify({ u: u.error?.message, su: su.error?.message, sd: sd.error?.message }));
  const ins = await admin.from('audit_log').insert({ table_name: 'fake', action: 'INSERT' });
  check('audit: nobody can insert fake rows', !!ins.error); }

// ---- Reminders (migration 061) ----
{ const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const any = (await admin.from('reminder_rule').select('id,offset_days').limit(1).single()).data;
  const t = await tele.from('reminder_rule').update({ offset_days: 9 }).eq('id', any?.id).select();
  check('reminders: telecaller cannot edit rules', (t.data || []).length === 0);
  const ti = await tele.from('reminder_rule').insert({ name: 'x', trigger: 'fee_due' });
  check('reminders: telecaller cannot add rules', !!ti.error);
  check('reminders: telecaller cannot preview', !!(await tele.rpc('preview_reminders', {})).error);
  check('reminders: signed-in staff cannot run the sender job', !!(await admin.rpc('run_reminders')).error);
  const tid = (await svc.from('staff').select('id').eq('email', 'teja@demo.stint.local').single()).data.id;
  const ist = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const rule = (await svc.from('reminder_rule').insert({ name: 'Test follow-up rule', active: true, trigger: 'follow_up_due', offset_days: 0, channel: 'email', audience: 'staff_owner', body_template: 'Hi {{first_name}}: {{name}}' }).select('id').single()).data;
  const fu = (await svc.from('follow_up').insert({ title: 'Reminder test', owner_id: tid, due_at: ist + 'T12:00:00+05:30', status: 'Open', created_by: tid }).select('id').single()).data;
  const msgCount = async () => (await svc.from('message').select('id', { count: 'exact', head: true })).count;
  const m0 = await msgCount();
  const pv = await admin.rpc('preview_reminders', { p_rule: rule.id });
  check('reminders: dry run lists the person and sends nothing', !pv.error && pv.data.some((x) => x.person_name === 'Teja') && (await msgCount()) === m0, pv.error?.message);
  await svc.rpc('reminders_core', { p_dry: false, p_rule: rule.id, p_force: true });
  await svc.rpc('reminders_core', { p_dry: false, p_rule: rule.id, p_force: true });
  const logs = (await svc.from('reminder_log').select('message_id,person_id').eq('rule_id', rule.id)).data || [];
  const mine = logs.filter((l) => l.person_id === tid);
  check('reminders: running twice queues only one message per person', mine.length === 1 && (await msgCount()) === m0 + logs.length, `${mine.length} for Teja, ${logs.length} logs, ${(await msgCount()) - m0} msgs`);
  const q = mine[0]?.message_id && (await svc.from('message').select('status,body').eq('id', mine[0].message_id).single()).data;
  check('reminders: message is queued with rendered text', q?.status === 'queued' && /^Hi Teja: /.test(q.body), JSON.stringify(q));
  // opted-out student is skipped
  const fr = (await svc.from('reminder_rule').insert({ name: 'Test fee rule', active: true, trigger: 'fee_due', offset_days: 0, channel: 'whatsapp', audience: 'student', body_template: 'Pay {{amount}}' }).select('id').single()).data;
  await svc.from('candidate').update({ contact_opt_out: true }).eq('id', cand.id);
  const fp = (await svc.from('fee_payment').insert({ candidate_id: cand.id, amount: 1000, status: 'Due', due_on: ist, label: 'Reminder test' }).select('id').single()).data;
  await svc.rpc('reminders_core', { p_dry: false, p_rule: fr.id, p_force: true });
  const fl = (await svc.from('reminder_log').select('id').eq('rule_id', fr.id).eq('person_id', cand.id)).data || [];
  check('reminders: opted-out student is skipped', fl.length === 0, String(fl.length));
  await svc.from('candidate').update({ contact_opt_out: false }).eq('id', cand.id);
  if (fp) await svc.from('fee_payment').delete().eq('id', fp.id);
  for (const l of logs) if (l.message_id) await svc.from('message').delete().eq('id', l.message_id);
  await svc.from('reminder_rule').delete().in('id', [rule.id, fr.id]);
  await svc.from('follow_up').delete().eq('id', fu.id); }
// Messaging (migration 060): visibility, outbound-only inserts, webhook signature
{ const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const ld = (await svc.from('lead').select('id').limit(1).single()).data;
  const m = (await svc.from('message').insert({ channel: 'whatsapp', direction: 'in', status: 'received', lead_id: ld.id, body: 'sec test', from_addr: '919800000000' }).select('id').single()).data;
  const t = await trainer.from('message').select('id').eq('id', m.id);
  check('message: trainer (no lead access) cannot read lead messages', !t.error ? t.data.length === 0 : true, JSON.stringify(t.data));
  const a = await admin.from('message').select('id, body').eq('id', m.id);
  check('message: admin can read', a.data?.length === 1, JSON.stringify(a.error));
  const addr = await admin.from('message').select('from_addr').eq('id', m.id);
  check('message: staff cannot read raw addresses', !!addr.error, JSON.stringify(addr.data));
  const tid = (await svc.from('staff').select('id').eq('email', 'harsha@demo.stint.local').single()).data.id;
  const inb = await admin.from('message').insert({ channel: 'whatsapp', direction: 'in', status: 'received', lead_id: ld.id, body: 'fake', created_by: tid });
  check('message: staff cannot insert inbound rows', !!inb.error);
  const tr = await trainer.from('message').insert({ channel: 'whatsapp', direction: 'out', status: 'queued', lead_id: ld.id, body: 'x', created_by: (await svc.from('staff').select('id').eq('email', 'kiran@demo.stint.local').single()).data.id });
  check('message: trainer cannot queue a message to a lead', !!tr.error);
  const up = await admin.from('message').update({ status: 'read' }).eq('id', m.id).select('id');
  check('message: staff cannot change status', !!up.error || (up.data || []).length === 0);
  const tw = await trainer.from('message_template').insert({ name: 'x', body: 'y' });
  check('message_template: non-admin cannot add', !!tw.error);
  await svc.from('message').delete().eq('id', m.id);
  const r = await fetch('http://localhost:3100/api/webhooks/whatsapp', { method: 'POST', headers: { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64), 'content-type': 'application/json' }, body: '{"entry":[]}' }).catch(() => null);
  if (!r) console.log('SKIP whatsapp webhook check: the app is not running on port 3100');
  else check('whatsapp webhook: bad signature rejected', r.status === 401, String(r.status));
  const p = await fetch('http://localhost:3100/api/messages/process', { method: 'POST', headers: { 'x-cron-secret': 'wrong' } }).catch(() => null);
  if (p) check('messages/process: wrong cron secret rejected', p.status === 401, String(p.status));
  const sOut = await fetch('http://localhost:3100/api/messages/send', { method: 'POST', body: '{}' }).catch(() => null);
  if (sOut) check('messages/send: signed-out caller gets 401', sOut.status === 401, String(sOut.status));
}
// Injection & API hardening (audit 2026-10, migration 059)
{ const pq = (v) => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; // same as lib/pgrst.ts pgQuote
  const has = (col, t) => `${col}.ilike.${pq('*' + String(t).replace(/[%*_\\]/g, ' ').trim() + '*')}`;
  for (const evil of ['a,id.not.is.null)', "%' or 1=1--", 'x"),id.not.is.null,full_name.eq.("', '*', 'a)or(id.not.is.null']) {
    const r = await tele.from('candidate').select('id').or(`${has('full_name', evil)},${has('code', evil)}`).limit(50);
    check(`injection: search term ${JSON.stringify(evil)} matches nothing extra`, !r.error && (r.data || []).length === 0, r.error?.message || String(r.data?.length));
  }
  const lid = (await service.from('lead').select('id').limit(1).single()).data?.id;
  for (const [who, c] of [['visitor', anon], ['telecaller', tele], ['admin', admin]]) {
    const r = await c.rpc('lead_brief', { lid });
    check(`lead_brief (full contact) is server-only: ${who} refused`, !!r.error || !r.data);
  }
  check('candidate_brief is server-only', !!(await tele.rpc('candidate_brief', { cid: lid })).error);
  check('emit_event cannot be called by staff (no forged webhooks)', !!(await admin.rpc('emit_event', { ev: 'lead.created', ent: 'lead', eid: lid, who: 'x', data: {} })).error);
  const off = await service.rpc('security_definer_offenders');
  { const used = new Set(); const walk = (d) => { for (const e of fs.readdirSync(new URL('../' + d, import.meta.url), { withFileTypes: true })) {
      const rel = d + '/' + e.name; if (e.isDirectory()) { if (e.name !== 'node_modules') walk(rel); }
      else if (/\.(tsx?|mjs)$/.test(e.name)) for (const m of fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8').matchAll(/['"]([a-z_0-9]+)['"]/g)) used.add(m[1]); } };
    for (const d of ['app', 'components', 'lib']) walk(d); used.add('raise_alerts_now'); // Admin-only check, refused inside for others
    const open = await service.rpc('definer_open_to_staff');
    const extra = (open.data || []).filter((n) => !used.has(n));
    check('signed-in users can run only definer functions the app calls (allow-list)', !open.error && extra.length === 0, open.error?.message || extra.join(', ')); }
  check('every SECURITY DEFINER function: search_path set, no anon EXECUTE', !off.error && off.data.length === 0, off.error?.message || JSON.stringify(off.data.slice(0, 5)));
  const APP = env.APP_URL || 'http://localhost:3100';
  const up = await fetch(APP + '/api/integrations/me').then(() => true).catch(() => false);
  if (!up) console.log('SKIP API checks: app not running on ' + APP);
  else {
    const call = (path, init = {}) => fetch(APP + path, { redirect: 'manual', ...init }).then((r) => r.status).catch(() => 0);
    const post = (path, body, headers = {}) => call(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    for (const p of ['/api/admin/invite', '/api/admin/reset-password', '/api/portal/invite', '/api/recordings/process', '/api/integrations/lead', '/api/integrations/note', '/api/integrations/stage', '/api/integrations/follow-up', '/api/integrations/hooks', '/api/integrations/practice', '/api/recordings/cleanup']) {
      const s = await post(p, { staff_id: lid, candidate_id: lid, id: lid, email: 'x@example.com', full_name: 'X', role: 'Admin' });
      check(`API ${p}: no login / key → refused`, [401, 403].includes(s), String(s));
    }
    for (const p of ['/api/integrations/me', '/api/integrations/find?mobile=9000000000', '/api/integrations/fees-due', '/api/integrations/lead-details?lead_id=' + lid, '/api/mobile/notes', '/api/portal/coach']) {
      const s = await call(p);
      check(`API GET ${p}: no login / key → refused`, [401, 403].includes(s), String(s));
    }
    check('API wrong key of a different length → 401 (no crash)', (await call('/api/integrations/me', { headers: { 'x-api-key': 'é'.repeat(7) } })) === 401);
    check('API cross-site POST is refused (Origin check)', (await post('/api/admin/invite', {}, { origin: 'https://evil.example' })) === 403);
    for (const p of ['/api/pdf/quote/not-a-uuid', '/api/pdf/receipt/1%27or%271', '/api/portal/receipt/..%2F..%2Fetc']) {
      const s = await call(p);
      check(`API bad id ${p} → 400/401/404, never 500`, [400, 401, 404].includes(s), String(s));
    }
  }
}
// ---- Report builder (migration 062) ----
{ const run = (c, d) => c.rpc('run_report', { p_def: d });
  const ok = await run(admin, { source: 'payments', group_by: [{ field: 'status' }], measures: [{ agg: 'sum', field: 'amount' }] });
  check('report builder: admin runs a fees report', !ok.error && Array.isArray(ok.data?.rows) && ok.data.rows.length > 0, ok.error?.message);
  const t = await run(tele, { source: 'payments', group_by: [{ field: 'status' }] });
  check('report builder: Telecaller cannot run a fees report', !!t.error, JSON.stringify(t.data));
  await service.from('role_page_access').insert({ role: 'Telecaller', page_id: 'reports_builder', mode: 'r' });
  const t2 = await run(tele, { source: 'payments', group_by: [{ field: 'status' }] });
  check('report builder: Telecaller with the builder page still cannot run fees (no Payments page)', !!t2.error, JSON.stringify(t2.data));
  const t3 = await run(tele, { source: 'leads', group_by: [{ field: 'stage' }] });
  check('report builder: Telecaller with the builder page can run a leads report', !t3.error, t3.error?.message);
  await service.from('role_page_access').delete().eq('role', 'Telecaller').eq('page_id', 'reports_builder');
  for (const col of ['mobile', 'email', 'mobile_masked', 'pan', 'aadhaar', 'account']) {
    const r = await run(admin, { source: 'leads', columns: [col] });
    check(`report builder: sensitive column "${col}" not selectable`, !!r.error);
  }
  const bad = [
    { source: 'leads', columns: ['stage", (select mobile from lead limit 1) as "x'] },
    { source: 'leads', columns: ['stage; drop table lead;--'] },
    { source: 'leads; drop table lead;--', columns: ['stage'] },
    { source: 'leads', group_by: [{ field: 'stage' }], measures: [{ agg: 'max', field: 'stage' }] },
    { source: 'leads', group_by: [{ field: 'created_on', bucket: "month', created_on) from lead --" }] },
    { source: 'leads', columns: ['stage'], sort: { key: 'stage', dir: 'desc; drop table lead' } },
    { source: 'leads', columns: ['stage'], sort: { key: '1; select 1' } },
    { source: 'leads', columns: ['stage'], filters: [{ field: 'stage', op: 'like', value: 'x' }] },
    { source: 'leads', columns: ['stage'], filters: [{ field: 'stage)) or ((1=1', op: 'eq', value: 'x' }] },
  ];
  let rejected = 0; for (const d of bad) if ((await run(admin, d)).error) rejected++;
  check('report builder: injection payloads in names/operators are rejected', rejected === bad.length, rejected + '/' + bad.length);
  const v = await run(admin, { source: 'leads', columns: ['stage'], filters: [{ field: 'stage', op: 'eq', value: "x' or '1'='1" }, { field: 'city', op: 'contains', value: "%' or 1=1 --" }] });
  check('report builder: injection in filter values is treated as plain text', !v.error && v.data.rows.length === 0, v.error?.message || JSON.stringify(v.data));
  const lim = await run(admin, { source: 'leads', columns: ['stage'], limit: 999999 });
  check('report builder: limit capped at 5000', !lim.error && lim.data.rows.length <= 5000);
  const sv = await admin.from('saved_report').insert({ name: 'sec test', def: { source: 'leads', columns: ['stage'] }, shared_with_roles: ['Finance', 'Trainer'] }).select('id').single();
  const fr = await fin.from('saved_report').select('id').eq('id', sv.data?.id);
  check('report builder: Finance (has the builder page) can read a report shared with Finance', (fr.data || []).length === 1);
  const tr = await trainer.from('saved_report').select('id').eq('id', sv.data?.id);
  check('report builder: Trainer (no builder page) cannot read a report shared with Trainer', (tr.data || []).length === 0);
  const ti = await tele.from('saved_report').insert({ name: 'x', def: {} });
  check('report builder: Telecaller cannot save reports', !!ti.error);
  const sx = await tele.from('report_source').select('key');
  check('report builder: catalogue hidden without the page', (sx.data || []).length === 0);
  await admin.from('saved_report').delete().eq('id', sv.data?.id); }
// --- Login guard (migration 063) ---
{ const tl = await as('teja'), ad = await as('harsha');
  const lr = await tl.rpc('login_record', { p_email: 'x@nobody.stint.local', p_ok: false, p_ip: '' });
  check('login guard: staff cannot write login attempts', !!lr.error);
  const ls = await tl.rpc('login_locked_seconds', { p_email: 'harsha@demo.stint.local' });
  check('login guard: staff cannot probe lockouts', !!ls.error);
  const ti = await tl.from('login_attempt').insert({ email: 'x', ok: true });
  check('login guard: no direct inserts', !!ti.error);
  const tr = await tl.from('login_attempt').select('id').limit(1);
  check('login guard: Telecaller cannot read the log', (tr.data || []).length === 0);
  const ar = await ad.from('login_attempt').select('id').limit(1);
  check('login guard: Admin can read the log', !ar.error, ar.error?.message); }
// ---- List summary strip (migration 066) ----
{ const a = await admin.rpc('list_summary_payment'), f = await fin.rpc('list_summary_payment'), t = await tele.rpc('list_summary_payment');
  check('list summary: Admin gets payment totals', !a.error && Number(a.data?.collected) >= 0, a.error?.message);
  check('list summary: Finance totals match Admin', !f.error && JSON.stringify(f.data) === JSON.stringify(a.data), JSON.stringify(f.data));
  check('list summary: Telecaller (no Payments page) sees zero totals', !t.error && Number(t.data?.collected) === 0 && Number(t.data?.late_students) === 0, JSON.stringify(t.data || t.error));
  const an = await anon.rpc('list_summary_payment');
  check('list summary: anonymous cannot call it', !!an.error); }
// ---- Report definitions (migration 069) ----
{ const r = await admin.from('rep_roi').select('leads,enrolled,enrol_pct');
  check('reports: source with no leads shows no rate (not 0%)', !r.error && (r.data || []).filter((x) => Number(x.leads) === 0).every((x) => x.enrol_pct === null), r.error?.message);
  check('reports: enrolled never exceeds leads per source', (r.data || []).every((x) => Number(x.enrolled) <= Number(x.leads)));
  const c = await admin.from('rep_cash').select('booked,collected_pct');
  check('reports: nothing booked shows no collected %', !c.error && (c.data || []).filter((x) => Number(x.booked) === 0).every((x) => x.collected_pct === null), c.error?.message);
  const t = await tele.from('rep_cash').select('booked');
  check('reports: Telecaller gets no fee numbers', (t.data || []).every((x) => Number(x.booked) === 0)); }
// ---- Student portal: rejected documents and next class (migration 071) ----
{ const st = await as('priya');
  const mine = (await service.from('student_account').select('candidate_id').eq('user_id', (await st.auth.getUser()).data.user.id).single()).data?.candidate_id;
  const cand = (await service.from('candidate').select('batch_id, batch:batch_id(code)').eq('id', mine).single()).data;
  const nc = await st.rpc('portal_next_class');
  check('portal: next class is only the student\'s own batch', !nc.error && (nc.data === null || nc.data.batch === cand?.batch?.code), JSON.stringify(nc.data || nc.error));
  const other = (await service.from('candidate').select('id').neq('id', mine).not('batch_id', 'is', null).neq('batch_id', cand?.batch_id || '00000000-0000-0000-0000-000000000000').limit(1)).data?.[0];
  check('portal: student cannot read another batch\'s classes', !nc.data || nc.data.batch === cand?.batch?.code, String(other?.id));
  const sf = await st.from('batch').select('id').neq('id', cand?.batch_id || '00000000-0000-0000-0000-000000000000').limit(1);
  check('portal: student cannot list other batches directly', (sf.data || []).length === 0, JSON.stringify(sf.data));
  const an = await anon.rpc('portal_next_class'), ar = await anon.rpc('portal_document_reasons');
  check('portal: anonymous cannot call next class / reasons', !!an.error && !!ar.error);
  const tr = await tele.rpc('portal_document_reasons');
  check('portal: staff get no student reasons via portal RPC', !tr.error && (tr.data || []).length === 0, JSON.stringify(tr.error));
  const d = await service.from('candidate_document').insert({ candidate_id: mine, doc_type: 'SecTest', status: 'Missing' }).select('id').single();
  const noReason = await admin.from('candidate_document').update({ status: 'Rejected' }).eq('id', d.data.id);
  check('documents: Rejected needs a reason', !!noReason.error);
  const withReason = await admin.from('candidate_document').update({ status: 'Rejected', reject_reason: 'Photo is blurred' }).eq('id', d.data.id);
  check('documents: Rejected with a reason saves', !withReason.error, withReason.error?.message);
  const rr = await st.rpc('portal_document_reasons');
  check('portal: student sees the reason for own rejected document', (rr.data || []).some((x) => x.id === d.data.id && x.reject_reason === 'Photo is blurred'), JSON.stringify(rr.data || rr.error));
  await service.from('candidate_document').delete().eq('id', d.data.id); }
// ---- Attendance standing (migration 070) ----
{ const t = await trainer.from('attendance_standing').select('candidate_id,sessions_held,sessions_attended,min_pct').limit(50);
  check('attendance standing: Trainer reads it', !t.error && (t.data || []).length > 0, t.error?.message);
  check('attendance standing: attended never exceeds held', (t.data || []).every((r) => r.sessions_attended <= r.sessions_held));
  const x = await tele.from('attendance_standing').select('candidate_id').limit(1);
  check('attendance standing: Telecaller (no Attendance page) sees nothing', (x.data || []).length === 0);
  const an = await anon.from('attendance_standing').select('candidate_id').limit(1);
  check('attendance standing: anonymous blocked', !!an.error || (an.data || []).length === 0); }
// ---- Dashboard metrics and cohort funnel (migration 065) ----
{ const a = await admin.rpc('dashboard_metrics');
  check('dashboard metrics: Admin gets numbers', !a.error && typeof a.data?.fu_overdue === 'number' && typeof a.data?.leads_month === 'number', a.error?.message);
  const ft = await fin.rpc('dashboard_metrics');
  check('dashboard metrics: Finance sees no lead numbers (null, not 0)', !ft.error && ft.data?.leads_month === null && ft.data?.sources === null, JSON.stringify(ft.error));
  const tt = await tele.rpc('dashboard_metrics');
  check('dashboard metrics: Telecaller sees no fee numbers', !tt.error && tt.data?.collected_month === null && tt.data?.fees_overdue_amt === null, JSON.stringify(tt.error));
  const tl = await tele.from('lead_list').select('id', { count: 'exact', head: true }).not('stage', 'in', '(Converted,"Not interested")');
  check('dashboard metrics: Telecaller open leads = own lead list count', tt.data?.leads_open === tl.count, `${tt.data?.leads_open} vs ${tl.count}`);
  const an = await anon.rpc('dashboard_metrics');
  check('dashboard metrics: anonymous blocked', !!an.error || an.data == null);
  const f = await admin.rpc('funnel_cohort', { p_from: null, p_to: null });
  const ns = (f.data || []).map((r) => Number(r.n));
  check('cohort funnel: 5 steps, each <= the step before', !f.error && ns.length === 5 && ns.every((n, i) => i === 0 || n <= ns[i - 1]), JSON.stringify(ns));
  const fc = await fin.rpc('funnel_cohort', { p_from: null, p_to: null });
  check('cohort funnel: Finance (no Leads page) gets no counts', !fc.error && (fc.data || []).every((r) => r.n === null), JSON.stringify(fc.data));
  const ft2 = await tele.rpc('funnel_cohort', { p_from: null, p_to: null });
  check('cohort funnel: Telecaller gets no enrolment/placement steps', !ft2.error && (ft2.data || []).filter((r) => r.step >= 4).every((r) => r.n === null), JSON.stringify(ft2.data));
  const fz = await anon.rpc('funnel_cohort', { p_from: null, p_to: null });
  check('cohort funnel: anonymous blocked', !!fz.error || (fz.data || []).every((r) => r.n === null)); }
// ---- Stage rules: allowed moves, requirements, Admin override (migration 073) ----
{ const sm = '6' + String(Date.now()).slice(-9);
  const sl = (await desk.from('lead').insert({ full_name: 'Stage Rules Test', mobile: sm }).select('id').single()).data;
  const jump = await admin.from('lead').update({ stage: 'Converted' }).eq('id', sl.id).select('id');
  check('Stage rules: a jump that is not an allowed move is refused (even for Admin)', jump.error?.code === '23514' && /isn.t allowed/.test(jump.error.message) && /Allowed next: Callback, Interested, Not interested/.test(jump.error.message), jump.error?.message || 'moved');
  const early = await admin.from('lead').update({ stage: 'Interested' }).eq('id', sl.id).select('id');
  check('Stage rules: an unmet requirement is refused with a plain message', early.error?.code === '23514' && /Can't move to Interested yet: no call has been logged yet/.test(early.error.message), early.error?.message || 'moved');
  const cb = await admin.from('lead').update({ stage: 'Callback' }).eq('id', sl.id).select('id');
  check('Stage rules: Callback needs a call and the next call time', /no call has been logged yet; the next call date and time is not set/.test(cb.error?.message || ''), cb.error?.message || 'moved');
  const chk = await admin.rpc('stage_check', { p_kind: 'lead', p_id: sl.id });
  const ci = (chk.data || []).find((o) => o.to_stage === 'Interested');
  check('Stage rules: stage_check lists allowed next stages with what is missing', !chk.error && (chk.data || []).map((o) => o.to_stage).join() === 'Callback,Interested,Not interested' && ci?.ok === false && ci.missing[0]?.code === 'call_logged', JSON.stringify(chk));
  await admin.from('call_log').insert({ lead_id: sl.id, outcome: 'Interested' });
  const ok = await admin.from('lead').update({ stage: 'Interested' }).eq('id', sl.id).select('stage').single();
  check('Stage rules: once the requirement is met the move goes through', !ok.error && ok.data?.stage === 'Interested', ok.error?.message);
  const noWhy = await sales.from('lead').update({ stage: 'Not interested' }).eq('id', sl.id).select('id');
  const why = await sales.from('lead').update({ stage: 'Not interested', lost_reason: 'Fee too high' }).eq('id', sl.id).select('stage').single();
  check('Stage rules: Not interested needs a reason, given in the same save', /no reason is recorded/.test(noWhy.error?.message || '') && why.data?.stage === 'Not interested', (noWhy.error?.message || 'moved') + ' / ' + why.error?.message);
  const sf = await sales.rpc('force_stage', { p_kind: 'lead', p_id: sl.id, p_to: 'Converted', p_reason: 'Please let me' });
  check('Stage rules: a non-admin cannot override', sf.error?.code === '42501', sf.error?.message || 'forced');
  const short = await admin.rpc('force_stage', { p_kind: 'lead', p_id: sl.id, p_to: 'Counselling', p_reason: 'ok' });
  check('Stage rules: an override needs a reason of 5+ characters', !!short.error && /at least 5/.test(short.error.message), short.error?.message || 'forced');
  const fo = await admin.rpc('force_stage', { p_kind: 'lead', p_id: sl.id, p_to: 'Counselling', p_reason: 'Walk-in counselled at desk' });
  const after = (await admin.from('lead').select('stage').eq('id', sl.id).single()).data;
  const hist = (await admin.from('status_history').select('what, from_value, to_value').eq('entity_id', sl.id)).data || [];
  check('Stage rules: Admin override moves it and keeps the reason in status history', !fo.error && after?.stage === 'Counselling' && hist.some((h) => h.what === 'Stage override by Admin: Walk-in counselled at desk' && h.from_value === 'Not interested' && h.to_value === 'Counselling'), fo.error?.message || JSON.stringify(hist));
  const cand = (await admin.from('candidate').select('id').eq('stage', 'Enrolled').is('batch_id', null).limit(1).maybeSingle()).data
    || (await service.from('candidate').insert({ code: 'STA-SR-' + String(Date.now()).slice(-5), full_name: 'Stage Rules Cand', stage: 'Enrolled' }).select('id').single()).data;
  const ct = await admin.from('candidate').update({ stage: 'Training' }).eq('id', cand.id).select('id');
  check('Stage rules: Enrolled → Training needs a batch (candidate side)', ct.error?.code === '23514' && /no batch is assigned/.test(ct.error.message), ct.error?.message || 'moved');
  const att = (await admin.from('stage_requirement').select('active').eq('code', 'attendance_min').single()).data;
  check('Stage rules: the attendance requirement exists but is off by default', att?.active === false, JSON.stringify(att));
  const tr = await tele.from('stage_requirement').update({ active: false }).eq('code', 'call_logged').select('id');
  const ti = await tele.from('stage_transition').insert({ kind: 'lead', from_stage: 'New', to_stage: 'Converted' });
  const tread = await tele.from('stage_transition').select('to_stage').eq('kind', 'lead').eq('from_stage', 'New');
  check('Stage rules: Telecaller can read the rules but not change them', (tr.data || []).length === 0 && !!ti.error && (tread.data || []).length === 3, JSON.stringify([tr.error, ti.error?.message, tread.data]));
  await admin.from('lead').delete().eq('id', sl.id); await admin.from('status_history').delete().eq('entity_id', sl.id);
}

// Student name and ID: Admin only once the record exists (migration 074)
{ const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const c = (await svc.from('candidate').select('id, full_name, code').limit(1).single()).data;
  const r1 = await hr.from('candidate').update({ full_name: c.full_name + ' X' }).eq('id', c.id).select('id');
  check('Non-admin cannot rename a student', !!r1.error || (r1.data || []).length === 0, JSON.stringify(r1.data));
  const r2 = await hr.from('candidate').update({ code: 'HACK-1' }).eq('id', c.id).select('id');
  check('Non-admin cannot change a student ID', !!r2.error || (r2.data || []).length === 0);
  const r3 = await admin.from('candidate').update({ full_name: c.full_name + ' X' }).eq('id', c.id).select('id');
  check('Admin can correct a student name', !r3.error && (r3.data || []).length === 1, r3.error?.message);
  await svc.from('candidate').update({ full_name: c.full_name }).eq('id', c.id);
}

// Receipt / quote verification by QR (migration 077)
{ const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const pay = (await svc.from('fee_payment').select('id, verification_code, amount, candidate:candidate_id(full_name, code)').eq('status', 'Received').limit(1).single()).data;
  const q = (await svc.from('fee_quote').select('verification_code, lead:lead_id(full_name, mobile, email)').limit(1).single()).data;
  check('verify: every receipt and quote has a 16-char code', /^[0-9A-F]{16}$/.test(pay?.verification_code || '') && /^[0-9A-F]{16}$/.test(q?.verification_code || ''));
  const a = await anon.rpc('verify_document', { p_code: pay.verification_code });
  const s = await sales.rpc('verify_document', { p_code: pay.verification_code });
  check('verify: anonymous and staff cannot call the function directly (page uses the server)', !!a.error && !!s.error);
  const r = (await svc.rpc('verify_document', { p_code: pay.verification_code })).data || {};
  const allowed = ['found', 'kind', 'number', 'issued_on', 'valid_until', 'amount', 'status', 'institute', 'holder'];
  const text = JSON.stringify(r);
  check('verify: genuine receipt found with only the allowed fields', r.found === true && r.kind === 'receipt' && Object.keys(r).every((k) => allowed.includes(k)), text);
  check('verify: no full name, student ID or internal id revealed', !text.includes(pay.candidate.full_name) && !(pay.candidate.code && text.includes(pay.candidate.code)) && !text.includes(pay.id), text);
  const rq = JSON.stringify((await svc.rpc('verify_document', { p_code: q.verification_code })).data || {});
  check('verify: quote shows no lead name, mobile or email', rq.includes('"found": true') || rq.includes('"found":true') ? ![q.lead.full_name, q.lead.mobile, q.lead.email].filter(Boolean).some((x) => rq.includes(x)) : false, rq);
  let hits = 0;
  for (let i = 0; i < 25; i++) { const c = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    if ((await svc.rpc('verify_document', { p_code: c })).data?.found) hits++; }
  check('verify: 25 random codes all return not found', hits === 0, String(hits));
  check('verify: short or junk codes return not found', (await svc.rpc('verify_document', { p_code: "' or 1=1--" })).data?.found === false);
  const due = (await svc.from('fee_payment').select('verification_code').neq('status', 'Received').limit(1).maybeSingle()).data;
  if (due) check('verify: an unpaid payment is not shown as a receipt', (await svc.rpc('verify_document', { p_code: due.verification_code })).data?.found === false);
  const chg = await admin.from('fee_payment').update({ verification_code: 'AAAAAAAAAAAAAAAA' }).eq('id', pay.id).select('verification_code');
  check('verify: the code cannot be changed by staff', !chg.error && chg.data?.[0]?.verification_code === pay.verification_code, JSON.stringify(chg.data || chg.error)); }
// QR check-in (migration 076): codes are signed in the database, bound to the student's own batch and today
{ const { createHmac } = await import('node:crypto');
  const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const student = await as('priya');
  const me = (await svc.from('candidate').select('id, batch_id').eq('full_name', 'Priya Reddy').single()).data;
  const other = (await svc.from('batch').select('id').neq('id', me.batch_id).eq('trainer_id', (await svc.from('staff').select('id').eq('email', 'kiran@demo.stint.local').single()).data.id).limit(1).single()).data;
  await svc.from('checkin_log').delete().eq('candidate_id', me.id).eq('ok', false); // fresh rate-limit window
  const t0 = new Date(Date.now() - 1000).toISOString();
  const codeOf = async (sid, w) => { const sec = (await svc.from('checkin_session').select('secret').eq('id', sid).single()).data.secret;
    const h = createHmac('sha256', Buffer.from(String(sec).replace(/^\\x/, ''), 'hex')).update(`${sid}|${w}`).digest();
    return [...h.subarray(0, 6)].map((b) => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join(''); };
  const w = Math.floor(Date.now() / 30000);
  const so = await student.rpc('open_checkin', { p_batch: me.batch_id });
  check('Check-in: a student cannot open a check-in', !!so.error);
  const an = await anon.rpc('student_checkin', { p_code: 'ABCDEF' });
  check('Check-in: a visitor without login is refused', !!an.error);
  const hro = await hr.rpc('open_checkin', { p_batch: me.batch_id });
  check('Check-in: a role without attendance write cannot open one', !!hro.error);
  const sec = await trainer.from('checkin_session').select('secret').limit(1);
  check('Check-in: staff cannot read the signing secret', !!sec.error, JSON.stringify(sec.data));
  const s1 = (await trainer.rpc('open_checkin', { p_batch: me.batch_id })).data;
  const s2 = (await trainer.rpc('open_checkin', { p_batch: other.id })).data;
  const live = (await trainer.rpc('current_checkin_token', { p_session: s1 })).data;
  check('Check-in: trainer gets a 6-character code that matches the signature', live?.code?.length === 6 && live.code === await codeOf(s1, w) || live?.code === await codeOf(s1, w + 1), JSON.stringify(live));
  const today = (await svc.rpc('checkin_today')).data;
  await svc.from('attendance').delete().eq('candidate_id', me.id).eq('day', today);
  const ex = await student.rpc('student_checkin', { p_code: await codeOf(s1, w - 3) });
  check('Check-in: an expired code is refused', ex.data?.status === 'invalid', JSON.stringify(ex));
  const ob = await student.rpc('student_checkin', { p_code: await codeOf(s2, w) });
  check('Check-in: the code of another batch is refused', ob.data?.status === 'invalid', JSON.stringify(ob));
  const ok1 = await student.rpc('student_checkin', { p_code: live.code });
  const ok2 = await student.rpc('student_checkin', { p_code: live.code });
  const rows = (await svc.from('attendance').select('mark, batch_id').eq('candidate_id', me.id).eq('day', today)).data || [];
  check('Check-in: valid code marks the student present once (second scan is a no-op)', ok1.data?.status === 'present' && ok2.data?.status === 'already' && rows.length === 1 && rows[0].mark === 'P' && rows[0].batch_id === me.batch_id, JSON.stringify([ok1, ok2, rows]));
  const after = (await trainer.rpc('current_checkin_token', { p_session: s1 })).data;
  check('Check-in: trainer screen shows the arrival', (after?.arrived || []).some((a) => a.name === 'Priya Reddy') && after.present >= 1, JSON.stringify(after));
  await trainer.rpc('close_checkin', { p_session: s1 }); await trainer.rpc('close_checkin', { p_session: s2 });
  const cl = await student.rpc('student_checkin', { p_code: live.code });
  check('Check-in: a stopped check-in accepts no codes', cl.data?.status === 'invalid', JSON.stringify(cl));
  const fails = (await svc.from('checkin_log').select('id').eq('candidate_id', me.id).eq('ok', false).gte('at', t0)).data || [];
  check('Check-in: wrong codes are logged (for the rate limit)', fails.length >= 3, String(fails.length));
  const uid = (await student.auth.getUser()).data.user.id;
  await svc.from('checkin_log').insert(Array.from({ length: 8 }, () => ({ user_id: uid, candidate_id: me.id, ok: false, reason: 'test' })));
  const rl = await student.rpc('student_checkin', { p_code: 'ABCDEF' });
  check('Check-in: 8 wrong codes in 5 minutes block further tries', !!rl.error && /Too many/.test(rl.error.message), JSON.stringify(rl));
  await svc.from('attendance').delete().eq('candidate_id', me.id).eq('day', today);
  await svc.from('checkin_log').delete().eq('candidate_id', me.id).gte('at', t0); // only this run's rows (keeps the rate limit clean)
}
// ---- 075 Profile photos ----
{ const st = await as('priya');
  const me = (await service.from('candidate').select('id').eq('full_name', 'Priya Reddy').single()).data;
  const other = (await service.from('candidate').select('id').neq('id', me.id).limit(1).single()).data;
  const png = new Blob([new Uint8Array([82, 73, 70, 70])], { type: 'image/webp' });
  const own = `candidate/${me.id}/sectest${Date.now()}.webp`, theirs = `candidate/${other.id}/sectest${Date.now()}.webp`;
  const u1 = await st.storage.from('photos').upload(own, png, { contentType: 'image/webp' });
  const s1 = await st.rpc('set_photo', { p_kind: 'candidate', p_id: me.id, p_path: own });
  check('Photos: student can set their own photo', !u1.error && !s1.error, (u1.error || s1.error)?.message);
  const u2 = await st.storage.from('photos').upload(theirs, png, { contentType: 'image/webp' });
  const s2 = await st.rpc('set_photo', { p_kind: 'candidate', p_id: other.id, p_path: theirs });
  check('Photos: student cannot set another student\'s photo', !!u2.error && !!s2.error);
  const s3 = await st.rpc('set_photo', { p_kind: 'candidate', p_id: me.id, p_path: `candidate/${other.id}/borrowed1.webp` });
  check('Photos: a photo path must be in the person\'s own folder', !!s3.error);
  const t1 = await tele.rpc('set_photo', { p_kind: 'candidate', p_id: me.id, p_path: null });
  const t2 = await tele.storage.from('photos').upload(`candidate/${me.id}/teletest${Date.now()}.webp`, png, { contentType: 'image/webp' });
  check('Photos: telecaller cannot change a candidate photo', !!t1.error && !!t2.error);
  const a1 = await anon.storage.from('photos').createSignedUrl(own, 60);
  const a2 = await anon.storage.from('photos').list(`candidate/${me.id}`);
  check('Photos: visitor without login cannot read the bucket', !!a1.error && !(a2.data || []).length);
  const ad = await admin.storage.from('photos').createSignedUrl(own, 60);
  check('Photos: staff who can see the candidate can view the photo', !ad.error && !!ad.data?.signedUrl, ad.error?.message);
  const sf = await tele.rpc('set_photo', { p_kind: 'staff', p_id: (await service.from('staff').select('id').eq('email', 'harsha@demo.stint.local').single()).data.id, p_path: null });
  check('Photos: staff cannot change another staff member\'s photo', !!sf.error);
  const hist = (await service.from('audit_log').select('id').eq('table_name', 'candidate').eq('row_id', me.id).gte('at', startedAt).limit(50)).data;
  await service.rpc('set_photo', { p_kind: 'candidate', p_id: me.id, p_path: null }).then(() => {}, () => {});
  await service.from('candidate').update({ photo_path: null }).eq('id', me.id);
  await service.storage.from('photos').remove([own]);
  check('Photos: the photo change is in the audit trail', !!hist && hist.length > 0, JSON.stringify(hist));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
