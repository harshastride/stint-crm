import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

// Server-side helpers for recordings. API keys are read here only and never sent to the browser.
export const service = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

export async function asCaller() {
  const jar = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: { name: 'sb-stint-auth-token' },
    cookies: { getAll: () => jar.getAll(), setAll: () => {} },
  });
}

/** Phone app: acts as the signed-in staff member, so row security applies exactly as on the website. */
export const asToken = (token: string) => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false },
});

/** Phone app: the active staff member behind "Authorization: Bearer <login token>", or null. */
export async function staffFromBearer(request: Request) {
  const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const { data } = await asToken(token).auth.getUser(token);
  if (!data.user) return null;
  const { data: staff } = await service().from('staff').select('id, full_name, email').eq('id', data.user.id).eq('status', 'Active').maybeSingle();
  return staff ? { ...staff, token } : null;
}

export type Segment = { speaker: string; start_ms: number; end_ms: number; text: string };

/** Both AI keys are on the server, so uploads can be transcribed straight away. */
export const aiReady = () => !!(process.env.DEEPGRAM_API_KEY && process.env.GEMINI_API_KEY);

/** Deepgram pre-recorded transcription: one call, speakers separated, English mixed with Indian languages. */
export async function transcribe(audio: Blob, filename: string): Promise<{ text: string; segments: Segment[] }> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error('DEEPGRAM_API_KEY is not set on the server.');
  const q = new URLSearchParams({
    model: process.env.DEEPGRAM_MODEL || 'nova-3', language: process.env.DEEPGRAM_LANGUAGE || 'multi',
    diarize: 'true', utterances: 'true', smart_format: 'true', punctuate: 'true',
  });
  const ext = filename.split('.').pop()?.toLowerCase();
  const type = audio.type || (ext === 'webm' ? 'audio/webm' : ext === 'ogg' ? 'audio/ogg' : ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4');
  const res = await fetch(`https://api.deepgram.com/v1/listen?${q}`, {
    method: 'POST', headers: { Authorization: `Token ${key}`, 'Content-Type': type }, body: audio,
  });
  if (!res.ok) throw new Error(`Deepgram failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const out = await res.json();
  const segments: Segment[] = [];
  for (const u of out?.results?.utterances || []) {
    const sp = String((u.speaker ?? 0) + 1), text = String(u.transcript || '').trim();
    if (!text) continue;
    const start_ms = Math.round((u.start ?? 0) * 1000), end_ms = Math.round((u.end ?? 0) * 1000);
    const last = segments[segments.length - 1];
    if (last && last.speaker === sp) { last.text += ' ' + text; last.end_ms = end_ms; }
    else segments.push({ speaker: sp, start_ms, end_ms, text });
  }
  const text = String(out?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '') || segments.map((s) => s.text).join(' ');
  return { text, segments };
}

export type Draft = { summary: string; outcome: string | null; follow_up: string | null; follow_up_when: string | null };

/** Gemini: a short draft the staff member confirms. Outcome is limited to the CRM's call outcomes. */
export async function summarise(transcript: string, outcomes: string[], about: string): Promise<Draft> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set on the server.');
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: 'You summarise calls and talks for staff at Stint Academy, a training and placement institute in India. Write plain, short English that a busy counsellor can read in ten seconds. Do not invent facts that are not in the transcript. Never include ID, bank or card numbers.' }] },
      contents: [{ role: 'user', parts: [{ text: `Person: ${about}\n\nTranscript (speaker numbers are from automatic diarisation; the conversation may mix English, Hindi, Telugu or Kannada):\n${transcript}\n\nReturn: summary (2–4 sentences), outcome (one of the allowed values, or null if unclear), follow_up (the next action, or null), follow_up_when (e.g. "tomorrow 11 am", or null).` }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            summary: { type: 'STRING' },
            outcome: { type: 'STRING', enum: outcomes, nullable: true },
            follow_up: { type: 'STRING', nullable: true },
            follow_up_when: { type: 'STRING', nullable: true },
          },
          required: ['summary'],
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no summary.');
  const d = JSON.parse(text);
  return { summary: String(d.summary || '').trim(), outcome: outcomes.includes(d.outcome) ? d.outcome : null, follow_up: d.follow_up || null, follow_up_when: d.follow_up_when || null };
}

export const asText = (segments: Segment[]) =>
  segments.map((s) => `[${Math.floor(s.start_ms / 60000)}:${String(Math.floor((s.start_ms % 60000) / 1000)).padStart(2, '0')}] Speaker ${s.speaker}: ${s.text}`).join('\n');

/** Transcribe and summarise one recording; saves the result or the problem on the row. */
export async function processRecording(db: SupabaseClient, id: string) {
  const { data: rec } = await db.from('recording').select('*, lead:lead_id(full_name), candidate:candidate_id(full_name)').eq('id', id).single();
  if (!rec?.audio_path) throw new Error('This recording has no audio.');
  await db.from('recording').update({ status: 'Transcribing', process_error: null }).eq('id', id);
  try {
    const file = await db.storage.from('recordings').download(rec.audio_path);
    if (file.error || !file.data) throw new Error('Could not read the audio: ' + (file.error?.message || 'missing'));
    const { text, segments } = await transcribe(file.data, rec.audio_path.split('/').pop()!);
    await db.from('recording').update({ transcript: segments, transcript_text: text }).eq('id', id);
    const { data: vals } = await db.from('dropdown_value').select('value').eq('list_id', 'call_outcome').eq('active', true).order('sort');
    const about = rec.lead?.full_name ? 'lead ' + rec.lead.full_name : rec.candidate?.full_name ? 'candidate ' + rec.candidate.full_name : 'unknown caller' + (rec.number ? ' ' + rec.number : '');
    const draft = text.trim() ? await summarise(asText(segments), (vals || []).map((v: { value: string }) => v.value), about)
      : { summary: 'No speech was heard in this recording.', outcome: null, follow_up: null, follow_up_when: null };
    const matched = !!(rec.lead_id || rec.candidate_id);
    await db.from('recording').update({ draft, status: matched ? 'Waiting to confirm' : 'Unmatched' }).eq('id', id);
    return { ok: true, draft };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from('recording').update({ status: rec.lead_id || rec.candidate_id ? 'Recorded' : 'Unmatched', process_error: msg }).eq('id', id);
    return { ok: false, error: msg };
  }
}
