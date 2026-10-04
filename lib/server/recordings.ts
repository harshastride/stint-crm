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

export type Segment = { speaker: string; start_ms: number; end_ms: number; text: string };

const SONIOX = 'https://api.soniox.com';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Soniox async transcription: upload, transcribe (English + Indian languages, speakers), fetch, clean up. */
export async function transcribe(audio: Blob, filename: string): Promise<{ text: string; segments: Segment[] }> {
  const key = process.env.SONIOX_API_KEY;
  if (!key) throw new Error('SONIOX_API_KEY is not set on the server.');
  const auth = { Authorization: `Bearer ${key}` };
  const form = new FormData();
  form.append('file', audio, filename);
  const up = await fetch(`${SONIOX}/v1/files`, { method: 'POST', headers: auth, body: form });
  if (!up.ok) throw new Error(`Soniox upload failed (${up.status}): ${await up.text()}`);
  const fileId = (await up.json()).id as string;
  let tid: string | null = null;
  try {
    const tr = await fetch(`${SONIOX}/v1/transcriptions`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.SONIOX_MODEL || 'stt-async-v5', file_id: fileId, language_hints: ['en', 'hi', 'te', 'kn'], enable_speaker_diarization: true }),
    });
    if (!tr.ok) throw new Error(`Soniox transcription failed (${tr.status}): ${await tr.text()}`);
    tid = (await tr.json()).id as string;
    for (let i = 0; ; i++) {
      if (i > 120) throw new Error('Soniox took too long (over 4 minutes).');
      await sleep(2000);
      const st = await (await fetch(`${SONIOX}/v1/transcriptions/${tid}`, { headers: auth })).json();
      if (st.status === 'completed') break;
      if (st.status === 'error') throw new Error('Soniox: ' + (st.error_message || 'transcription error'));
    }
    const out = await (await fetch(`${SONIOX}/v1/transcriptions/${tid}/transcript`, { headers: auth })).json();
    const segments: Segment[] = [];
    for (const t of out.tokens || []) {
      const sp = t.speaker == null ? '1' : String(t.speaker);
      const last = segments[segments.length - 1];
      if (last && last.speaker === sp) { last.text += t.text; last.end_ms = t.end_ms ?? last.end_ms; }
      else segments.push({ speaker: sp, start_ms: t.start_ms ?? 0, end_ms: t.end_ms ?? 0, text: t.text });
    }
    segments.forEach((s) => (s.text = s.text.trim()));
    return { text: out.text || segments.map((s) => s.text).join(' '), segments: segments.filter((s) => s.text) };
  } finally {
    if (tid) await fetch(`${SONIOX}/v1/transcriptions/${tid}`, { method: 'DELETE', headers: auth }).catch(() => {});
    await fetch(`${SONIOX}/v1/files/${fileId}`, { method: 'DELETE', headers: auth }).catch(() => {});
  }
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
