import { NextResponse } from 'next/server';
import { asCaller, service } from '@/lib/server/recordings';
import { makeCoachToken } from '@/lib/server/coachSso';

// Student clicks "Practice interviews" → a one-minute signed pass to the Interview Coach.
export async function GET() {
  const caller = await asCaller();
  const { data: auth } = await caller.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'Sign in to the student portal.' }, { status: 401 });
  const { data: cid } = await caller.rpc('my_candidate');
  if (!cid) return NextResponse.json({ error: 'Interview practice is for students. Open it from the student portal.' }, { status: 403 });
  const url = process.env.COACH_URL, secret = process.env.COACH_SSO_SECRET;
  if (!url || !secret) return NextResponse.json({ error: "Interview practice isn't set up yet. Ask the institute." }, { status: 503 });
  const { data: c } = await service().from('candidate').select('full_name').eq('id', cid).maybeSingle();
  const token = makeCoachToken({ cid: String(cid), email: auth.user.email || '', name: c?.full_name || '' }, secret);
  return NextResponse.redirect(`${url.replace(/\/$/, '')}/auth/stint?token=${encodeURIComponent(token)}`, 302);
}
