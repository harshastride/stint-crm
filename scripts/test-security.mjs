// Checks that the database, not just the screen, enforces roles. Run after seeding: node scripts/test-security.mjs
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
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
  const r = await mkt.from('lead').update({ city: 'Hacked' }).eq('id', one.id).select();
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
  const mv = await sales.from('lead').update({ stage: 'Converted' }).eq('id', r.data.id).select();
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
  const pv = await hr.rpc('candidate_private_get', { cid: c[0].id });
  check('Mobile carried over to the candidate', pv.data?.contact?.mobile === mobile);
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
  const upd = await pooja.from('lead').update({ city: 'X' }).eq('id', theirs.id).select();
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
  await admin.from('lead').update({ stage: 'Interested' }).eq('id', nl.id);
  const after = (await admin.from('lead').select('owner:owner_id(role)').eq('id', nl.id).single()).data;
  check('Lead marked Interested is handed to Sales by the rule', after?.owner?.role === 'Sales', JSON.stringify(after));
  await admin.from('lead').update({ stage: 'Converted' }).eq('id', nl.id);
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
    const row = (await admin.from('lead').select('id, owner_id, source:source_id(name), marketing_consent, program:program_id(name)').eq('mobile', m2).single()).data;
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
    const st = await api('POST', 'stage', { mobile: m3, stage: 'Interested' });
    const stBad = await api('POST', 'stage', { mobile: m3, stage: 'Nonsense' });
    const found = await api('GET', 'find?mobile=' + m3);
    const lr = (await admin.from('lead').select('stage').eq('id', nl.id).single()).data;
    check('Block actions: note, follow-up, stage, find', note.status === 201 && fu.status === 201 && st.status === 200 && stBad.status === 400 && lr.stage === 'Interested' && found.json.kind === 'lead', JSON.stringify([note.json, fu.json, st.json, found.json]).slice(0, 300));
    const det = await api('GET', 'lead-details?lead_id=' + nl.id);
    check('Get lead details: calls, stage and the owner’s head', det.status === 200 && det.json.called === false && det.json.calls_count === 0 && det.json.owner_role === 'Sales' && 'owner_head_email' in det.json, JSON.stringify(det.json).slice(0, 200));
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
    const leadMobile = (await admin.from('lead').select('mobile').eq('id', myLead.id).single()).data.mobile;
    const form = (consent) => { const f = new FormData(); f.append('audio', new Blob(['fake'], { type: 'audio/mp4' }), 'call.m4a'); f.append('staff_email', 'teja@demo.stint.local'); f.append('number', '+91' + leadMobile); f.append('duration_sec', '42'); f.append('direction', 'out'); if (consent) f.append('consent', 'yes'); return f; };
    const bad = await fetch('http://localhost:3100/api/recordings/upload', { method: 'POST', headers: { 'x-api-key': 'nope' }, body: form(true) }).then((x) => x.status);
    const noC = await fetch('http://localhost:3100/api/recordings/upload', { method: 'POST', headers: { 'x-api-key': key }, body: form(false) }).then((x) => x.status);
    const ok = await fetch('http://localhost:3100/api/recordings/upload', { method: 'POST', headers: { 'x-api-key': key }, body: form(true) }).then(async (x) => ({ status: x.status, json: await x.json() }));
    check('Phone app upload needs the key and consent', bad === 401 && noC === 400);
    const pr = ok.json.recording_id && (await svc.from('recording').select('lead_id, audio_path, source').eq('id', ok.json.recording_id).single()).data;
    check('Phone app upload is stored and matched to the lead by number', ok.status === 201 && pr?.lead_id === myLead.id && !!pr?.audio_path, JSON.stringify(ok.json));
    if (pr?.audio_path) await svc.storage.from('recordings').remove([pr.audio_path]);
    if (ok.json.recording_id) await svc.from('recording').delete().eq('id', ok.json.recording_id);
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
  await svc.from('candidate').update({ stage: 'Placed' }).eq('id', c.id);
  const locked = await st.rpc('portal_save', { p_profile: { x: 1 }, p_education: null, p_experience: null, p_private: {} });
  check('Details are locked once the student moves past Training', !!locked.error);
  await svc.auth.admin.deleteUser(u.id); await svc.from('candidate').delete().eq('id', c.id); }

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

// remove the people this run created, then the events it raised (test records must not reach Activepieces)
{ const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  await svc.from('candidate').delete().eq('full_name', 'Test Walkin').gte('created_at', startedAt);
  await svc.from('notification').delete().gte('created_at', startedAt);
  await svc.from('lead').delete().in('full_name', ['Test Walkin', 'Rule Test', 'Event Test', 'Meta Lead', 'Unknown Caller', 'Block Lead']).gte('created_at', startedAt); }
await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).from('integration_event').delete().gte('created_at', startedAt);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
