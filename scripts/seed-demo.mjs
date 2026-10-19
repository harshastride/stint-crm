// Creates the demo logins (one per role) and sample people so every page has something to show.
// Safe to run more than once. Uses the service key, so run it only on your own machine or server.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = { ...Object.fromEntries(
  (() => { try { return fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8'); } catch { return ''; } })().split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
), ...process.env };
const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local'); process.exit(1); }
// Demo people must never land in the live CRM: refuse anything but a local database unless forced on purpose.
if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)(:\d+)?/.test(url) && !process.argv.includes('--i-know-this-is-not-production')) {
  console.error(`Refusing to seed demo data into ${url}: this is not a local database. Demo data is for your own machine only.`);
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const PASSWORD = env.DEMO_PASSWORD || 'stint-demo-1234';
const DOMAIN = 'demo.stint.local';

const must = async (p, what) => { const { data, error } = await p; if (error) { console.error('FAILED:', what, '-', error.message); process.exit(1); } return data; };
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const at = (n, h = 10, m = 0) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d.toISOString(); };

const { count } = await db.from('lead').select('id', { count: 'exact', head: true });
const hasData = (count || 0) > 0;

// ---- 1. Staff: one login per role -------------------------------------------------
const STAFF = [
  ['Harsha', 'harsha', 'Admin', 'Head'], ['Anita R', 'anita', 'Front desk', 'Junior'], ['Divya', 'divya', 'Marketing', 'Junior'],
  ['Teja', 'teja', 'Telecaller', 'Head'], ['Pooja', 'pooja', 'Telecaller', 'Junior'], ['Manish', 'manish', 'Sales', 'Junior'],
  ['Praveen', 'praveen', 'HR / Counsellor', 'Head'], ['Kiran', 'kiran', 'Trainer', 'Head'], ['Nikhil', 'nikhil', 'Trainer', 'Junior'],
  ['Hemanth', 'hemanth', 'SME', 'Junior'], ['Lakshmi', 'lakshmi', 'Placement', 'Junior'], ['Suresh', 'suresh', 'Finance', 'Junior'],
];
const branches = await must(db.from('branch').select('id,name'), 'read branches');
const hsr = branches.find((b) => b.name === 'HSR Layout')?.id;
const existing = (await must(db.auth.admin.listUsers({ page: 1, perPage: 200 }), 'list users')).users;
const S = {};
for (const [name, login, role, level] of STAFF) {
  const email = `${login}@${DOMAIN}`;
  let user = existing.find((u) => u.email === email);
  if (!user) user = (await must(db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true }), 'create ' + email)).user;
  await must(db.from('staff').upsert({ id: user.id, full_name: name, email, role, level, branch_id: hsr, status: 'Active', tour_done_at: new Date().toISOString() }), 'staff ' + name);   // demo logins skip the first-time tour
  S[name] = user.id;
}
console.log(`Staff ready: ${STAFF.length} logins, password "${PASSWORD}"`);
if (hasData) { console.log('Sample records already exist, leaving them alone.'); process.exit(0); }

