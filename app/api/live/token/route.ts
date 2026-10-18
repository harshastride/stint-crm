import { NextResponse } from 'next/server';
import { claudeReady } from '@/lib/server/ai';
import { liveCaller, tooOften } from '@/lib/server/live';

// A 30-second Deepgram pass so the browser can open the live speech-to-text connection itself.
// The Deepgram key stays on the server; the pass only opens a connection, and the connection ends when the call ends.
export async function POST(request: Request) {
  const who = await liveCaller(request, undefined); if ('error' in who) return who.error;
  const slow = tooOften('live-token:' + who.user.id, 20, 60 * 60_000); if (slow) return slow;
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key || !claudeReady()) return NextResponse.json({ error: 'Live help is not set up yet. Ask the admin to add the voice and Claude keys.' }, { status: 503 });
  const res = await fetch('https://api.deepgram.com/v1/auth/grant', {
    method: 'POST', headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl_seconds: 30 }),
  }).catch(() => null);
  if (!res) return NextResponse.json({ error: 'Could not reach the speech service. Please try again.' }, { status: 502 });
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    console.error('live/token: Deepgram refused the pass', res.status);
    return NextResponse.json({ error: res.status === 403
      ? 'Live help is not set up yet: the Deepgram key needs “Member” permission. Ask the admin.'
      : 'Live help is not set up yet: the Deepgram key is not valid. Ask the admin.' }, { status: 503 });
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) return NextResponse.json({ error: 'Could not start live listening. Please try again.' }, { status: 502 });
  const q = new URLSearchParams({
    model: process.env.DEEPGRAM_MODEL || 'nova-3', language: process.env.DEEPGRAM_LANGUAGE || 'multi',
    smart_format: 'true', punctuate: 'true', interim_results: 'true', utterance_end_ms: '1200', vad_events: 'true', diarize: 'true',
  });
  return NextResponse.json({ token: j.access_token, url: `wss://api.deepgram.com/v1/listen?${q}` });
}
