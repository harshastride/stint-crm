import { NextResponse } from 'next/server';
import { asToken, staffFromBearer } from '@/lib/server/recordings';

// Stint Notes phone app: the signed-in staff member's own recordings, newest first.
// ?id=<recording id> returns one note with its transcript. Row security decides what is visible.
export async function GET(request: Request) {
  const me = await staffFromBearer(request);
  if (!me) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  const db = asToken(me.token);
  const id = new URL(request.url).searchParams.get('id');
  const cols = 'id, created_at, called_at, length_sec, status, source, summary, outcome, follow_up, draft, process_error, lead:lead_id(full_name), candidate:candidate_id(full_name)';
  if (id) {
    const { data } = await db.from('recording').select(cols + ', transcript, transcript_text').eq('id', id).eq('captured_by', me.id).maybeSingle();
    return data ? NextResponse.json(data) : NextResponse.json({ error: 'Note not found.' }, { status: 404 });
  }
  const { data, error } = await db.from('recording').select(cols).eq('captured_by', me.id).order('created_at', { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ name: me.full_name, notes: data });
}
