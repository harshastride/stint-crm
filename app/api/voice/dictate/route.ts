import { NextResponse } from 'next/server';
import { aiReady, asCaller, cleanDictation, service, transcribe } from '@/lib/server/recordings';

export const maxDuration = 120;
const MAX_BYTES = 10 * 1024 * 1024;
const CONTEXTS = ['note', 'call', 'enquiry', 'field'];
// Light per-staff rate limit (in memory, per server process): 20 dictations a minute.
const hits = new Map<string, number[]>();

// Voice input: transcribe (Deepgram) then clean up (Gemini). The audio is never stored and nothing is saved; staff review the draft.
export async function POST(request: Request) {
  const caller = await asCaller();
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const { data: staff } = await service().from('staff').select('id').eq('id', user.id).eq('status', 'Active').maybeSingle();
  if (!staff) return NextResponse.json({ error: 'Only active staff can use voice input.' }, { status: 403 });

  const now = Date.now(), recent = (hits.get(user.id) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 20) return NextResponse.json({ error: 'Too many voice notes in a minute. Please wait a moment.' }, { status: 429 });
  recent.push(now); hits.set(user.id, recent);

  if (!aiReady()) return NextResponse.json({ error: 'Voice input is not set up yet. Please type for now and ask the admin to add the voice keys.' }, { status: 503 });

  const form = await request.formData().catch(() => null);
  const audio = form?.get('audio');
  const context = String(form?.get('context') || 'field');
  if (!(audio instanceof Blob) || !audio.size) return NextResponse.json({ error: 'No audio was sent.' }, { status: 400 });
  if (audio.size > MAX_BYTES) return NextResponse.json({ error: 'That recording is too long. Keep it under 3 minutes.' }, { status: 413 });
  if (!CONTEXTS.includes(context)) return NextResponse.json({ error: 'Unknown context.' }, { status: 400 });

  try {
    const name = audio instanceof File && audio.name ? audio.name : 'dictation.webm';
    const { text } = await transcribe(audio, name);
    if (!text.trim()) return NextResponse.json({ empty: true, transcript: '' });
    const out = await cleanDictation(text, context);
    return NextResponse.json({ ...out, transcript: text });
  } catch (e) {
    // log only the error kind, never the audio or transcript
    console.error('voice/dictate failed:', e instanceof Error ? e.message.slice(0, 80) : 'unknown');
    return NextResponse.json({ error: 'Could not turn that into text. Please try again or type it.' }, { status: 502 });
  }
}
