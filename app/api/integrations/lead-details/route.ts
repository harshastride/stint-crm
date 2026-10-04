import { NextResponse } from 'next/server';
import { bad, findPerson, withKey } from '@/lib/server/integration';

// Everything a flow needs to decide what to do about a lead: stage, calls so far, open follow-ups,
// and who the owner's team head is (for escalations). GET ?lead_id=… or ?mobile=…
export async function GET(request: Request) {
  const a = await withKey(request); if ('error' in a) return a.error;
  const q = Object.fromEntries(new URL(request.url).searchParams);
  const who = await findPerson(a.db, q);
  if (!who?.lead_id) return bad('No lead found for that id or mobile.', 404);
  const id = who.lead_id;
  const [{ data: lead }, { data: row }, { data: calls }, { count: openFollowUps }] = await Promise.all([
    a.db.rpc('lead_brief', { lid: id }),
    a.db.from('lead').select('created_at, stage_changed_at, owner:owner_id(id, role, full_name, email)').eq('id', id).single(),
    a.db.from('call_log').select('outcome, called_at').eq('lead_id', id).order('called_at', { ascending: false }),
    a.db.from('follow_up').select('id', { count: 'exact', head: true }).eq('lead_id', id).eq('status', 'Open'),
  ]);
  const owner = row?.owner as unknown as { id: string; role: string; full_name: string; email: string } | null;
  const head = owner ? (await a.db.from('staff').select('full_name, email').eq('role', owner.role).eq('level', 'Head').eq('status', 'Active').order('full_name').limit(1).maybeSingle()).data : null;
  const minutes = row ? Math.round((Date.now() - new Date(row.created_at).getTime()) / 60000) : null;
  return NextResponse.json({
    ...lead,
    created_at: row?.created_at, minutes_since_created: minutes, stage_changed_at: row?.stage_changed_at,
    calls_count: (calls || []).length, called: (calls || []).length > 0,
    last_call_at: calls?.[0]?.called_at ?? null, last_call_outcome: calls?.[0]?.outcome ?? null,
    open_follow_ups: openFollowUps ?? 0,
    owner_role: owner?.role ?? null,
    owner_head: head?.full_name ?? null, owner_head_email: head?.email ?? null,
  });
}
