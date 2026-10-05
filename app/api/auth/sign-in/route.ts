import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Password sign-in goes through here (direct password sign-in on /supabase is blocked in middleware.ts).
// After 5 wrong passwords for an email in 15 minutes, that email is locked for 15 minutes.
// The answers never say whether an email has a login.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.' }, { status: 500 });
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || '';

  const locked = async () => {
    const r = await admin.rpc('login_locked_seconds', { p_email: email });
    if (r.error) throw new Error(r.error.message);
    return Number(r.data) || 0;
  };
  const lockedReply = (s: number) => NextResponse.json({ error: 'locked', minutes: Math.max(1, Math.ceil(s / 60)) }, { status: 429 });

  try {
    const before = await locked();
    if (before > 0) return lockedReply(before);
    const res = await fetch(`${url.replace(/\/$/, '')}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anon, 'content-type': 'application/json', ...(ip ? { 'x-forwarded-for': ip } : {}) },
      body: JSON.stringify({ email, password }),
    });
    if (res.status === 429) return NextResponse.json({ error: 'busy' }, { status: 429 });
    if (res.status >= 500) return NextResponse.json({ error: 'down' }, { status: 503 });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      await admin.rpc('login_record', { p_email: email, p_ok: false, p_ip: ip });
      const after = await locked();
      if (after > 0) return lockedReply(after);
      return NextResponse.json({ error: 'invalid' }, { status: 401 });
    }
    await admin.rpc('login_record', { p_email: email, p_ok: true, p_ip: ip });
    return NextResponse.json({ access_token: data.access_token, refresh_token: data.refresh_token });
  } catch {
    return NextResponse.json({ error: 'down' }, { status: 503 });
  }
}