// ---- 2. Reference data ------------------------------------------------------------
const P = Object.fromEntries((await must(db.from('program').select('id,name,fee'), 'programs')).map((p) => [p.name, p]));
const SRC = Object.fromEntries((await must(db.from('lead_source').select('id,name'), 'sources')).map((s) => [s.name, s.id]));
const campaigns = await must(db.from('campaign').insert([
  { name: 'Data Eng Oct batch', channel: 'Meta ads', status: 'Live', budget: 30000 }, { name: 'SAP free webinar', channel: 'Google', status: 'Live', budget: 18000 },
  { name: 'Alumni referral', channel: 'Referral', status: 'Live', budget: 5000 }, { name: 'College drive Pune', channel: 'Offline', status: 'Planned', budget: 12000 },
  { name: 'AI/ML YouTube', channel: 'YouTube', status: 'Paused', budget: 11600 },
]).select(), 'campaigns');
const batches = Object.fromEntries((await must(db.from('batch').insert([
  { code: 'DE-14', program_id: P['Data Engineering'].id, trainer_id: S.Kiran, branch_id: hsr, starts_on: day(-70), status: 'Live' },
  { code: 'DE-13', program_id: P['Data Engineering'].id, trainer_id: S.Kiran, branch_id: hsr, starts_on: day(-110), status: 'Live' },
  { code: 'SAP-07', program_id: P['SAP FICO'].id, trainer_id: S.Nikhil, branch_id: hsr, starts_on: day(-50), status: 'Live' },
  { code: 'AI-05', program_id: P['AI/ML'].id, trainer_id: S.Hemanth, branch_id: hsr, starts_on: day(-90), status: 'Live' },
  { code: 'PY-21', program_id: P['Python'].id, trainer_id: S.Nikhil, branch_id: hsr, starts_on: day(-20), status: 'Live' },
]).select(), 'batches')).map((b) => [b.code, b.id]));
const companies = Object.fromEntries((await must(db.from('company').insert([
  { name: 'Maersk', openings: 5, contact: 'HR team', status: 'Client' }, { name: 'Deloitte', openings: 3, contact: 'TA lead', status: 'Client' },
  { name: 'Fractal', openings: 2, contact: 'Recruiter', status: 'Client' }, { name: 'Capgemini', openings: 1, contact: 'Recruiter', status: 'Client' },
  { name: 'Infosys', openings: 0, contact: null, status: 'Prospect' },
]).select(), 'companies')).map((c) => [c.name, c.id]));

// ---- 3. Leads ----------------------------------------------------------------------
const LEADS = [
  ['Ravi Kumar', '9800000214', 'Data Engineering', 'New', 'Teja', 'Meta lead form', 0],
  ['Sneha P', '9000000877', 'SAP FICO', 'Interested', 'Teja', 'Website form', 0],
  ['Arjun Rao', '9900000031', 'AI/ML', 'Callback', 'Pooja', 'Google lead form', 0],
  ['Meena S', '9800000310', 'Python', 'Counselling', 'Manish', 'Walk-in / phone', 1],
  ['Deepak N', '9700000562', 'SAP FICO', 'Counselling', 'Manish', 'Meta lead form', 3],
  ['Anil V', '9600000108', 'Data Engineering', 'Counselling', 'Manish', 'Alumni referral link', 2],
  ['Karthik T', '9500000449', 'Data Engineering', 'Not interested', 'Teja', 'Meta lead form', -1],
];
const L = {};
for (const [name, mobile, prog, stage, owner, src, next] of LEADS) {
  const row = await must(db.from('lead').insert({
    full_name: name, mobile, email: name.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com', city: 'Bengaluru', program_id: P[prog].id, stage,
    owner_id: S[owner], source_id: SRC[src], campaign_id: campaigns[0].id, preferred_mode: 'Hybrid', currently: 'Working',
    next_call_at: next >= 0 ? at(next, 10 + next) : null, created_by: S['Anita R'],
  }).select().single(), 'lead ' + name);
  L[name] = row.id;
}
// Today's calls: if the seed runs early in the morning, move them back so none is in the future
const todayCalls = [
  { lead_id: L['Ravi Kumar'], caller_id: S.Teja, outcome: 'No answer', duration_sec: 0, called_at: at(0, 9, 31) },
  { lead_id: L['Sneha P'], caller_id: S.Teja, outcome: 'Interested', duration_sec: 252, notes: 'Wants weekend batch', called_at: at(0, 10, 2) },
  { lead_id: L['Arjun Rao'], caller_id: S.Pooja, outcome: 'Callback', duration_sec: 90, called_at: at(0, 10, 20) },
  { lead_id: L['Meena S'], caller_id: S.Teja, outcome: 'Booked counselling', duration_sec: 365, called_at: at(0, 10, 45) },
  { lead_id: L['Karthik T'], caller_id: S.Teja, outcome: 'Not interested', duration_sec: 130, called_at: at(0, 11, 0) },
];
{ const late = Math.max(...todayCalls.map((c) => Date.parse(c.called_at))) - (Date.now() - 5 * 60000);
  if (late > 0) for (const c of todayCalls) c.called_at = new Date(Date.parse(c.called_at) - late).toISOString(); }
