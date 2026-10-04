import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { service } from '@/lib/server/recordings';

// Stint Notes phone app: sign in with the same CRM email and password. Only active staff get a token.
export async function POST(request: Request) {
  const { email, password } = await request.json().catch(() => ({}));
  if (!email || !password) return NextResponse.json({ error: 'Enter your email and password.' }, { status: 400 });
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: String(email).trim().toLowerCase(), password: String(password) });
  if (error || !data.session) return NextResponse.json({ error: 'Wrong email or password.' }, { status: 401 });
  const { data: staff } = await service().from('staff').select('full_name, email').eq('id', data.user.id).eq('status', 'Active').maybeSingle();
  if (!staff) return NextResponse.json({ error: 'The phone app is for active staff only.' }, { status: 403 });
  const s = data.session;
  return NextResponse.json({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at, name: staff.full_name, email: staff.email });
}
