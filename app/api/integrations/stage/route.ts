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
  const { error } = who.lead_id ? await a.db.from('lead').update({ stage }).eq('id', who.lead_id) : await a.db.from('candidate').update({ stage }).eq('id', who.candidate_id!);
  if (error) return bad(error.message, 400);
  return NextResponse.json({ ok: true, stage, ...who });
}