await must(db.from('call_log').insert(todayCalls), 'call logs');
await must(db.from('counselling_session').insert([
  { lead_id: L['Meena S'], counsellor_id: S.Manish, program_id: P['Python'].id, status: 'Booked', scheduled_at: at(1, 11) },
  { lead_id: L['Deepak N'], counsellor_id: S.Manish, program_id: P['SAP FICO'].id, status: 'Done', scheduled_at: at(-2, 15) },
  { lead_id: L['Anil V'], counsellor_id: S.Manish, program_id: P['Data Engineering'].id, status: 'Done', scheduled_at: at(-3, 12) },
]), 'counselling');
await must(db.from('fee_quote').insert([
  { lead_id: L['Deepak N'], program_id: P['SAP FICO'].id, list_price: 65000, discount_pct: 5, amount: 0, status: 'Sent', valid_until: day(5), created_by: S.Manish },
  { lead_id: L['Anil V'], program_id: P['Data Engineering'].id, list_price: 60000, discount_pct: 8, amount: 0, status: 'Negotiating', valid_until: day(3), created_by: S.Manish },
]), 'quotes');
await must(db.from('sales_target').insert([{ staff_id: S.Manish, month: day(0).slice(0, 8) + '01', target: 60 }]), 'targets');
await must(db.from('note').insert([
  { lead_id: L['Ravi Kumar'], kind: 'Note', body: 'Prefers evening calls', by_id: S.Teja },
  { lead_id: L['Meena S'], kind: 'Note', body: 'Works in accounts, wants to move to data', by_id: S.Manish },
]), 'lead notes');

// India time (Asia/Kolkata, UTC+5:30) n days ago at h:m, as an ISO time
const ist = (n, h, m = 0) => { const d = new Date(Date.now() + 330 * 60000); d.setUTCDate(d.getUTCDate() - n);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m) - 330 * 60000).toISOString(); };
const istDow = (n) => { const d = new Date(Date.now() + 330 * 60000); d.setUTCDate(d.getUTCDate() - n); return d.getUTCDay(); };
let seedNo = 7; const rnd = () => ((seedNo = (seedNo * 16807) % 2147483647) - 1) / 2147483646;   // same numbers on every run
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const addLead = async (name, mobile, prog, stage, owner, src, extra = {}) => {
  const row = await must(db.from('lead').insert({
    full_name: name, mobile, email: name.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com', city: 'Bengaluru', program_id: P[prog].id, stage,
    owner_id: S[owner], source_id: SRC[src] ?? null, preferred_mode: 'Hybrid', currently: 'Working', created_by: S['Anita R'], ...extra,
  }).select('id').single(), 'lead ' + name);
  return row.id;
};

