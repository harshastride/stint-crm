import { crossSite, fail, isUuid } from '@/lib/server/guard';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

// Gives a staff member a new temporary password. Only someone who may edit Users & staff can call it.
export async function POST(request: Request) {
  const bad = crossSite(request); if (bad) return bad;
  const jar = await cookies();
  const asCaller = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: { name: 'sb-stint-auth-token' },
    cookies: { getAll: () => jar.getAll(), setAll: () => {} },
  });
  const { data: allowed } = await asCaller.rpc('can_page', { p: 'users', need: 'w' });
  if (!allowed) return NextResponse.json({ error: 'Only an admin can reset passwords.' }, { status: 403 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.' }, { status: 500 });

  const { staff_id } = await request.json().catch(() => ({}));
  if (!isUuid(staff_id)) return NextResponse.json({ error: 'Pick the person.' }, { status: 400 });
  const { data: me } = await asCaller.auth.getUser();
  if (me.user?.id === staff_id) return NextResponse.json({ error: 'Use “Change password” for your own login.' }, { status: 400 });

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  // only staff logins (not student logins), and only an Admin can reset an Admin
  const { data: target } = await admin.from('staff').select('role').eq('id', staff_id).maybeSingle();
  if (!target) return NextResponse.json({ error: 'Staff member not found.' }, { status: 404 });
  if (/admin/i.test(target.role || '') && (await asCaller.rpc('is_admin')).data !== true) return NextResponse.json({ error: 'Only an admin can reset an admin password.' }, { status: 403 });
  const password = crypto.randomBytes(9).toString('base64url');
  const up = await admin.auth.admin.updateUserById(staff_id, { password });
  if (up.error) return fail('admin/reset-password', up.error, 'Could not reset the password.', 400);
  const { error } = await admin.from('staff').update({ must_change_password: true }).eq('id', staff_id);
  if (error) return fail('admin/reset-password', error, 'Could not reset the password.', 400);
  return NextResponse.json({ ok: true, password });
}
