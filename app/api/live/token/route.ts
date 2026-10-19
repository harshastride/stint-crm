import { NextResponse } from 'next/server';
import { claudeReady } from '@/lib/server/ai';
import { liveCaller, tooOften } from '@/lib/server/live';

// A 30-second Deepgram pass so the browser can open the live speech-to-text connection itself.
// The Deepgram key stays on the server; the pass only opens a connection, and the connection ends when the call ends.
export async function POST(request: Request) {
  const who = await liveCaller(request, undefined); if ('error' in who) return who.error;
  const slow = tooOften('live-token:' + who.user.id, 20, 60 * 60_000); if (slow) return slow;
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key || !claudeReady()) {
    console.error('live/token: not set up:', !key ? 'DEEPGRAM_API_KEY missing' : 'ANTHROPIC_API_KEY missing');
    return NextResponse.json({ error: 'Live help isn’t switched on yet. Ask the admin.' }, { status: 503 });
  }
  const res = await fetch('https://api.deepgram.com/v1/auth/grant', {
    method: 'POST', headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl_seconds: 30 }),
  }).catch((e) => { console.error('live/token: could not reach Deepgram:', e instanceof Error ? e.message.slice(0, 120) : 'unknown'); return null; });
  if (!res) return NextResponse.json({ error: 'Couldn’t reach the voice service. Please try again.' }, { status: 502 });
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    // the reason stays in the server log: 403 = the Deepgram key needs "Member" permission, 400/401 = the key is not valid
    console.error('live/token: Deepgram refused the pass', res.status, res.status === 403 ? '(key needs Member permission)' : '(key not valid)');
    return NextResponse.json({ error: 'Live help isn’t switched on yet. Ask the admin.' }, { status: 503 });
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    console.error('live/token: no pass from Deepgram', res.status);
    return NextResponse.json({ error: res.status === 429 ? 'The service is busy. Please try again in a minute.' : 'Couldn’t start live listening. Please try again.' }, { status: 502 });
  }
  const q = new URLSearchParams({
    model: process.env.DEEPGRAM_MODEL || 'nova-3', language: process.env.DEEPGRAM_LANGUAGE || 'multi',
    smart_format: 'true', punctuate: 'true', interim_results: 'true', utterance_end_ms: '1200', vad_events: 'true', diarize: 'true',
  });
  return NextResponse.json({ token: j.access_token, url: `wss://api.deepgram.com/v1/listen?${q}` });
}