// ---- 3a. Calling history: 5 weeks of calls by the telecallers (Staff scorecard trends, pickup hours, lead scores) ----
// Leads that came in over the last 5 weeks; each was called a few times after it came in. Mostly 10 am–1 pm and 6–8 pm India time.
const HIST = [
  ['Rahul J', 'Data Engineering', 'Teja', 'Meta lead form', 34, 'Interested'], ['Nandini K', 'SAP FICO', 'Teja', 'Website form', 31, 'Callback'],
  ['Prakash B', 'AI/ML', 'Teja', 'Google lead form', 27, 'Not interested'], ['Fathima Z', 'Python', 'Teja', 'Meta lead form', 23, 'Interested'],
  ['Vinay R', 'Azure DE', 'Teja', 'YouTube link', 18, 'Callback'], ['Harini M', 'Data Engineering', 'Teja', 'Website form', 12, 'New'],
  ['Gopal S', 'SAP FICO', 'Teja', 'Justdial', 8, 'Interested'], ['Shreya T', 'AI/ML', 'Teja', 'Meta lead form', 4, 'Callback'],
  ['Ajay P', 'Python', 'Pooja', 'Google lead form', 35, 'Not interested'], ['Bhavna N', 'Data Engineering', 'Pooja', 'Meta lead form', 30, 'Interested'],
  ['Mohan L', 'Azure DE', 'Pooja', 'Website form', 26, 'Callback'], ['Rekha V', 'SAP FICO', 'Pooja', 'Meta lead form', 21, 'Interested'],
  ['Salman S', 'AI/ML', 'Pooja', 'YouTube link', 15, 'New'], ['Kavitha R', 'Python', 'Pooja', 'Justdial', 10, 'Callback'],
  ['Naveen G', 'Data Engineering', 'Pooja', 'Website form', 6, 'Interested'], ['Lalitha D', 'SAP FICO', 'Pooja', 'Meta lead form', 2, 'Callback'],
];
const HOURS = [10, 10, 11, 11, 11, 12, 12, 13, 18, 18, 19, 19, 20, 15, 16];
const MIDDLE = ['No answer', 'No answer', 'No answer', 'Callback', 'Connected', 'Connected', 'Interested', 'No answer', 'Callback'];
const LAST = { 'Interested': 'Interested', 'Callback': 'Callback', 'Not interested': 'Not interested', 'New': 'No answer' };
const NOTES = { 'Interested': 'Asked about weekend batch and instalments', 'Callback': 'Busy at work, call in the evening', 'Not interested': 'Fee is more than planned', 'Connected': 'Shared course details' };
const history = [];
let hn = 0;
for (const [name, prog, owner, src, ago, stage] of HIST) {
  hn += 1;
  const id = await addLead(name, '97000001' + String(hn).padStart(2, '0'), prog, stage, owner, src, {
    created_at: ist(ago, 9, 30), lost_reason: stage === 'Not interested' ? 'Fee too high' : null,
    next_call_at: stage === 'Callback' || stage === 'Interested' ? at(1 + (hn % 3), 11 + (hn % 2) * 7) : null,
  });
  const tries = 2 + Math.floor(rnd() * 5);   // 2–6 calls over the days after the lead came in
  let last = null;
  for (let i = 0; i < tries; i++) {
    let n = ago - Math.floor((i * ago) / tries);
    if (n < 0) n = 0;
    if (istDow(n) === 0 && n > 0) n -= 1;      // nobody calls on Sunday
    const outcome = i === tries - 1 ? LAST[stage] : pick(MIDDLE);
    const answered = !['No answer', 'Wrong number'].includes(outcome);
    const calledAt = ist(n, pick(HOURS), Math.floor(rnd() * 60));
    if (n === 0 && calledAt > new Date().toISOString()) continue;   // not in the future
    history.push({ lead_id: id, caller_id: S[owner], outcome, duration_sec: answered ? 40 + Math.floor(rnd() * 400) : 0,
      notes: answered && rnd() < 0.5 ? NOTES[outcome] ?? null : null, called_at: calledAt });
    last = calledAt;
  }
  if (last) await must(db.from('lead').update({ stage_changed_at: last }).eq('id', id), 'history stage date ' + name);
}
// Extra unanswered and short calls spread over the weeks (real calling days have many of these)
for (let n = 34; n >= 1; n--) {
  if (istDow(n) === 0) continue;
  for (const owner of ['Teja', 'Pooja']) {
    const mine = HIST.map((h, i) => [h, i]).filter(([h]) => h[2] === owner && h[4] >= n && h[5] !== 'Not interested');
    if (!mine.length) continue;
    for (let k = 0; k < 1 + Math.floor(rnd() * 3); k++) {
      const [, i] = pick(mine);
      const outcome = pick(['No answer', 'No answer', 'Connected', 'Callback', 'No answer']);
      history.push({ lead_id: null, _i: i, caller_id: S[owner], outcome, duration_sec: outcome === 'No answer' ? 0 : 30 + Math.floor(rnd() * 180),
        called_at: ist(n, pick(HOURS), Math.floor(rnd() * 60)) });
    }
  }
}
const histIds = (await must(db.from('lead').select('id, full_name').in('full_name', HIST.map((h) => h[0])), 'history leads'));
const byName = Object.fromEntries(histIds.map((r) => [r.full_name, r.id]));
await must(db.from('call_log').insert(history.map(({ _i, ...c }) => ({ ...c, lead_id: c.lead_id ?? byName[HIST[_i][0]] }))), 'call history');

