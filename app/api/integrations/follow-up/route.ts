import { NextResponse } from 'next/server';
import { bad, findPerson, withKey } from '@/lib/server/integration';

// Create a follow-up: { lead_id | candidate_id | mobile, title, due_in_hours? | due_at?, owner_email? }
// Without owner_email it goes to the person's current owner.
export async function POST(request: Request) {
  const a = await withKey(request); if ('error' in a) return a.error;
  const b = await request.json().catch(() => ({}));
  const title = String(b.title || '').trim();
  if (!title) return bad('title is required.');
  const who = await findPerson(a.db, b);
  if (!who) return bad('No lead or candidate found for that id or mobile.', 404);
  let owner: string | null = null;
  if (b.owner_email) {
    owner = (await a.db.from('staff').select('id').eq('email', String(b.owner_email).toLowerCase()).eq('status', 'Active').maybeSingle()).data?.id ?? null;
    if (!owner) return bad('No active staff member with that email.');
  } else if (who.lead_id) owner = (await a.db.from('lead').select('owner_id').eq('id', who.lead_id).single()).data?.owner_id ?? null;
  else owner = (await a.db.from('candidate').select('poc_id').eq('id', who.candidate_id!).single()).data?.poc_id ?? null;
  const due = b.due_at ? new Date(String(b.due_at)) : new Date(Date.now() + (Number(b.due_in_hours) || 24) * 3600e3);
  if (isNaN(due.getTime())) return bad('due_at is not a valid date.');
  const role = owner ? (await a.db.from('staff').select('role').eq('id', owner).single()).data?.role : null;
  const { data, error } = await a.db.from('follow_up').insert({ ...who, title: title.slice(0, 200), owner_id: owner, owner_role: role, due_at: due.toISOString() }).select('id, due_at').single();
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true, follow_up_id: data.id, due_at: data.due_at, ...who }, { status: 201 });
}
