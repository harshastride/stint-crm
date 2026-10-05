import { fail } from '@/lib/server/guard';
import { NextResponse } from 'next/server';
import { bad, findPerson, withKey } from '@/lib/server/integration';

// Add a note to a person's timeline: { lead_id | candidate_id | mobile, text }
export async function POST(request: Request) {
  const a = await withKey(request); if ('error' in a) return a.error;
  const b = await request.json().catch(() => ({}));
  const text = String(b.text || '').trim();
  if (!text) return bad('text is required.');
  const who = await findPerson(a.db, b);
  if (!who) return bad('No lead or candidate found for that id or mobile.', 404);
  const { data, error } = await a.db.from('note').insert({ ...who, kind: 'Note', body: '[Automation] ' + text.slice(0, 4000) }).select('id').single();
  if (error) return fail('note', error);
  return NextResponse.json({ ok: true, note_id: data.id, ...who }, { status: 201 });
}
