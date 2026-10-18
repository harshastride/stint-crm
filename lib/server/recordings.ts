import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { askJson, claudeReady, MODEL_FAST, obj, oneOfOrNull, scrub, str, strOrNull } from './ai';

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

/** Deepgram (speech to text) and Claude (summary) keys are both on the server, so uploads can be transcribed straight away. */
export const aiReady = () => !!process.env.DEEPGRAM_API_KEY && claudeReady();

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

/** Claude (fast model): a short draft the staff member confirms. Outcome is limited to the CRM's call outcomes. */
export async function summarise(transcript: string, outcomes: string[], about: string, staffId: string | null = null): Promise<Draft> {
  const d = await askJson<Draft>({
    feature: 'call_summary', staffId, model: MODEL_FAST, maxTokens: 2000,
    system: 'You summarise calls and talks for staff at Stint Academy, a training and placement institute in India. Write plain, short English that a busy counsellor can read in ten seconds. Do not invent facts that are not in the transcript. Never include ID, bank or card numbers.',
    prompt: `Person: ${about}\n\nTranscript (speaker numbers are from automatic diarisation; the conversation may mix English, Hindi, Telugu or Kannada):\n${scrub(transcript)}\n\nReturn: summary (2–4 sentences), outcome (one of the allowed values, or null if unclear), follow_up (the next action, or null), follow_up_when (e.g. "tomorrow 11 am", or null).`,
    schema: obj({ summary: str, outcome: oneOfOrNull(outcomes), follow_up: strOrNull, follow_up_when: strOrNull }),
  });
  return { summary: String(d.summary || '').trim(), outcome: d.outcome && outcomes.includes(d.outcome) ? d.outcome : null, follow_up: d.follow_up || null, follow_up_when: d.follow_up_when || null };
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
    const about = rec.lead?.full_name ? 'lead ' + rec.lead.full_name : rec.candidate?.full_name ? 'candidate ' + rec.candidate.full_name : 'unknown caller';
    const draft = text.trim() ? await summarise(asText(segments), (vals || []).map((v: { value: string }) => v.value), about, rec.captured_by || null)
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

export type Dictation = { clean_text: string; summary: string; outcome: string | null; follow_up: string | null; follow_up_when: string | null };
const DICTATION_CONTEXT: Record<string, string> = {
  note: 'a note on a lead or candidate record', call: 'notes about a phone call that just happened',
  enquiry: 'notes taken at the front desk about a walk-in enquiry', field: 'text for a form field',
};

/** Claude (fast model): turn a staff member's spoken dictation into clean English text. Staff review it before saving. */
export async function cleanDictation(transcript: string, context: string, staffId: string | null = null): Promise<Dictation> {
  const d = await askJson<Dictation>({
    feature: 'voice_note', staffId, model: MODEL_FAST, maxTokens: 3000,
    system: 'You clean up dictated notes for staff at Stint Academy, a training and placement institute in India (courses such as Data Analytics, Data Science, Full Stack, Python, Power BI, SQL, Azure, AWS, Testing). The speech may mix English, Telugu and Hindi. Fix transcription mistakes, names and course terms, add punctuation, and translate everything into clear, plain English in the first person as the staff member said it. Keep every fact; do not add facts. Never include ID, bank or card numbers.',
    prompt: `This is ${DICTATION_CONTEXT[context] || DICTATION_CONTEXT.field}.\n\nRaw transcript:\n${scrub(transcript)}\n\nReturn: clean_text (the cleaned note), summary (1–2 lines), outcome (the call outcome if one is clearly said, else null), follow_up (next action if one is said, else null), follow_up_when (when, e.g. "tomorrow 11 am", else null).`,
    schema: obj({ clean_text: str, summary: str, outcome: strOrNull, follow_up: strOrNull, follow_up_when: strOrNull }),
  });
  return { clean_text: String(d.clean_text || '').trim(), summary: String(d.summary || '').trim(), outcome: d.outcome || null, follow_up: d.follow_up || null, follow_up_when: d.follow_up_when || null };
}
