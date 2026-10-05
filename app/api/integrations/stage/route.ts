import { fail } from '@/lib/server/guard';
import { NextResponse } from 'next/server';
import { bad, findPerson, withKey } from '@/lib/server/integration';

// Move a lead or candidate to another stage: { lead_id | candidate_id | mobile, stage }. Same rules as the screen (conversion etc.).
export async function POST(request: Request) {
  const a = await withKey(request); if ('error' in a) return a.error;
  const b = await request.json().catch(() => ({}));
  const stage = String(b.stage || '').trim();
  const who = await findPerson(a.db, b);
  if (!who) return bad('No lead or candidate found for that id or mobile.', 404);
  const list = who.lead_id ? 'lead_stage' : 'candidate_stage';
  const ok = (await a.db.from('dropdown_value').select('value').eq('list_id', list).eq('value', stage).maybeSingle()).data;
  if (!ok) return bad(`"${stage}" is not a ${who.lead_id ? 'lead' : 'candidate'} stage.`);
  // Stage rules (migration 073): the service key skips the database trigger, so check the same rules here.
  const kind = who.lead_id ? 'lead' : 'candidate', rid = (who.lead_id || who.candidate_id)!;
  const cur = (await a.db.from(kind).select('stage').eq('id', rid).maybeSingle()).data?.stage;
  if (cur && cur !== stage) {
    const { data: unmet, error: ue } = await a.db.rpc('stage_unmet', { p_kind: kind, p_id: rid, p_from: cur, p_to: stage });
    if (ue) return fail('stage', ue, 'Could not check the stage rules.', 400);
    const u = (unmet || []) as { code: string; detail: string }[];
    if (u.length) return bad(u[0].code === 'not_allowed' ? `Can't move from ${cur} to ${stage}: that move isn't allowed.` : `Can't move to ${stage} yet: ${u.map((x) => x.detail).join('; ')}.`, 409);
  }
  const { error } = who.lead_id ? await a.db.from('lead').update({ stage }).eq('id', who.lead_id) : await a.db.from('candidate').update({ stage }).eq('id', who.candidate_id!);
  if (error) return fail('stage', error, 'Could not change the stage.', 400);
  return NextResponse.json({ ok: true, stage, ...who });
}
