// Demo student login for the portal: priya@demo.stint.local / stint-demo-1234, linked to the demo candidate Priya Reddy.
// Safe to run again. Local databases only (same guard as seed-demo.mjs).
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)(:\d+)?/.test(url) && !process.argv.includes('--i-know-this-is-not-production')) {
  console.error('Refusing to add a demo student to a non-local database.'); process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const PASSWORD = env.DEMO_PASSWORD || 'stint-demo-1234';
const EMAIL = 'priya@demo.stint.local';
const fail = (what, e) => { console.error('FAILED:', what, '-', e.message); process.exit(1); };

const { data: cand, error: ce } = await db.from('candidate').select('id').eq('full_name', 'Priya Reddy').maybeSingle();
if (ce) fail('find Priya Reddy', ce);
if (!cand) { console.log('Demo candidate Priya Reddy not found; run npm run seed first.'); process.exit(0); }

// the portal login uses the email in the student's contact details
const { data: priv } = await db.from('candidate_private').select('contact').eq('candidate_id', cand.id).maybeSingle();
const contact = { ...(priv?.contact || {}), email: EMAIL };
const { error: pe } = await db.from('candidate_private').upsert({ candidate_id: cand.id, contact });
if (pe) fail('contact email', pe);

const { data: list, error: le } = await db.auth.admin.listUsers({ page: 1, perPage: 500 });
if (le) fail('list users', le);
let user = list.users.find((u) => u.email === EMAIL);
if (!user) {
  const { data, error } = await db.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
  if (error) fail('create student login', error);
  user = data.user;
} else {
  const { error } = await db.auth.admin.updateUserById(user.id, { password: PASSWORD });
  if (error) fail('reset student password', error);
}
const { error: se } = await db.from('student_account').upsert({ user_id: user.id, candidate_id: cand.id, must_change_password: false });
if (se) fail('student account', se);
console.log(`Demo student ready: ${EMAIL} / ${PASSWORD} (Priya Reddy)`);
