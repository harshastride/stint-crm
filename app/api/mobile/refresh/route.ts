import { clientIp, limited } from '@/lib/server/guard';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Stint Notes phone app: swap a refresh token for a fresh login token (they last about an hour).
export async function POST(request: Request) {
  if (limited('mrefresh:' + clientIp(request), 30)) return NextResponse.json({ error: 'Too many tries. Wait a minute.' }, { status: 429 });
  const { refresh_token } = await request.json().catch(() => ({}));
  if (!refresh_token) return NextResponse.json({ error: 'Sign in again.' }, { status: 400 });
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.auth.refreshSession({ refresh_token: String(refresh_token) });
  if (error || !data.session) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  const s = data.session;
  return NextResponse.json({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at });
}
