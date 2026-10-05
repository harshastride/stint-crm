import { crossSite, fail, isUuid } from '@/lib/server/guard';
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { asCaller, service } from '@/lib/server/recordings';

// Staff invite a student to the portal (or reset their portal password). Uses the email in the student's contact details.
export async function POST(request: Request) {
  const bad = crossSite(request); if (bad) return bad;
  const caller = await asCaller();
  const [{ data: canC }, { data: canE }] = await Promise.all([caller.rpc('can_page', { p: 'candidate', need: 'w' }), caller.rpc('can_page', { p: 'enrolform', need: 'w' })]);
  if (!canC && !canE) return NextResponse.json({ error: 'Your role can’t invite students.' }, { status: 403 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.' }, { status: 500 });
  const { candidate_id } = await request.json().catch(() => ({}));
  if (!isUuid(candidate_id)) return NextResponse.json({ error: 'Pick the student.' }, { status: 400 });
  const { data: visible } = await caller.from('candidate').select('id, full_name').eq('id', candidate_id).maybeSingle();
  if (!visible) return NextResponse.json({ error: 'Student not found, or your role can’t see them.' }, { status: 404 });

  const db = service();
  const { data: priv } = await db.from('candidate_private').select('contact').eq('candidate_id', candidate_id).maybeSingle();
  const email = String(priv?.contact?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Add the student’s email in their contact details first.' }, { status: 400 });
  const password = crypto.randomBytes(9).toString('base64url');
  const { data: me } = await caller.auth.getUser();

  const { data: existing } = await db.from('student_account').select('user_id').eq('candidate_id', candidate_id).maybeSingle();
  if (existing) {
    const up = await db.auth.admin.updateUserById(existing.user_id, { password, email });
    if (up.error) return fail('portal/invite', up.error, 'Could not reset the portal login.', 400);
    await db.from('student_account').update({ must_change_password: true }).eq('user_id', existing.user_id);
    return NextResponse.json({ ok: true, email, password, reset: true });
  }
  const { data: staffWithEmail } = await db.from('staff').select('id').eq('email', email).maybeSingle();
  if (staffWithEmail) return NextResponse.json({ error: 'That email belongs to a staff login. Use the student’s own email.' }, { status: 400 });
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { kind: 'student' } });
  if (created.error || !created.data.user) return NextResponse.json({ error: /already/.test(created.error?.message || '') ? 'That email already has a login.' : 'Could not create the portal login.' }, { status: 400 });
  const ins = await db.from('student_account').insert({ user_id: created.data.user.id, candidate_id, invited_by: me.user?.id });
  if (ins.error) { await db.auth.admin.deleteUser(created.data.user.id); return fail('portal/invite', ins.error, 'Could not create the portal login.', 400); }
  await db.from('note').insert({ candidate_id, kind: 'Note', body: 'Invited to the student portal (' + email + ').', by_id: me.user?.id });
  return NextResponse.json({ ok: true, email, password, reset: false });
}
