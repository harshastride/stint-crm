// Copy the old CRM's data into this CRM.
//
//   infisical run --env=prod -- node scripts/migrate-legacy.mjs            practice run: everything, then cancelled (ROLLBACK)
//   infisical run --env=prod -- node scripts/migrate-legacy.mjs --commit   the real copy (once; refuses if data is already there)
//   … --commit --replace   switch-over day: removes everything an earlier copy added, then copies again (same transaction)
//
// Reads LEGACY_DATABASE_URL (read-only, never changed) and writes SUPABASE_DB_URL in ONE transaction: all or nothing.
// --commit first creates staff logins through Supabase Auth (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY);
// a practice run creates them inside the transaction so they vanish with it. Prints a report; no personal data in it.
// Mapping agreed with Harsha (2026-10-15): stages, enquiries -> leads (all), deleted rows skipped, roles below.
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const COMMIT = process.argv.includes('--commit'), REPLACE = process.argv.includes('--replace');
const { LEGACY_DATABASE_URL: SRC, SUPABASE_DB_URL: DST, SUPABASE_SERVICE_ROLE_KEY: KEY } = process.env;
const API = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/(rest|auth)\/v1\/?$/, '').replace(/\/+$/, '');   // the base address only
if (!SRC || !DST) { console.error('Needs LEGACY_DATABASE_URL and SUPABASE_DB_URL (run through infisical).'); process.exit(1); }
if (SRC === DST) { console.error('Source and target are the same database. Stopping.'); process.exit(1); }

// ---------- agreed mappings ----------
const STAGE = { SOURCED: 'Enrolled', SCREENING: 'Enrolled', TRAINING: 'Training', INCUBATION: 'Mocks', INTERVIEWING: 'Ready', PLACED: 'Placed', DROPPED: null };
const LEAD_STAGE = { NEW: 'New', CONTACTED: 'Callback', REGISTRATION_PENDING: 'Interested', CONVERTED: 'Converted', DROPPED: 'Not interested' };
const ROLE = { ADMIN: ['Admin', 'Junior'], DIRECTOR: ['Admin', 'Head'], HR: ['HR / Counsellor', 'Junior'], POC: ['HR / Counsellor', 'Junior'],
  RECRUITER: ['Placement', 'Junior'], TRAINER: ['Trainer', 'Junior'], MOCK_TRAINER: ['Trainer', 'Junior'],
  SME: ['SME', 'Junior'], JUNIOR_SME: ['SME', 'Junior'], SENIOR_SME: ['SME', 'Head'] };
const ROLE_ORDER = ['DIRECTOR', 'ADMIN', 'SENIOR_SME', 'HR', 'POC', 'RECRUITER', 'TRAINER', 'MOCK_TRAINER', 'SME', 'JUNIOR_SME'];
const SOURCE = { WEBSITE: 'Website form', WALK_IN: 'Walk-in / phone', 'WALK-IN': 'Walk-in / phone', PHONE: 'Walk-in / phone', REFERRAL: 'Referral', INSTAGRAM: 'Instagram', NAUKRI: 'Naukri' };
const NEW_SOURCE_TYPE = { Referral: 'Referral', Instagram: 'Organic', Naukri: 'Paid' };
const PAY_MODE = { UPI: 'UPI', CARD: 'Card', NEFT: 'Bank', IMPS: 'Bank', RTGS: 'Bank', BANK: 'Bank', CHEQUE: 'Bank', CASH: 'Cash' };

// ---------- helpers ----------
const report = []; const skipped = [];
const note = (what, n) => report.push([what, n]);
const skip = (what, why) => skipped.push(`${what}: ${why}`);
const mobile10 = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : null; };
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ''));
const name2 = (a, b) => [a, b].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const isTest = (s) => /^test\d*$/i.test(String(s || '').trim());

const src = new pg.Client({ connectionString: SRC, ssl: { rejectUnauthorized: false } });
const dst = new pg.Client({ connectionString: DST, ssl: /localhost|127\.0\.0\.1/.test(DST) ? false : { rejectUnauthorized: false } });
await src.connect(); await dst.connect();
await src.query('set default_transaction_read_only = on');   // the old CRM is only ever read
const S = async (sql, p) => (await src.query(sql, p)).rows;
const D = async (sql, p) => (await dst.query(sql, p)).rows;
const one = async (sql, p) => (await D(sql, p))[0];

