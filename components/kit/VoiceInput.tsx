'use client';
import { useEffect, useRef, useState } from 'react';
import { cx } from '../ui';

export type DictationResult = { clean_text: string; summary: string; outcome: string | null; follow_up: string | null; follow_up_when: string | null; transcript: string };
type State = 'idle' | 'recording' | 'processing' | 'done' | 'error';
const MAX_SECONDS = 180;

/** Join an existing text and a new dictated piece with a space or new line. */
export const appendText = (old: string, add: string) => (!old.trim() ? add : old.replace(/\s+$/, '') + (old.endsWith('\n') ? '' : ' ') + add);

/**
 * Mic button: speak (English, Telugu, Hindi or mixed), the server transcribes and cleans it,
 * and `onText` receives a draft to put in the field. Nothing is saved here; staff review first.
 */
export function VoiceInput({ context, onText, label = 'Speak instead of typing', disabled }: {
  context: 'note' | 'call' | 'enquiry' | 'field'; onText: (text: string, result: DictationResult) => void; label?: string; disabled?: boolean;
}) {
  const [state, setState] = useState<State>('idle');
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cancelled = useRef(false);
  const timers = useRef<{ tick?: number; raf?: number; ctx?: AudioContext }>({});

  const cleanup = () => {
    window.clearInterval(timers.current.tick); if (timers.current.raf) cancelAnimationFrame(timers.current.raf);
    timers.current.ctx?.close().catch(() => {}); timers.current = {};
    stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setLevel(0);
  };
  useEffect(() => () => { cancelled.current = true; try { rec.current?.stop(); } catch {} cleanup(); }, []);

  const send = async (blob: Blob) => {
    setState('processing');
    try {
      const fd = new FormData();
      fd.append('audio', blob, 'dictation.' + (blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'));
      fd.append('context', context);
      const r = await fetch('/api/voice/dictate', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setState('error'); setMsg(j.error || 'Could not turn that into text.'); return; }
      if (j.empty || !String(j.clean_text || '').trim()) { setState('error'); setMsg('Couldn’t hear that. Try again a little closer to the mic.'); setRaw(null); return; }
      setRaw(j.transcript || null); setShowRaw(false);
      onText(j.clean_text, j as DictationResult);
      setState('done'); setMsg('Draft added. Check it before saving.');
    } catch { setState('error'); setMsg('No connection. Please try again or type it.'); }
  };

  const start = async () => {
    setMsg(null); setRaw(null);
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) { setState('error'); setMsg('This browser can’t record. Please type instead.'); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported?.(t));
      const r = new MediaRecorder(s, type ? { mimeType: type } : undefined);
      chunks.current = []; cancelled.current = false;
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = () => {
        cleanup();
        if (cancelled.current) { setState('idle'); return; }
        const blob = new Blob(chunks.current, { type: r.mimeType || 'audio/webm' });
        if (!blob.size) { setState('error'); setMsg('Couldn’t hear that. Try again a little closer to the mic.'); return; }
        send(blob);
      };
      rec.current = r; r.start(250);
      setSecs(0); setState('recording');
      const t0 = Date.now();
      timers.current.tick = window.setInterval(() => {
        const n = Math.floor((Date.now() - t0) / 1000); setSecs(n);
        if (n >= MAX_SECONDS) stop();
      }, 250);
      try {
        const ctx = new AudioContext(); const an = ctx.createAnalyser(); an.fftSize = 256;
        ctx.createMediaStreamSource(s).connect(an); timers.current.ctx = ctx;
        const buf = new Uint8Array(an.frequencyBinCount);
        const loop = () => { an.getByteTimeDomainData(buf); let m = 0; for (const b of buf) m = Math.max(m, Math.abs(b - 128)); setLevel(Math.min(1, m / 64)); timers.current.raf = requestAnimationFrame(loop); };
        loop();
      } catch { /* level meter is optional */ }
    } catch { cleanup(); setState('error'); setMsg('Microphone blocked. Allow the mic in your browser settings, or type instead.'); }
  };
  const stop = () => { try { if (rec.current?.state === 'recording') rec.current.stop(); } catch {} };
  const cancel = () => { cancelled.current = true; stop(); setMsg('Cancelled.'); };

  useEffect(() => {
    if (state !== 'recording') return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [state]);

  const mmss = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  return (
    <div className="flex flex-col gap-1" data-testid="voice-input">
      <div className="flex flex-wrap items-center gap-2">
        {state === 'recording' ? (
          <>
            <button type="button" onClick={stop} aria-label="Stop and turn into text"
              className="relative grid h-[44px] w-[44px] place-items-center rounded-full bg-coral text-white">
              <span aria-hidden className="absolute inset-0 rounded-full bg-coral opacity-40 transition-transform" style={{ transform: `scale(${1 + level * 0.45})` }} />
              <span aria-hidden className="relative h-3.5 w-3.5 rounded-[3px] bg-white" />
            </button>
            <span className="text-[13px] font-medium tabular-nums" aria-live="polite">Listening… {mmss}</span>
            <button type="button" onClick={cancel} className="min-h-[44px] rounded-lg px-3 text-[13px] text-text2 hover:bg-surface2">Cancel (Esc)</button>
          </>
        ) : (
          <button type="button" onClick={start} disabled={disabled || state === 'processing'} aria-label={label} title={label}
            className={cx('grid h-[44px] w-[44px] place-items-center rounded-full border border-line2 bg-surface text-accent hover:bg-accentSoft disabled:opacity-50')}>
            {state === 'processing'
              ? <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              : <svg aria-hidden viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>}
          </button>
        )}
        {state === 'processing' && <span className="text-[13px] text-text2" aria-live="polite">Turning your voice into text…</span>}
        {state === 'idle' && <span className="text-[12px] text-muted">Speak in English, Telugu or Hindi</span>}
        {(state === 'done' || state === 'error') && msg && <span role={state === 'error' ? 'alert' : 'status'} className={cx('text-[12.5px]', state === 'error' ? 'text-badText' : 'text-text2')}>{msg}</span>}
        {state === 'done' && raw && (
          <button type="button" onClick={() => setShowRaw((x) => !x)} className="min-h-[44px] rounded-lg px-2 text-[12.5px] text-accent underline-offset-2 hover:underline">
            {showRaw ? 'Hide what I said' : 'Show what I said'}
          </button>
        )}
      </div>
      {showRaw && raw && <p data-testid="voice-raw" className="rounded-lg bg-surface2 px-3 py-2 text-[12.5px] text-text2">{raw}</p>}
    </div>
  );
}
