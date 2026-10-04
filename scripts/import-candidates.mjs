// One-time import of existing students into the live CRM (go-live step 5.3). Leads use Admin settings → Import.
//   node scripts/import-candidates.mjs students.csv            (dry run: shows what would happen)
//   node scripts/import-candidates.mjs students.csv --apply    (writes)
// CSV columns (header row, any order): Full name*, Mobile*, Email, City, Program, Batch, Stage, Joined on
// A mobile already used by a candidate is skipped. Contact details go to the protected candidate_private table.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const file = fs.existsSync('.env.local') ? Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])) : {};
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || file.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || file.SUPABASE_SERVICE_ROLE_KEY;
const [csvPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
if (!url || !key || !csvPath) { console.error('Usage: node scripts/import-candidates.mjs file.csv [--apply]'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// small CSV reader: commas, quotes, doubled quotes, CRLF
const parse = (t) => { const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c; }
  if (cell || row.length) { row.push(cell); rows.push(row); } return rows.filter((r) => r.some((x) => x.trim())); };
const [head, ...rows] = parse(fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, ''));
const col = (n) => head.findIndex((h) => h.trim().toLowerCase() === n.toLowerCase());
const need = ['Full name', 'Mobile'].filter((n) => col(n) < 0);
if (need.length) { console.error('Missing columns: ' + need.join(', ')); process.exit(1); }
const get = (r, n) => (col(n) >= 0 ? (r[col(n)] || '').trim() : '');

const programs = (await db.from('program').select('id, name')).data || [];
const batches = (await db.from('batch').select('id, code')).data || [];
const stages = ((await db.from('dropdown_value').select('value').eq('list_id', 'candidate_stage')).data || []).map((v) => v.value);
const known = new Set(((await db.from('candidate_private').select('contact')).data || []).map((p) => p.contact?.mobile).filter(Boolean));
const year = new Date().getFullYear();
let added = 0; const skipped = [];
for (const [i, r] of rows.entries()) {
  const name = get(r, 'Full name'); const mobile = get(r, 'Mobile').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  if (!name || mobile.length !== 10) { skipped.push(`row ${i + 2}: needs a name and a 10-digit mobile`); continue; }
  if (known.has(mobile)) { skipped.push(`row ${i + 2}: ${name} (${mobile}) is already a candidate`); continue; }
  const program = programs.find((p) => p.name.toLowerCase() === get(r, 'Program').toLowerCase());
  const batch = batches.find((b) => b.code.toLowerCase() === get(r, 'Batch').toLowerCase());
  const stage = stages.find((s) => s.toLowerCase() === get(r, 'Stage').toLowerCase()) || 'Enrolled';
  known.add(mobile);
  if (!apply) { added++; continue; }
  const { data: seq } = await db.rpc('next_candidate_code').then((x) => x, () => ({ data: null }));
  const code = seq || `STA-${year}-I${String(i + 1).padStart(4, '0')}`;
  const { data: c, error } = await db.from('candidate').insert({ code, full_name: name, program_id: program?.id || null, batch_id: batch?.id || null, stage,
    created_at: get(r, 'Joined on') ? new Date(get(r, 'Joined on')).toISOString() : undefined }).select('id').single();
  if (error) { skipped.push(`row ${i + 2}: ${error.message}`); continue; }
  await db.from('candidate_private').insert({ candidate_id: c.id, contact: { mobile, email: get(r, 'Email') || undefined, city: get(r, 'City') || undefined } });
  added++;
}
console.log(`${apply ? 'Imported' : 'Would import'} ${added} candidates. Skipped ${skipped.length}.`);
skipped.slice(0, 50).forEach((s) => console.log('  - ' + s));
if (!apply) console.log('Dry run only. Add --apply to write.');