// ---- 3b. Win-back: leads lost or gone quiet more than 60 days ago (setting winback_after_days) ----------------
const WB = [
  // name, course, owner, source, days since, stage, lost reason, last call note
  ['Rohit M', 'SAP FICO', 'Teja', 'Meta lead form', 75, 'Not interested', 'Fee too high', 'Said the fee is more than his budget'],
  ['Kavya S', 'Data Engineering', 'Pooja', 'Website form', 92, 'Not interested', 'Timing not right', 'Exams till next month, try after that'],
  ['Farhan A', 'AI/ML', 'Manish', 'Google lead form', 68, 'Not interested', 'Joined another institute', 'Joined a cheaper online course'],
  ['Lata V', 'Python', 'Teja', 'Justdial', 70, 'Callback', null, null],
  ['Sandeep K', 'Azure DE', 'Pooja', 'Meta lead form', 104, 'Interested', null, 'Liked the course, asked to call after his appraisal'],
];
let wn = 0;
for (const [name, prog, owner, src, ago, stage, reason, note] of WB) {
  wn += 1;
  const id = await addLead(name, '96000002' + String(wn).padStart(2, '0'), prog, stage, owner, src, { created_at: ist(ago + 6, 10), lost_reason: reason });
  await must(db.from('call_log').insert({ lead_id: id, caller_id: S[owner], outcome: stage === 'Callback' ? 'No answer' : stage,
    duration_sec: stage === 'Callback' ? 0 : 180, notes: note, called_at: ist(ago, 11, 20) }), 'win-back call ' + name);
  await must(db.from('lead').update({ stage_changed_at: ist(ago, 11, 25) }).eq('id', id), 'win-back date ' + name);
}

// ---- 3c. New conversations: a WhatsApp from a number we do not know, and a missed call (becomes a lead) ---------
await must(db.rpc('capture_inbound', { p_channel: 'whatsapp', p_number: '919800000901', p_profile_name: 'Nisha',
  p_body: 'Hi, is there a weekend batch for Data Engineering? What is the fee?', p_at: at(0, 9, 12) }), 'demo WhatsApp conversation');
await must(db.rpc('capture_inbound', { p_channel: 'missed_call', p_number: '919800000902', p_at: at(0, 8, 47) }), 'demo missed call');