// refuse to run twice into the same database
const already = await one(`select (select count(*) from public.legacy_map)::int n`);
if (already.n > 0 && !REPLACE) { console.error(`The target already has ${already.n} migrated records. Stopping (it would duplicate them). Use --replace to redo the copy.`); process.exit(1); }

// ---------- 1. staff (logins) ----------
const users = await S(`select u.id, u.email, u.full_name, u.is_active,
    coalesce(array_agg(r.name) filter (where r.name is not null), '{}') roles
  from "user" u left join user_role ur on ur.user_id = u.id and ur.is_active and ur.deleted_at is null left join role r on r.id = ur.role_id
  where u.deleted_at is null group by u.id`);
const staffPlan = [];
for (const u of users) {
  const roles = u.roles.filter((r) => !isTest(r)).map((r) => r.toUpperCase());
  const top = ROLE_ORDER.find((r) => roles.includes(r));
  if (!top) { skip(`user #${u.id}`, roles.length ? `role ${roles.join('/')} has no match` : 'no role'); continue; }
  staffPlan.push({ old: u.id, email: String(u.email).trim().toLowerCase(), name: u.full_name, role: ROLE[top][0], level: ROLE[top][1], active: u.is_active });
}

// logins: real ones through Supabase Auth for --commit (so they can set a password), throw-away ones in a practice run
const loginId = new Map();
if (COMMIT) {
  if (!API || !KEY) { console.error('--commit needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }
  const auth = createClient(API, KEY, { auth: { persistSession: false, autoRefreshToken: false } }).auth.admin;
  const existing = []; for (let page = 1; ; page++) { const { data } = await auth.listUsers({ page, perPage: 1000 }); existing.push(...data.users); if (data.users.length < 1000) break; }
  for (const s of staffPlan) {
    let u = existing.find((x) => x.email === s.email);
    if (!u) {
      const { data, error } = await auth.createUser({ email: s.email, email_confirm: true, password: randomBytes(24).toString('base64url') });
      if (error) { skip(`staff ${s.email.replace(/^(.).*@/, '$1…@')}`, error.message); continue; }
      u = data.user;
    }
    loginId.set(s.old, u.id);
  }
  const failed = staffPlan.filter((s) => !loginId.has(s.old)).length;
  if (failed) {   // without staff, owners/trainers/"recorded by" would be lost: stop before touching any data
    console.error(`\nSTOPPED before copying anything: ${failed} staff login(s) could not be created.`);
    for (const x of skipped) console.error('  - ' + x);
    process.exit(1);
  }
}

await dst.query('begin');
try {
  await dst.query(`select set_config('stint.system_job', 'on', true)`);   // system work: the "only the assignee decides" rule lets it through
  if (REPLACE && already.n > 0) {   // remove what the earlier copy added (not into the Recycle bin); logins are kept and reused
    await dst.query(`select set_config('stint.no_bin', 'on', true)`);
    const ids = async (kind) => (await D(`select new_id from public.legacy_map where kind = $1`, [kind])).map((r) => r.new_id);
    const cands = await ids('candidate'), leadsOld = await ids('enquiry');
    await D(`delete from public.status_history where entity = 'candidate' and entity_id = any($1::uuid[])`, [cands]);
    await D(`delete from public.candidate where id = any($1::uuid[])`, [cands]);
    await D(`delete from public.lead where id = any($1::uuid[])`, [leadsOld]);
    await D(`delete from public.batch where id = any($1::uuid[]) and not exists (select 1 from public.candidate c where c.batch_id = batch.id)`, [await ids('batch')]);
    await D(`delete from public.company c where id = any($1::uuid[]) and not exists (select 1 from public.placement p where p.company_id = c.id)`, [await ids('company')]);
    await D(`delete from public.staff where id = any($1::uuid[])`, [await ids('user')]);
    await D(`delete from public.legacy_map`);
    await dst.query(`select set_config('stint.no_bin', 'off', true)`);
    note('Earlier copy removed first (--replace)', already.n + ' records');
  }
  const map = async (kind, oldId, newId) => dst.query('insert into public.legacy_map (kind, old_id, new_id) values ($1,$2,$3)', [kind, String(oldId), newId]);

  const staffId = new Map();
  for (const s of staffPlan) {
    let id = loginId.get(s.old);
    if (!COMMIT) id = (await one(`insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
      values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1, now(), now()) returning id`, [s.email])).id;
    if (!id) continue;
    await D(`insert into public.staff (id, full_name, email, role, level, status, must_change_password, tour_done_at)
      values ($1,$2,$3,$4,$5,$6,true,null)`, [id, s.name, s.email, s.role, s.level, s.active ? 'Invited' : 'Disabled']);
    staffId.set(s.old, id); await map('user', s.old, id);
  }
  note('Staff (they get an invite to set a password)', staffId.size);
  const sid = (v) => (v == null ? null : staffId.get(v) ?? null);

  // ---------- 2. batches, companies, lead sources ----------
  const batchId = new Map();
  for (const b of await S(`select * from batch where deleted_at is null`)) {
    const r = await one(`insert into public.batch (code, starts_on, ends_on, created_at) values ($1,$2,$3,$4)
      on conflict (code) do update set starts_on = excluded.starts_on returning id`, [b.name, b.start_date, b.end_date, b.created_at]);
    batchId.set(b.id, r.id); await map('batch', b.id, r.id);
  }
  note('Batches', batchId.size);

  const companyId = new Map(); const companyByName = new Map();
  const company = async (name) => {
    const n = String(name || '').trim(); if (!n) return null;
    if (companyByName.has(n.toLowerCase())) return companyByName.get(n.toLowerCase());
    const r = await one(`insert into public.company (name) values ($1) on conflict (name) do update set name = excluded.name returning id`, [n]);
    companyByName.set(n.toLowerCase(), r.id); return r.id;
  };
  for (const c of await S(`select * from company where deleted_at is null`)) { const id = await company(c.name); companyId.set(c.id, id); await map('company', c.id, id); }
  note('Companies', companyByName.size);

  const sourceByName = new Map((await D(`select id, name from public.lead_source`)).map((r) => [r.name, r.id]));
  const source = async (raw) => {
    if (!raw) return null;
    const key = String(raw).trim().toUpperCase();
    const name = SOURCE[key] || String(raw).trim().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    if (!sourceByName.has(name)) {
      const r = await one(`insert into public.lead_source (name, type, connection) values ($1,$2,'Manual') on conflict do nothing returning id`, [name, NEW_SOURCE_TYPE[name] || 'Offline']);
      sourceByName.set(name, r?.id ?? (await one(`select id from public.lead_source where name = $1`, [name])).id);
    }
    return sourceByName.get(name);
  };

  // ---------- 3. candidates (+ private details, education, experience) ----------
  const cands = await S(`select c.*, p.* , c.id as cid, c.created_at as c_created, c.city as c_city
    from candidate c left join candidate_profile p on p.candidate_id = c.id and p.deleted_at is null where c.deleted_at is null`);
  const stageName = new Map((await S(`select id, code from stage`)).map((s) => [s.id, s.code]));
  const histByCand = new Map();
  for (const h of await S(`select * from candidate_stage_history where deleted_at is null order by changed_at`)) {
    if (!histByCand.has(h.candidate_id)) histByCand.set(h.candidate_id, []); histByCand.get(h.candidate_id).push(h);
  }
  const poc = new Map((await S(`select distinct on (a.candidate_id) a.candidate_id, a.assignee_user_id from candidate_assignment a
    join role r on r.id = a.assigned_role_id where a.is_active and a.deleted_at is null and a.end_date is null and upper(r.name) in ('POC','HR')
    order by a.candidate_id, a.is_primary desc, a.start_date desc`)).map((r) => [r.candidate_id, r.assignee_user_id]));
  const edu = new Map(), work = new Map(), fam = new Map(), bank = new Map(), addr = new Map();
  const group = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const r of await S(`select * from candidate_education where deleted_at is null order by candidate_id, level`)) group(edu, r.candidate_id, r);
  for (const r of await S(`select * from candidate_work_experience where deleted_at is null order by candidate_id, start_date`)) group(work, r.candidate_id, r);
  for (const r of await S(`select * from candidate_family_detail where deleted_at is null`)) fam.set(r.candidate_id, r);
  for (const r of await S(`select * from candidate_bank_detail where deleted_at is null`)) bank.set(r.candidate_id, r);
  for (const r of await S(`select * from candidate_address where deleted_at is null`)) group(addr, r.candidate_id, r);

  const candId = new Map(); const dropped = [];
  for (const c of cands) {
    const code = stageName.get(c.current_stage_id);
    let stage = STAGE[code];
    const tags = [];
    if (code === 'DROPPED') {   // keep the last real stage before Dropped, tag it
      const before = (histByCand.get(c.cid) || []).map((h) => STAGE[stageName.get(h.to_stage_id)]).filter(Boolean);
      stage = before.at(-1) || 'Enrolled'; tags.push('Dropped'); dropped.push(c.cid);
    }
    if (!stage) { skip(`candidate #${c.cid}`, `stage ${code} not mapped`); continue; }
    if (c.status === 'ON_HOLD') tags.push('On hold');
    if (c.status === 'WITHDRAWN') tags.push('Withdrawn');
    const profile = clean({
      date_of_birth: day(c.date_of_birth), marital_status: c.marital_status, identification_marks: c.identification_marks,
      referred_by: c.reference_person_name || c.referral_name, domain_interest: c.domain_interest, preferred_batch_time: c.preferred_batch_time,
      enrollment_type: c.enrollment_type, experience_category: c.experience_category, current_role: c.current_role, notice_period: c.notice_period,
      skills: c.skills, summary: c.summary, cloud_platform: c.cloud_platform, programming_languages: c.programming_languages,
      big_data_tools: c.big_data_tools, etl_tools: c.etl_tools, databases: c.databases, devops_tools: c.devops_tools,
      prior_training: c.prior_training_completed ? [c.prior_training_institute, day(c.prior_training_date)].filter(Boolean).join(', ') || 'Yes' : null,
      source: c.source, old_crm_id: String(c.cid),
    });
    const education = (edu.get(c.cid) || []).map((e) => clean({ level: e.level, institution: e.institution_name || e.university_name, course: e.course_branch,
      years: [e.start_date, e.end_date].filter(Boolean).join('–'), marks: e.marks_percentage }));
    const experience = (work.get(c.cid) || []).map((w) => clean({ company: w.company_name, role: w.current_designation || w.job_title,
      joined: day(w.start_date), last_day: w.is_current_employment ? null : day(w.end_date), ctc: w.current_ctc || w.joining_ctc }));
    const r = await one(`insert into public.candidate (full_name, stage, batch_id, poc_id, joined_on, profile, education, experience, tags, created_at, stage_changed_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [name2(c.first_name, c.last_name), stage, batchId.get(c.batch_id) ?? null, sid(poc.get(c.cid)), day(c.c_created), profile,
        JSON.stringify(education), JSON.stringify(experience), tags, c.c_created, (histByCand.get(c.cid) || []).at(-1)?.changed_at || c.c_created]);
    candId.set(c.cid, r.id); await map('candidate', c.cid, r.id);

    const a = Object.fromEntries((addr.get(c.cid) || []).map((x) => [x.address_type, [x.address_line, x.city, x.state, x.pin_code].filter(Boolean).join(', ')]));
    const f = fam.get(c.cid) || {}, b = bank.get(c.cid) || {};
    const priv = {
      contact: clean({ mobile: mobile10(c.phone), email: c.email, alternate_mobile: mobile10(c.alternative_mobile), city: c.c_city || c.location,
        address: a.CURRENT || a.PERMANENT, permanent_address: a.PERMANENT && a.PERMANENT !== a.CURRENT ? a.PERMANENT : null, linkedin: c.linkedin_url, github: c.github_url }),
      family: clean({ father: f.father_name, father_mobile: mobile10(f.father_mobile), father_designation: f.father_designation,
        mother: f.mother_name, mother_mobile: mobile10(f.mother_mobile), mother_designation: f.mother_designation, siblings: f.siblings_details }),
      identity: clean({ aadhaar: c.aadhar_number, pan: c.pan_number, passport: c.passport_number, uan: c.uan_number,
        passport_expires: day(c.passport_expires_at), aadhaar_issued: day(c.aadhar_issued_at) }),
      bank: clean({ bank: b.bank_name, account: b.account_number, ifsc: b.ifsc_code, holder: b.account_holder_name }),
    };
    await D(`insert into public.candidate_private (candidate_id, contact, family, identity, bank) values ($1,$2,$3,$4,$5)
      on conflict (candidate_id) do update set contact = excluded.contact, family = excluded.family, identity = excluded.identity, bank = excluded.bank`,
      [r.id, priv.contact, priv.family, priv.identity, priv.bank]);
  }
  note('Students', candId.size); note('  of which tagged Dropped (kept at their last stage)', dropped.length);
  const cid = (v) => (v == null ? null : candId.get(v) ?? null);

  // stage history (journey + funnel): old moves become status_history rows
  let hist = 0;
  for (const [old, rows] of histByCand) {
    const id = cid(old); if (!id) continue;
    const pname = (await one(`select full_name from public.candidate where id = $1`, [id])).full_name;
    for (const h of rows) {
      const to = STAGE[stageName.get(h.to_stage_id)] ?? (stageName.get(h.to_stage_id) === 'DROPPED' ? 'Dropped' : null);
      if (!to) continue;
      const from = h.from_stage_id ? (STAGE[stageName.get(h.from_stage_id)] ?? null) : null;
      await D(`insert into public.status_history (entity, entity_id, person_name, what, from_value, to_value, by_id, at) values ('candidate',$1,$2,'Candidate stage',$3,$4,$5,$6)`,
        [id, pname, from, to, sid(h.changed_by_user_id), h.changed_at]);
      hist++;
    }
  }
  note('Stage history entries', hist);

  // ---------- 4. enquiries -> leads ----------
  const seenMobile = new Set(); let leads = 0;
  for (const e of await S(`select * from enquiries order by created_at`)) {
    const m = mobile10(e.mobile);
    if (!m) { skip(`enquiry #${e.id}`, 'no valid mobile number'); continue; }
    if (seenMobile.has(m)) { skip(`enquiry #${e.id}`, 'same mobile as an earlier enquiry (kept the earlier one)'); continue; }
    seenMobile.add(m);
    const stage = LEAD_STAGE[String(e.status).toUpperCase()] || 'New';
    const r = await one(`insert into public.lead (full_name, mobile, email, course_other, currently, preferred_start, source_id, notes, stage, owner_id,
        next_call_at, created_at, stage_changed_at, custom)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13) returning id`,
      [e.full_name, m, e.email || null, e.domain_interest, e.background, e.start_timeline, await source(e.source), e.notes, stage,
        sid(e.owner_user_id), e.next_follow_up_at, e.created_at, { old_crm_enquiry: String(e.id) }]);
    leads++; await map('enquiry', e.id, r.id);
    if (e.converted_candidate_id && cid(e.converted_candidate_id)) await D(`update public.candidate set lead_id = $1 where id = $2`, [r.id, cid(e.converted_candidate_id)]);
  }
  note('Leads (from enquiries)', leads);

  // ---------- 5. fees ----------
  let plans = 0, pays = 0; const planId = new Map();
  for (const p of await S(`select * from fee_plan`)) {
    const c = cid(p.candidate_id); if (!c) { skip(`fee plan #${p.id}`, 'student not migrated'); continue; }
    const total = Number(p.base_amount) - Number(p.discount_amount || 0);
    const r = await one(`insert into public.fee_plan (candidate_id, total, plan, created_at) values ($1,$2,$3,$4) returning id`,
      [c, total, `${p.num_installments} instalments` + (Number(p.discount_amount) ? ` (₹${Number(p.discount_amount).toLocaleString('en-IN')} discount${p.discount_reason ? ': ' + p.discount_reason : ''})` : ''), p.created_at]);
    planId.set(p.id, r.id); plans++; await map('fee_plan', p.id, r.id);
  }
  for (const p of await S(`select * from fee_payment order by paid_at`)) {
    const c = cid(p.candidate_id); if (!c) { skip(`payment #${p.id}`, 'student not migrated'); continue; }
    const r = await one(`insert into public.fee_payment (candidate_id, fee_plan_id, amount, mode, receipt_no, status, paid_on, created_by, created_at, label)
      values ($1,$2,$3,$4,$5,'Received',$6,$7,$8,$9) returning id`,
      [c, planId.get(p.fee_plan_id) ?? null, p.amount, PAY_MODE[String(p.mode).toUpperCase()] || 'Bank', p.receipt_no, day(p.paid_at), sid(p.recorded_by_user_id), p.created_at, p.notes || null]);
    pays++; await map('payment', p.id, r.id);
  }
  note('Fee plans', plans); note('Payments received', pays);

  // ---------- 6. resumes, mocks, feedback ----------
  let res = 0;
  for (const v of await S(`select * from resume_version where deleted_at is null order by candidate_id, version_number`)) {
    const c = cid(v.candidate_id); if (!c) continue;
    const status = v.status === 'APPROVED' ? 'Approved' : v.status === 'PENDING' ? 'Pending' : v.status === 'REJECTED' ? 'Rejected' : (v.is_approved ? 'Approved' : 'Rejected');
    const reason = v.status === 'SUPERSEDED' ? 'Replaced by a newer version (old CRM)' : v.rejection_reason;
    const r = await one(`insert into public.resume_version (candidate_id, version, reviewer_id, status, reason, created_at) values ($1,$2,$3,$4,$5,$6) returning id`,
      [c, 'v' + v.version_number, sid(v.approved_by_user_id), status, reason, v.created_at]);
    res++; await D('insert into public.legacy_map (kind, old_id, new_id, note) values ($1,$2,$3,$4)', ['resume', String(v.id), r.id, v.file_path]);
  }
  note('Resume versions (files copied separately)', res);

  const mockId = new Map(); let mocks = 0, fb = 0;
  for (const m of await S(`select * from mock_interview_session where deleted_at is null`)) {
    const c = cid(m.candidate_id); if (!c) continue;
    const scores = [m.communication_score, m.technical_score, m.confidence_score].filter((x) => x != null).map(Number);
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    const status = m.status === 'scheduled' ? 'Booked' : m.status === 'cancelled' ? null : avg == null ? 'Passed' : avg >= 60 ? 'Passed' : 'Failed';
    if (!status) { skip(`mock #${m.id}`, 'cancelled'); continue; }
    const r = await one(`insert into public.mock_session (candidate_id, trainer_id, level, status, scheduled_at, created_at) values ($1,$2,$3,$4,$5,$6) returning id`,
      [c, sid(m.mock_trainer_user_id), m.session_number >= 2 ? 'L2' : 'L1', status, m.scheduled_at, m.created_at]);
    mockId.set(m.id, r.id); mocks++; await map('mock', m.id, r.id);
    if (m.feedback || scores.length) await D(`insert into public.note (candidate_id, kind, body, by_id, created_at) values ($1,'Mock',$2,$3,$4)`,
      [c, `Mock ${m.session_number} scores: communication ${m.communication_score ?? '–'}, technical ${m.technical_score ?? '–'}, confidence ${m.confidence_score ?? '–'}.${m.feedback ? ' ' + m.feedback : ''}`, sid(m.mock_trainer_user_id), m.completed_at || m.scheduled_at]);
  }
  const rating = (score100) => Math.min(5, Math.max(1, Math.round(Number(score100) / 20)));
  for (const f of await S(`select * from incubation_feedback where deleted_at is null`)) {
    const c = cid(f.candidate_id); if (!c) continue;
    await D(`insert into public.sme_feedback (candidate_id, sme_id, rating, verdict, comments, created_at) values ($1,$2,$3,$4,$5,$6)`,
      [c, sid(f.sme_user_id), rating(f.score), f.recommendation === 'READY' ? 'Ready' : 'Not ready',
        [f.feedback, f.band_label ? `Band: ${f.band_label}` : null, `Score ${f.score}/100`].filter(Boolean).join(' · '), f.created_at]);
    fb++;
  }
  for (const f of await S(`select s.*, i.candidate_id from sme_feedback s join interview i on i.id = s.interview_id where s.deleted_at is null`)) {
    const c = cid(f.candidate_id); if (!c) continue;
    await D(`insert into public.sme_feedback (candidate_id, sme_id, rating, verdict, comments, created_at) values ($1,$2,$3,$4,$5,$6)`,
      [c, sid(f.sme_user_id), rating(f.score), f.recommendation === 'hire' ? 'Ready' : 'Not ready',
        [f.feedback, `Score ${f.score}/100${f.overall_score ? `, overall ${f.overall_score}/10` : ''}`].filter(Boolean).join(' · '), f.created_at]);
    fb++;
  }
  note('Mock interviews', mocks); note('SME feedback', fb);

  // company interviews and engagements have no own table here: kept as notes on the student
  let ivn = 0;
  for (const i of await S(`select * from interview where deleted_at is null`)) {
    const c = cid(i.candidate_id); if (!c) continue;
    const body = `Interview${i.company_name ? ' with ' + i.company_name : ''}${i.round ? ', ' + i.round : ''}: ${i.status}${i.outcome ? ', ' + i.outcome : ''}` +
      `${i.recommendation ? ' (recommendation: ' + i.recommendation + ')' : ''}.${i.notes ? ' ' + i.notes : ''}${i.official_feedback ? ' Company feedback: ' + i.official_feedback : ''}`;
    await D(`insert into public.note (candidate_id, kind, body, by_id, created_at) values ($1,'Placement',$2,$3,$4)`, [c, body, sid(i.interviewer_user_id), i.scheduled_at]);
    ivn++;
  }
  for (const e of await S(`select * from candidate_company_engagement where deleted_at is null`)) {
    const c = cid(e.candidate_id); if (!c) continue;
    await D(`insert into public.note (candidate_id, kind, body, by_id, created_at) values ($1,'Placement',$2,$3,$4)`,
      [c, `Put forward to ${e.company_name}${e.role_title ? ' for ' + e.role_title : ''}: ${String(e.status).replace(/_/g, ' ').toLowerCase()}${e.ctc_offered ? `, offered ${Number(e.ctc_offered).toLocaleString('en-IN')}` : ''}${e.rejection_reason ? '. Reason: ' + e.rejection_reason : ''}${e.overall_comments ? '. ' + e.overall_comments : ''}`,
        sid(e.created_by_user_id), e.created_at]);
    ivn++;
  }
  note('Company interviews / submissions (as notes)', ivn);

  // ---------- 7. placements ----------
  let pl = 0; const today = new Date().toISOString().slice(0, 10);
  for (const p of await S(`select * from placement where deleted_at is null`)) {
    const c = cid(p.candidate_id); if (!c) continue;
    const join = day(p.joining_date) || day(p.placed_at);
    const status = p.status === 'ACTIVE' ? (join && join <= today ? 'Joined' : 'Joining soon') : 'Dropped';
    const r = await one(`insert into public.placement (candidate_id, company_id, role, ctc_lpa, joining_on, status, created_at) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [c, p.company_id ? companyId.get(p.company_id) ?? await company(p.company_name) : await company(p.company_name), p.role_title,
        p.ctc != null ? Math.round(Number(p.ctc) / 1000) / 100 : null, join, status, p.placed_at]);
    pl++; await D('insert into public.legacy_map (kind, old_id, new_id, note) values ($1,$2,$3,$4)', ['placement', String(p.id), r.id, p.offer_letter_path]);
    if (p.end_reason) await D(`insert into public.note (candidate_id, kind, body, created_at) values ($1,'Placement',$2,$3)`, [c, `Placement at ${p.company_name} ended: ${p.end_reason}`, p.ended_at || p.updated_at]);
  }
  note('Placements', pl);

  // ---------- 8. notes, training notes, follow-ups, document custody ----------
  let tn = 0, cm = 0, fu = 0, dc = 0;
  for (const t of await S(`select * from training_note where deleted_at is null`)) {
    const c = cid(t.candidate_id); if (!c) continue;
    await D(`insert into public.training_note (candidate_id, trainer_id, note, created_at) values ($1,$2,$3,$4)`, [c, sid(t.trainer_user_id), t.note, t.created_at]); tn++;
  }
  for (const t of await S(`select * from candidate_comment where deleted_at is null`)) {
    const c = cid(t.candidate_id); if (!c) continue;
    await D(`insert into public.note (candidate_id, kind, body, by_id, created_at) values ($1,'Note',$2,$3,$4)`, [c, t.body, sid(t.author_user_id), t.created_at]); cm++;
  }
  const FU_ROLE = { HR: 'HR / Counsellor', POC: 'HR / Counsellor', RECRUITER: 'Placement', TRAINER: 'Trainer', ADMIN: 'Admin' };
  for (const t of await S(`select * from followup_task where deleted_at is null`)) {
    const c = cid(t.candidate_id);
    if (!c) { skip(`follow-up #${t.id}`, 'not about a migrated student'); continue; }
    await D(`insert into public.follow_up (title, candidate_id, owner_id, owner_role, due_at, status, created_by, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [t.title + (t.notes ? ' — ' + t.notes : ''), c, sid(t.assigned_to_user_id), FU_ROLE[String(t.assigned_to_role || '').toUpperCase()] || null,
        t.due_date ? day(t.due_date) + 'T10:00:00+05:30' : t.created_at, t.done_at ? 'Done' : 'Open', sid(t.created_by_user_id), t.created_at]); fu++;
  }
  for (const d of await S(`select * from doc_custody`)) {
    const c = cid(d.candidate_id); if (!c) continue;
    const where = [d.location_rack && 'rack ' + d.location_rack, d.location_file && 'file ' + d.location_file].filter(Boolean).join(', ');
    await D(`insert into public.note (candidate_id, kind, body, by_id, created_at) values ($1,'Note',$2,$3,$4)`,
      [c, `Original ${d.doc_type}${d.doc_desc ? ' (' + d.doc_desc + ')' : ''} ${d.status === 'RETURNED' ? 'returned on ' + day(d.returned_at) : 'held by the institute' + (where ? ', ' + where : '')}. Custody no. ${d.custody_no}.`,
        sid(d.received_by_user_id), d.received_at]); dc++;
  }
  note('Training notes', tn); note('Notes / comments', cm); note('Follow-ups', fu); note('Original documents held (as notes)', dc);

  // ---------- checks: the old totals must match ----------
  const oldPaid = (await S(`select coalesce(sum(amount),0)::numeric s from fee_payment`))[0].s;
  const newPaid = (await one(`select coalesce(sum(p.amount),0)::numeric s from public.fee_payment p join public.legacy_map m on m.kind = 'payment' and m.new_id = p.id`)).s;
  note('Money received, old CRM (₹)', Number(oldPaid).toLocaleString('en-IN'));
  note('Money received, copied (₹)', Number(newPaid).toLocaleString('en-IN'));
  if (Number(oldPaid) !== Number(newPaid)) skip('TOTALS', 'payments do not add up to the old CRM total — check the skipped payments above');

  // migration writes must not reach automations as "new" events
  await D(`delete from public.integration_event where created_at > now() - interval '1 hour' and status in ('Queued','Pending','New')`).catch(() => {});

  if (COMMIT) { await dst.query('commit'); console.log('\nCOMMITTED: the data is now in the new CRM.'); }
  else { await dst.query('rollback'); console.log('\nPRACTICE RUN: everything above was cancelled; the new CRM is unchanged.'); }
} catch (e) {
  await dst.query('rollback').catch(() => {});
  console.error('\nSTOPPED, nothing was saved:', e.message, e.where ? '\n' + e.where : '');
  process.exitCode = 1;
}

console.log('\nWhat was copied');
for (const [k, v] of report) console.log('  ' + String(k).padEnd(52) + v);
console.log(`\nSkipped (${skipped.length})`);
for (const s of skipped) console.log('  - ' + s);
await src.end(); await dst.end();
