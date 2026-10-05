import { clientIp, limited } from '@/lib/server/guard';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { service } from '@/lib/server/recordings';

// Stint Notes phone app: sign in with the same CRM email and password. Only active staff get a token.
export async function POST(request: Request) {
  if (limited('mlogin:' + clientIp(request), 10)) return NextResponse.json({ error: 'Too many tries. Wait a minute.' }, { status: 429 });
  const { email, password } = await request.json().catch(() => ({}));
  if (!email || !password) return NextResponse.json({ error: 'Enter your email and password.' }, { status: 400 });
  const mail = String(email).trim().toLowerCase(), ip = clientIp(request);
  // same 5-wrong-tries lockout as the website sign-in (migration 063)
  const lockedFor = async () => Number((await service().rpc('login_locked_seconds', { p_email: mail })).data) || 0;
  const lockedReply = (sec: number) => NextResponse.json({ error: `Too many wrong passwords. Try again in ${Math.max(1, Math.ceil(sec / 60))} minutes.` }, { status: 429 });
  const before = await lockedFor();
  if (before > 0) return lockedReply(before);
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: mail, password: String(password) });
  if (error || !data.session) {
    await service().rpc('login_record', { p_email: mail, p_ok: false, p_ip: ip });
    const after = await lockedFor();
    return after > 0 ? lockedReply(after) : NextResponse.json({ error: 'Wrong email or password.' }, { status: 401 });
  }
  await service().rpc('login_record', { p_email: mail, p_ok: true, p_ip: ip });
  const { data: staff } = await service().from('staff').select('full_name, email').eq('id', data.user.id).eq('status', 'Active').maybeSingle();
  if (!staff) return NextResponse.json({ error: 'The phone app is for active staff only.' }, { status: 403 });
  const s = data.session;
  return NextResponse.json({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at, name: staff.full_name, email: staff.email });
}
