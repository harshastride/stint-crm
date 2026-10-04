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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
