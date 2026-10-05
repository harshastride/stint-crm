import { fail, safeEqual } from '@/lib/server/guard';
import { NextResponse } from 'next/server';
import { aiReady, processRecording, service, staffFromBearer } from '@/lib/server/recordings';

export const maxDuration = 300;

// 4.4 Upload from the Stint Notes phone app (talks recorded on the phone's mic, or call recordings).
// POST multipart/form-data, either
//   header Authorization: Bearer <staff login token from /api/mobile/login>   (the phone app), or
//   header x-api-key: <incoming key from the Automation log> plus staff_email  (other automations)
//   audio (file), number (the other phone, optional), called_at (ISO time), duration_sec, direction ("in" | "out" | "talk")
// The recording is matched to a lead or candidate by number; unmatched ones wait on the Recordings page.
// Consent: the app must only upload calls where the other person was told the call is recorded (consent=yes).
export async function POST(request: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  const db = service();
  const signedIn = await staffFromBearer(request);
  if (!signedIn) {
    const key = request.headers.get('x-api-key') || '';
    const { data: cfg } = await db.from('integration_config').select('value').eq('key', 'incoming_api_key').single();
    if (!safeEqual(key, cfg?.value)) return NextResponse.json({ error: 'Sign in again, or send the right API key.' }, { status: 401 });
  }

  const form = await request.formData().catch(() => null);
  const audio = form?.get('audio');
  if (!form || !(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ error: 'Send the audio file as "audio".' }, { status: 400 });
  if (audio.type && !/^(audio|video)\/[a-z0-9.+-]+$/i.test(audio.type)) return NextResponse.json({ error: 'Send an audio file.' }, { status: 415 });
  if (audio.size > 100 * 1024 * 1024) return NextResponse.json({ error: 'Audio over 100 MB.' }, { status: 413 });
  if (String(form.get('consent') || '') !== 'yes') return NextResponse.json({ error: 'consent=yes is required: only upload calls the other person agreed to record.' }, { status: 400 });
  const email = String(form.get('staff_email') || '').trim().toLowerCase();
  const staff = signedIn || (await db.from('staff').select('id').eq('email', email).eq('status', 'Active').maybeSingle()).data;
  if (!staff) return NextResponse.json({ error: 'No active staff member with that email.' }, { status: 400 });

  const number = String(form.get('number') || '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  const lead = number ? (await db.from('lead').select('id').eq('mobile', number).maybeSingle()).data : null;
  const cand = !lead && number ? (await db.from('candidate_private').select('candidate_id').eq('contact->>mobile', number).maybeSingle()).data : null;
  const rawAt = new Date(String(form.get('called_at') || ''));
  const calledAt = isNaN(rawAt.getTime()) ? new Date().toISOString() : rawAt.toISOString();
  const { data: rec, error } = await db.from('recording').insert({
    lead_id: lead?.id || null, candidate_id: cand?.candidate_id || null, number: number || null, captured_by: staff.id,
    source: 'Phone app' + ({ in: ' · incoming', out: ' · outgoing', talk: ' · in person' }[String(form.get('direction'))] || ''),
    length_sec: Number(form.get('duration_sec') || 0) || 0, consent: true, called_at: calledAt,
    status: lead || cand ? 'Recorded' : 'Unmatched',
  }).select('id').single();
  if (error || !rec) return fail('recordings/upload', error, 'Could not save.', 400);
  const sub = (audio.type.split('/')[1] || '').toLowerCase();
  const ext = ['webm', 'ogg', 'mp4', 'm4a', 'mpeg', 'wav', 'aac', 'amr', '3gpp', 'x-m4a'].includes(sub) ? sub.replace(/^x-/, '') : 'm4a';
  const path = `${rec.id}.${ext}`;
  const up = await db.storage.from('recordings').upload(path, audio, { contentType: audio.type || 'audio/mp4', upsert: false });
  if (up.error) { await db.from('recording').delete().eq('id', rec.id); return fail('recordings/upload storage', up.error, 'Upload failed.'); }
  await db.from('recording').update({ audio_path: path }).eq('id', rec.id);
  const processed = aiReady() ? await processRecording(db, rec.id) : { ok: false, error: 'Transcription keys are not set; audio saved.' };
  return NextResponse.json({ ok: true, recording_id: rec.id, matched: !!(lead || cand), processed }, { status: 201 });
}