// ---- 4. Candidates -----------------------------------------------------------------
const CANDS = [
  ['Priya Reddy', 'Data Engineering', 'DE-14', 'Resume', 60000, [[20000, 'Received', -33], [20000, 'Due', 1], [20000, 'Due', 31]]],
  ['Lavanya G', 'Data Engineering', 'DE-14', 'Training', 60000, [[20000, 'Received', -40], [20000, 'Received', -10], [20000, 'Due', 20]]],
  ['Vikas N', 'SAP FICO', 'SAP-07', 'Mocks', 65000, [[25000, 'Received', -30], [20000, 'Due', 6]]],
  ['Asha K', 'Data Engineering', 'DE-13', 'Docs', 60000, [[30000, 'Received', -80], [30000, 'Received', -50]]],
  ['Nitin S', 'AI/ML', 'AI-05', 'Ready', 70000, [[70000, 'Received', -85]]],
  ['Manoj D', 'AI/ML', 'AI-05', 'Placed', 70000, [[35000, 'Received', -88], [35000, 'Received', -58]]],
  ['Rakesh B', 'Data Engineering', 'DE-13', 'Training', 60000, [[20000, 'Received', -90], [20000, 'Overdue', -21], [20000, 'Due', 9]]],
  ['Swathi L', 'SAP FICO', 'SAP-07', 'Placed', 65000, [[50000, 'Received', -45], [15000, 'Due', 6]]],
  ['Geetha N', 'Python', 'PY-21', 'Placed', 22000, [[14500, 'Received', -15], [7500, 'Due', 1]]],
  ['Imran K', 'Data Engineering', 'DE-13', 'Alumni', 60000, [[60000, 'Received', -200]]],
];
const C = {};
let n = 401;
for (const [name, prog, batch, stage, total, pays] of CANDS) {
  const row = await must(db.from('candidate').insert({
    code: 'STA-2026-0' + n++, full_name: name, program_id: P[prog].id, batch_id: batches[batch], stage, poc_id: S.Praveen, joined_on: day(-95),
    profile: { date_of_birth: '1995-03-14', marital_status: 'Single', referred_by: '' },
    education: [{ level: 'Degree', institution: '[College name]', board: 'JNTU', course: 'B.Tech', years: '2013 – 2017' }],
    experience: [],
  }).select().single(), 'candidate ' + name);
  C[name] = row.id;
  const first = name.split(' ')[0].toLowerCase();
  await must(db.from('candidate_private').insert({
    candidate_id: row.id,
    contact: { mobile: '98000' + String(10000 + n).slice(0, 5), email: first + '@example.com', city: 'Bengaluru', address: '12, 3rd Cross, HSR Layout' },
    family: { father: '[Father name]', father_mobile: '9900000000' },
    identity: { pan: 'ABCPR1234K', aadhaar: '452188905678' },
    bank: { bank: 'State Bank of India', account: '30214458214521', ifsc: 'SBIN0000000' },
  }), 'private ' + name);
  await must(db.from('fee_plan').insert({ candidate_id: row.id, total, plan: pays.length === 1 ? 'Full payment' : pays.length + ' instalments' }), 'plan ' + name);
  // the plan creates its own due instalments; the sample history below replaces them
  await must(db.from('fee_payment').delete().eq('candidate_id', row.id), 'clear generated ' + name);
  await must(db.from('fee_payment').insert(pays.map(([amount, status, d], i) => ({
    candidate_id: row.id, amount, status, due_on: day(d), paid_on: status === 'Received' ? day(d) : null,
    mode: status === 'Received' ? ['UPI', 'Card', 'Bank'][i % 3] : null, receipt_no: status === 'Received' ? 'R-' + (1000 + n * 3 + i) : null, created_by: S.Suresh,
  }))), 'payments ' + name);
}
const marks = { 'Lavanya G': 'PPPPPP', 'Priya Reddy': 'PPAPPP', 'Rakesh B': 'APAAPP', 'Asha K': 'PPPPLP' };
const att = [];
for (const [name, m] of Object.entries(marks)) [...m].forEach((mark, i) => att.push({ batch_id: batches[name === 'Lavanya G' || name === 'Priya Reddy' ? 'DE-14' : 'DE-13'], candidate_id: C[name], day: day(i - 6), mark, marked_by: S.Kiran }));
await must(db.from('attendance').insert(att), 'attendance');
await must(db.from('training_note').insert([
  { candidate_id: C['Lavanya G'], trainer_id: S.Kiran, note: 'Strong in SQL, weak in Spark joins', flag: 'On track' },
  { candidate_id: C['Vikas N'], trainer_id: S.Nikhil, note: 'Missing GL posting basics', flag: 'Needs help' },
  { candidate_id: C['Rakesh B'], trainer_id: S.Kiran, note: 'Absent 3 days', flag: 'At risk' },
]), 'training notes');
const mocks = await must(db.from('mock_session').insert([
  { candidate_id: C['Lavanya G'], trainer_id: S.Hemanth, level: 'L1', status: 'Booked', scheduled_at: at(2, 16) },
  { candidate_id: C['Vikas N'], trainer_id: S.Hemanth, level: 'L1', status: 'Failed', scheduled_at: at(-1, 15) },
  { candidate_id: C['Nitin S'], trainer_id: S.Nikhil, level: 'L2', status: 'Passed', scheduled_at: at(-6, 15) },
  { candidate_id: C['Priya Reddy'], trainer_id: S.Hemanth, level: 'L2', status: 'Passed', scheduled_at: at(-7, 15) },
  { candidate_id: C['Asha K'], trainer_id: S.Hemanth, level: 'L1', status: 'Passed', scheduled_at: at(-8, 15) },
]).select(), 'mocks');
await must(db.from('sme_feedback').insert([
  { candidate_id: C['Nitin S'], mock_session_id: mocks[2].id, sme_id: S.Hemanth, rating: 4, verdict: 'Ready', comments: 'Clear on pipelines' },
  { candidate_id: C['Vikas N'], mock_session_id: mocks[1].id, sme_id: S.Hemanth, rating: 2, verdict: 'Rebook', comments: 'Needs GL basics' },
  { candidate_id: C['Priya Reddy'], mock_session_id: mocks[3].id, sme_id: S.Hemanth, rating: 4, verdict: 'Ready', comments: 'Good SQL' },
]), 'sme feedback');
await must(db.from('resume_version').insert([
  { candidate_id: C['Asha K'], version: 'v1', reviewer_id: S.Kiran, status: 'Pending' },
  { candidate_id: C['Nitin S'], version: 'v2', reviewer_id: S.Praveen, status: 'Approved' },
  { candidate_id: C['Priya Reddy'], version: 'v3', reviewer_id: S.Praveen, status: 'Rejected', reason: 'Format and project dates' },
]), 'resumes');
await must(db.from('candidate_document').insert([
  { candidate_id: C['Asha K'], doc_type: 'Degree certificate', status: 'Missing' },
  { candidate_id: C['Priya Reddy'], doc_type: 'PAN', status: 'Verified', verified_by: S.Praveen, verified_at: at(-6) },
  { candidate_id: C['Nitin S'], doc_type: 'Photo ID', status: 'Verified', verified_by: S.Praveen, verified_at: at(-7) },
  { candidate_id: C['Vikas N'], doc_type: 'Photo ID', status: 'Missing' },
]), 'documents');
await must(db.from('vendor_request').insert([
  { candidate_id: C['Priya Reddy'], vendor: 'ResumeCo', request: 'Resume rewrite', status: 'In progress', due_on: day(3), created_by: S.Praveen },
  { candidate_id: C['Asha K'], vendor: 'CheckFast', request: 'Background check', status: 'Open', due_on: day(5), created_by: S.Praveen },
]), 'vendor requests');
await must(db.from('placement').insert([
  { candidate_id: C['Manoj D'], company_id: companies.Fractal, role: 'ML Engineer', ctc_lpa: 9.5, joining_on: day(11), status: 'Joining soon' },
  { candidate_id: C['Swathi L'], company_id: companies.Deloitte, role: 'SAP Consultant', ctc_lpa: 8.2, joining_on: day(3), status: 'Joining soon' },
  { candidate_id: C['Geetha N'], company_id: companies.Capgemini, role: 'Python Developer', ctc_lpa: 5.4, joining_on: day(16), status: 'Joining soon' },
  { candidate_id: C['Imran K'], company_id: companies.Maersk, role: 'Data Engineer', ctc_lpa: 8.4, joining_on: day(-120), status: 'Joined' },
]), 'placements');
await must(db.from('placement_checklist_item').insert([
  { candidate_id: C['Manoj D'], item: 'Background check', owner_id: S.Lakshmi, status: 'Pending', due_on: day(6) },
  { candidate_id: C['Swathi L'], item: 'Offer letter signed', owner_id: S.Lakshmi, status: 'Done' },
  { candidate_id: C['Geetha N'], item: 'Relieving letter', owner_id: S.Lakshmi, status: 'Pending', due_on: day(8) },
]), 'checklist');
await must(db.from('alumni_followup').insert([{ candidate_id: C['Imran K'], note: 'Doing well, will refer two friends', referrals: 2, by_id: S.Lakshmi }]), 'alumni');
await must(db.from('follow_up').insert([
  { title: 'Call back', lead_id: L['Ravi Kumar'], owner_id: S.Teja, owner_role: 'Telecaller', due_at: at(0, 14) },
  { title: 'Call back', lead_id: L['Arjun Rao'], owner_id: S.Pooja, owner_role: 'Telecaller', due_at: at(0, 11, 15) },
  { title: 'Follow up on quote', lead_id: L['Deepak N'], owner_id: S.Manish, owner_role: 'Sales', due_at: at(-1) },
  { title: 'Send the fee quote', lead_id: L['Meena S'], owner_id: S.Manish, owner_role: 'Sales', due_at: at(1) },
  { title: 'Fix resume format and resubmit', candidate_id: C['Priya Reddy'], owner_id: S.Praveen, owner_role: 'HR / Counsellor', due_at: at(-1) },
  { title: 'Rebook the failed mock', candidate_id: C['Vikas N'], owner_id: S.Praveen, owner_role: 'HR / Counsellor', due_at: at(-2) },
  { title: 'Chase overdue instalment', candidate_id: C['Rakesh B'], owner_id: S.Suresh, owner_role: 'Finance', due_at: at(-3) },
  { title: 'Weekly progress note', candidate_id: C['Lavanya G'], owner_id: S.Kiran, owner_role: 'Trainer', due_at: at(0) },
  { title: 'Collect degree certificate', candidate_id: C['Asha K'], owner_id: S['Anita R'], owner_role: 'Front desk', due_at: at(0) },
  { title: 'Review L1 mock', candidate_id: C['Lavanya G'], owner_id: S.Hemanth, owner_role: 'SME', due_at: at(2, 16) },
  { title: 'Put forward to companies', candidate_id: C['Nitin S'], owner_id: S.Lakshmi, owner_role: 'Placement', due_at: at(3) },
]), 'follow-ups');
// Alerts are raised by the database from the sample data (raise_alerts, also run every 15 minutes)
await must(db.rpc('raise_alerts'), 'alerts');
await must(db.from('note').insert([
  { candidate_id: C['Priya Reddy'], kind: 'Resume', body: 'Resume sent to vendor', by_id: S.Praveen },
  { candidate_id: C['Lavanya G'], kind: 'Training', body: 'Asked for extra Spark session', by_id: S.Kiran },
]), 'candidate notes');
// Sales playbook: what Live help may suggest during a call (demo wording only; real facts are written by the Admin)
await must(db.from('playbook_item').insert([
  { kind: 'Selling point', title: 'Live projects on real company data in every course' },
  { kind: 'Selling point', title: 'Weekend and evening batches for working people' },
  { kind: 'Selling point', title: 'Free counselling session before joining' },
  { kind: 'Fact we can quote', title: 'Fees can be paid in 3 instalments' },
  { kind: 'Doubt and answer', title: 'The fee is too high', answer: 'You can pay in 3 instalments, and the course includes live projects and placement support.' },
  { kind: 'Doubt and answer', title: 'I am working and have no time', answer: 'We have weekend and evening batches made for working people.' },
  { kind: 'Doubt and answer', title: 'Is it online or classroom?', answer: 'Both: you can join in the classroom or live online.' },
  { kind: 'Never say', title: 'Guaranteed job or 100% placement' },
  { kind: 'Never say', title: 'Any discount above 10% without approval' },
]), 'playbook');
console.log(`Sample data ready: ${LEADS.length + HIST.length + WB.length + 1} leads (${history.length + WB.length + 5} calls), ${CANDS.length} candidates.`);
