// Creates the first real admin on the live server (go-live step 5.3).
//   node scripts/create-admin.mjs "Harsha Reddy" harsha@stintacademy.com
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment (or .env.local).
// Prints a temporary password; it must be changed at first sign-in. Everyone else is invited from Users & staff.
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import fs from 'node:fs';

const file = fs.existsSync('.env.local') ? Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])) : {};
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || file.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || file.SUPABASE_SERVICE_ROLE_KEY;
const [name, email] = process.argv.slice(2);
if (!url || !key || !name || !email) { console.error('Usage: node scripts/create-admin.mjs "Full name" email  (with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set)'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const password = crypto.randomBytes(9).toString('base64url');
const { data, error } = await db.auth.admin.createUser({ email: email.toLowerCase(), password, email_confirm: true });
if (error) { console.error('Could not create the login:', error.message); process.exit(1); }
const ins = await db.from('staff').insert({ id: data.user.id, full_name: name, email: email.toLowerCase(), role: 'Admin', level: 'Head', status: 'Active', must_change_password: true });
if (ins.error) { await db.auth.admin.deleteUser(data.user.id); console.error('Could not add the staff record:', ins.error.message); process.exit(1); }
console.log(`Admin ${name} <${email}> created. Temporary password: ${password}\nSign in and choose a new password straight away.`);
