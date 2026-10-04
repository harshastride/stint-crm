'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { PersonRef } from '@/lib/pages';
import { Button, Notice } from './ui';
import { friendlyError } from './Fields';

const fmt = (s: number) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

/** Record a talk with a lead or candidate. Needs their spoken agreement (the tick); audio is stored privately,
 *  then transcribed and summarised on the server. The summary is a draft that someone confirms on the Recordings page. */
export function Recorder({ person, onSaved }: { person: PersonRef; onSaved: (msg: string) => void }) {
  const s = useSession();
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<'idle' | 'recording' | 'saving'>('idle');
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); rec.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  const start = async () => {
    setErr(null);
    if (!consent) { setErr('Tick that they agreed to be recorded first.'); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setErr('This browser can’t record audio.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = () => { stream.getTracks().forEach((t) => t.stop()); save(r.mimeType || type || 'audio/webm'); };
      r.start(1000);
      rec.current = r; started.current = Date.now(); setSecs(0); setState('recording');
      timer.current = setInterval(() => setSecs(Math.round((Date.now() - started.current) / 1000)), 500);
    } catch {
      setErr('Microphone not allowed. Allow it in the browser’s address bar and try again.');
    }
  };

  const stop = () => { if (timer.current) clearInterval(timer.current); setState('saving'); rec.current?.stop(); };

  const save = async (mime: string) => {
    const blob = new Blob(chunks.current, { type: mime });
    const length = Math.round((Date.now() - started.current) / 1000);
    const db = supabase();
    const { data: row, error } = await db.from('recording').insert({
      [person.kind === 'lead' ? 'lead_id' : 'candidate_id']: person.id, captured_by: s.staff.id, source: 'Record button',
      length_sec: length, consent: true, status: 'Recorded', called_at: new Date(started.current).toISOString(),
    }).select('id').single();
    if (error || !row) { setState('idle'); setErr(friendlyError(error)); return; }
    const ext = mime.includes('mp4') ? 'm4a' : 'webm';
    const path = `${row.id}.${ext}`;
    const up = await db.storage.from('recordings').upload(path, blob, { contentType: mime });
    if (up.error) { await db.from('recording').delete().eq('id', row.id); setState('idle'); setErr('Could not save the audio: ' + up.error.message); return; }
    await db.from('recording').update({ audio_path: path }).eq('id', row.id);
    setState('idle'); setConsent(false);
    onSaved(`Recording saved (${fmt(length)}). The transcript and summary will appear on the Recordings page to confirm.`);
    // transcription runs on the server; the page does not wait for it
    fetch('/api/recordings/process', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.id }) }).catch(() => {});
  };

  return (
    <div className="flex flex-col gap-2 rounded-[12px] border border-accent p-3">
      <div className="text-sm font-semibold">Record this talk</div>
      {state === 'idle' && (
        <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-[13px]">
          <input type="checkbox" className="h-5 w-5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>I told them this is recorded and they agreed</span>
        </label>
      )}
      {state === 'recording' ? (
        <Button variant="danger" onClick={stop}><span className="flex items-center justify-center gap-2"><Square size={14} /> Stop · {fmt(secs)}</span></Button>
      ) : (
        <Button variant="primary" disabled={state === 'saving' || !consent} onClick={start}>
          <span className="flex items-center justify-center gap-2"><Mic size={15} /> {state === 'saving' ? 'Saving…' : 'Start recording'}</span>
        </Button>
      )}
      {state === 'recording' && <div className="flex items-center gap-2 text-[12px] text-badText"><span className="h-2 w-2 animate-pulse rounded-full bg-badText" /> Recording</div>}
      {err && <Notice tone="bad">{err}</Notice>}
    </div>
  );
}
