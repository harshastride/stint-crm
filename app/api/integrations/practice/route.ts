import { fail } from '@/lib/server/guard';
import { NextResponse } from 'next/server';
import { bad, withKey } from '@/lib/server/integration';

// The Interview Coach sends each scored practice answer here (header x-api-key). Same attempt_ref again = update.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITS: Record<string, [number, number]> = { overall: [0, 100], accuracy: [0, 100], fluency: [0, 100], completeness: [0, 100], wpm: [0, 400], filler_count: [0, 100000] };

export async function POST(request: Request) {
  const k = await withKey(request);
  if ('error' in k) return k.error;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return bad('Send JSON.');
  if (!UUID.test(String(b.candidate_id || ''))) return bad('candidate_id must be a candidate id.');
  const attempt_ref = String(b.attempt_ref ?? '').trim();
  if (!attempt_ref) return bad('attempt_ref is required.');
  const row: Record<string, unknown> = { candidate_id: b.candidate_id, attempt_ref, topic: b.topic ? String(b.topic) : null, question: b.question ? String(b.question) : null };
  for (const [f, [lo, hi]] of Object.entries(LIMITS)) {
    if (b[f] === undefined || b[f] === null || b[f] === '') { row[f] = null; continue; }
    const n = Number(b[f]);
    if (!Number.isFinite(n) || n < lo || n > hi) return bad(`${f} must be a number from ${lo} to ${hi}.`);
    row[f] = f === 'filler_count' ? Math.round(n) : n;
  }
  if (b.created_at) {
    const d = new Date(String(b.created_at));
    if (isNaN(d.getTime())) return bad('created_at must be a date.');
    row.created_at = d.toISOString();
  }
  const { data: c } = await k.db.from('candidate').select('id').eq('id', String(b.candidate_id)).maybeSingle();
  if (!c) return bad('No candidate with that candidate_id.', 404);
  const { data, error } = await k.db.from('interview_practice').upsert(row, { onConflict: 'attempt_ref' }).select('id').single();
  if (error) return fail('practice', error);
  return NextResponse.json({ ok: true, id: data.id });
}
