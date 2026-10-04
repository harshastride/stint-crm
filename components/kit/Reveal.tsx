'use client';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type RevealKind = 'lead' | 'candidate';
type Status = { allowed: boolean; reason: string | null; seconds: number };

declare global { interface Window { __stintRevealSeconds?: number } }

// one status call per person, shared by every field and button on screen
const statusCache = new Map<string, Promise<Status>>();
export function contactStatus(kind: RevealKind, id: string, fresh = false): Promise<Status> {
  const key = kind + ':' + id;
  if (fresh || !statusCache.has(key)) {
    statusCache.set(key, (async () => {
      const { data, error } = await supabase().rpc('contact_status', { p_kind: kind, p_id: id });
      if (error || !data) return { allowed: false, reason: error?.message || 'Not available', seconds: 60 };
      return { allowed: !!data.allowed, reason: data.reason ?? null, seconds: Number(data.seconds) || 60 };
    })());
  }
  return statusCache.get(key)!;
}

let secondsCache: Promise<number> | null = null;
async function revealSeconds(kind: RevealKind, id: string): Promise<number> {
  if (typeof window !== 'undefined' && window.__stintRevealSeconds) return window.__stintRevealSeconds;
  secondsCache ??= (async () => {
    const { data } = await supabase().from('setting').select('value').eq('key', 'reveal_seconds').maybeSingle();
    const n = Number((data as { value?: unknown } | null)?.value);
    if (n > 0) return n;
    return (await contactStatus(kind, id)).seconds || 60;
  })();
  return secondsCache;
}

/** Fetches the full value once (logged on the server). Returns null and the reason if not allowed. */
export async function revealOnce(kind: RevealKind, id: string, field: string): Promise<string | null> {
  const r = await revealWithReason(kind, id, field);
  return r.value;
}
async function revealWithReason(kind: RevealKind, id: string, field: string): Promise<{ value: string | null; reason?: string }> {
  const { data, error } = await supabase().rpc('reveal_contact', { p_kind: kind, p_id: id, p_field: field });
  if (error) return { value: null, reason: error.message };
  return { value: data == null ? null : String(data) };
}

export function Reveal({ kind, id, field, masked, label, onRevealed }: { kind: RevealKind; id: string; field: string; masked: string | null | undefined; label?: string; onRevealed?: (value: string) => void }) {
  const [value, setValue] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [status, setStatus] = useState<Status | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { let on = true; contactStatus(kind, id).then((st) => { if (on) setStatus(st); }); return () => { on = false; }; }, [kind, id]);
  const hide = () => { if (timer.current) clearInterval(timer.current); timer.current = null; setValue(null); setLeft(0); };
  useEffect(() => hide, [kind, id, field]);
  useEffect(() => { if (value != null && left <= 0) hide(); }, [value, left]);

  if (!masked) return <span className="text-muted">—</span>;
  const name = label || field;

  const show = async () => {
    setBusy(true);
    const [r, secs] = await Promise.all([revealWithReason(kind, id, field), revealSeconds(kind, id)]);
    setBusy(false);
    if (r.value == null) { setReason(r.reason || 'Not allowed'); return; }
    setValue(r.value); setLeft(secs); onRevealed?.(r.value);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => setLeft((n) => n - 1), 1000);
  };

  const locked = status && !status.allowed;
  const why = reason || (locked ? status!.reason : null);
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2" data-reveal={field}>
      <span className="num font-medium" aria-live="polite">{value ?? masked}</span>
      {value != null ? (
        <>
          <span className="text-[11.5px] text-muted">Hides in {left}s</span>
          <button type="button" onClick={hide} aria-label={'Hide ' + name + ' now'} className="inline-flex min-h-[44px] items-center gap-1 rounded-[10px] border border-line2 bg-surface px-2.5 text-xs font-semibold text-text2"><EyeOff size={14} aria-hidden />Hide now</button>
        </>
      ) : locked || reason ? (
        <span className="inline-flex items-center gap-1 text-[11.5px] text-muted" title={why || ''}><Lock size={13} aria-hidden />{why}</span>
      ) : (
        <button type="button" disabled={busy} onClick={show} aria-label={'Show ' + name} className="inline-flex min-h-[44px] items-center gap-1 rounded-[10px] border border-line2 bg-surface px-2.5 text-xs font-semibold text-accentText disabled:opacity-50"><Eye size={14} aria-hidden />Show</button>
      )}
    </span>
  );
}
