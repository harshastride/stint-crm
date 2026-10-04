import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

// Creates a login for a new staff member. Only someone who may edit Users & staff can call it.
export async function POST(request: Request) {
  const jar = await cookies();
  const asCaller = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: { name: 'sb-stint-auth-token' },
    cookies: { getAll: () => jar.getAll(), setAll: () => {} },
  });
  const { data: allowed } = await asCaller.rpc('can_page', { p: 'users', need: 'w' });
  if (!allowed) return NextResponse.json({ error: 'Only an admin can invite users.' }, { status: 403 });

  const body = await request.json();
  const email = String(body.email || '').trim().toLowerCase();
  const full_name = String(body.full_name || '').trim();
  if (!email || !full_name || !body.role) return NextResponse.json({ error: 'Name, email and role are needed.' }, { status: 400 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.' }, { status: 500 });

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const password = crypto.randomBytes(9).toString('base64url');
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) return NextResponse.json({ error: /already/.test(created.error?.message || '') ? 'That email already has a login.' : created.error?.message || 'Could not create the login.' }, { status: 400 });

  const { error } = await admin.from('staff').insert({
    id: created.data.user.id, full_name, email, role: body.role, level: body.level || 'Junior', branch_id: body.branch_id || null, status: 'Active',
  });
  if (error) { await admin.auth.admin.deleteUser(created.data.user.id); return NextResponse.json({ error: error.message }, { status: 400 }); }
  return NextResponse.json({ ok: true, password });
}
