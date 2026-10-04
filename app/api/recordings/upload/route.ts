import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { processRecording, service } from '@/lib/server/recordings';

export const maxDuration = 300;

// 4.4 Upload from the Android companion app (call recordings).
// POST multipart/form-data, header x-api-key: <incoming key from the Automation log>
//   audio (file), staff_email, number (the other phone), called_at (ISO time), duration_sec, direction ("in" | "out")
// The recording is matched to a lead or candidate by number; unmatched ones wait on the Recordings page.
// Consent: the app must only upload calls where the other person was told the call is recorded (consent=yes).
export async function POST(request: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  const db = service();
  const key = request.headers.get('x-api-key') || '';
  const { data: cfg } = await db.from('integration_config').select('value').eq('key', 'incoming_api_key').single();
  if (!cfg?.value || key.length !== cfg.value.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(cfg.value))) return NextResponse.json({ error: 'Wrong or missing API key.' }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const audio = form?.get('audio');
  if (!form || !(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ error: 'Send the audio file as "audio".' }, { status: 400 });
  if (audio.size > 100 * 1024 * 1024) return NextResponse.json({ error: 'Audio over 100 MB.' }, { status: 413 });
  if (String(form.get('consent') || '') !== 'yes') return NextResponse.json({ error: 'consent=yes is required: only upload calls the other person agreed to record.' }, { status: 400 });
  const email = String(form.get('staff_email') || '').trim().toLowerCase();
  const { data: staff } = await db.from('staff').select('id').eq('email', email).eq('status', 'Active').maybeSingle();
  if (!staff) return NextResponse.json({ error: 'No active staff member with that email.' }, { status: 400 });

  const number = String(form.get('number') || '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  const lead = number ? (await db.from('lead').select('id').eq('mobile', number).maybeSingle()).data : null;
  const cand = !lead && number ? (await db.from('candidate_private').select('candidate_id').eq('contact->>mobile', number).maybeSingle()).data : null;
  const calledAt = String(form.get('called_at') || '') || new Date().toISOString();
  const { data: rec, error } = await db.from('recording').insert({
    lead_id: lead?.id || null, candidate_id: cand?.candidate_id || null, number: number || null, captured_by: staff.id,
    source: 'Phone app' + (form.get('direction') === 'in' ? ' · incoming' : form.get('direction') === 'out' ? ' · outgoing' : ''),
    length_sec: Number(form.get('duration_sec') || 0) || 0, consent: true, called_at: calledAt,
    status: lead || cand ? 'Recorded' : 'Unmatched',
  }).select('id').single();
  if (error || !rec) return NextResponse.json({ error: error?.message || 'Could not save.' }, { status: 400 });
  const ext = (audio.type.split('/')[1] || 'm4a').replace(/[^a-z0-9]/g, '').slice(0, 5) || 'm4a';
  const path = `${rec.id}.${ext}`;
  const up = await db.storage.from('recordings').upload(path, audio, { contentType: audio.type || 'audio/mp4' });
  if (up.error) { await db.from('recording').delete().eq('id', rec.id); return NextResponse.json({ error: 'Upload failed: ' + up.error.message }, { status: 500 }); }
  await db.from('recording').update({ audio_path: path }).eq('id', rec.id);
  const processed = process.env.SONIOX_API_KEY && process.env.GEMINI_API_KEY ? await processRecording(db, rec.id) : { ok: false, error: 'Transcription keys are not set; audio saved.' };
  return NextResponse.json({ ok: true, recording_id: rec.id, matched: !!(lead || cand), processed }, { status: 201 });
}
