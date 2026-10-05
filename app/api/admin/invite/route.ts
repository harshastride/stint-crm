import { crossSite, fail, isUuid } from '@/lib/server/guard';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

// Creates a login for a new staff member. Only someone who may edit Users & staff can call it.
export async function POST(request: Request) {
  const bad = crossSite(request); if (bad) return bad;
  const jar = await cookies();
  const asCaller = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: { name: 'sb-stint-auth-token' },
    cookies: { getAll: () => jar.getAll(), setAll: () => {} },
  });
  const { data: allowed } = await asCaller.rpc('can_page', { p: 'users', need: 'w' });
  if (!allowed) return NextResponse.json({ error: 'Only an admin can invite users.' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const full_name = String(body.full_name || '').trim();
  if (!email || !full_name || !body.role) return NextResponse.json({ error: 'Name, email and role are needed.' }, { status: 400 });
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email) || full_name.length > 120 || typeof body.role !== 'string' || body.role.length > 60) return NextResponse.json({ error: 'Check the name, email and role.' }, { status: 400 });
  if (body.branch_id && !isUuid(body.branch_id)) return NextResponse.json({ error: 'Pick a branch from the list.' }, { status: 400 });
  // only an Admin can create another Admin login
  if (/admin/i.test(body.role) && (await asCaller.rpc('is_admin')).data !== true) return NextResponse.json({ error: 'Only an admin can create an admin login.' }, { status: 403 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.' }, { status: 500 });

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const password = crypto.randomBytes(9).toString('base64url');
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) return NextResponse.json({ error: /already/.test(created.error?.message || '') ? 'That email already has a login.' : 'Could not create the login.' }, { status: 400 });

  const { error } = await admin.from('staff').insert({
    id: created.data.user.id, full_name, email, role: body.role, level: body.level || 'Junior', branch_id: body.branch_id || null, status: 'Active', must_change_password: true,
  });
  if (error) { await admin.auth.admin.deleteUser(created.data.user.id); return fail('admin/invite', error, 'Could not save the staff member. Check the role and branch.', 400); }
  return NextResponse.json({ ok: true, password });
}
