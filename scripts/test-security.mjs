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
  const q = await sales.from('fee_quote').insert({ lead_id: r.data.id, program_id: prog.id, list_price: prog.fee, discount_pct: 15, amount: 1 }).select().single();
  check('Quote amount is worked out by the database', Number(q.data?.amount) === 18700, String(q.data?.amount));
  check('15% discount is flagged for approval', q.data?.needs_approval === true);
  await sales.from('fee_quote').update({ status: 'Accepted' }).eq('id', q.data.id);
  const mv = await sales.from('lead').update({ stage: 'Converted' }).eq('id', r.data.id).select();
  check('Sales can convert the lead', (mv.data || []).length === 1, mv.error?.message);
  const c = (await admin.from('candidate').select('id, code, stage, lead_id').eq('lead_id', r.data.id)).data;
  check('Conversion created exactly one candidate', c.length === 1 && c[0].stage === 'Enrolled' && /^STA-/.test(c[0].code), JSON.stringify(c));
  const plan = (await admin.from('fee_plan').select('total').eq('candidate_id', c[0].id)).data;
  check('Fee plan was started from the accepted quote', plan.length === 1 && Number(plan[0].total) === 18700);
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
