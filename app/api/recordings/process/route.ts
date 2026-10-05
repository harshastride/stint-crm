import { crossSite, isUuid } from '@/lib/server/guard';
import { NextResponse } from 'next/server';
import { asCaller, processRecording, service } from '@/lib/server/recordings';

export const maxDuration = 300;

// Transcribe (Deepgram) and summarise (Gemini) a recording the caller is allowed to see.
export async function POST(request: Request) {
  const bad = crossSite(request); if (bad) return bad;
  const { id } = await request.json().catch(() => ({}));
  if (!isUuid(id)) return NextResponse.json({ error: 'Which recording?' }, { status: 400 });
  const caller = await asCaller();
  const { data: visible } = await caller.from('recording').select('id').eq('id', id).maybeSingle();
  if (!visible) return NextResponse.json({ error: 'You can’t see that recording.' }, { status: 403 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.' }, { status: 500 });
  const out = await processRecording(service(), id);
  return NextResponse.json(out, { status: out.ok ? 200 : 502 });
}
