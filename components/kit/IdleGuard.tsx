'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

// Signs a person out after `idle_signout_minutes` (setting, default 30) without activity.
// Warns 2 minutes before. Activity in any tab of this browser keeps every tab alive (localStorage 'stint-last-active').
// Test hook: window.__stintIdleMs overrides the total idle time in ms (warning then shows at 80%).
const KEY = 'stint-last-active';
declare global { interface Window { __stintIdleMs?: number } }

const readShared = () => { try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; } };
const writeShared = (t: number) => { try { localStorage.setItem(KEY, String(t)); } catch {} };
const fmt = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

export function IdleGuard() {
  const [totalMs, setTotalMs] = useState<number>(() => (typeof window !== 'undefined' && window.__stintIdleMs) || 30 * 60_000);
  const [left, setLeft] = useState<number | null>(null); // ms left while the warning shows
  const last = useRef(Date.now());
  const warning = useRef(false);
  const done = useRef(false);

  useEffect(() => {
    if (window.__stintIdleMs) return;
    let off = false;
    (async () => {
      try {
        const { data } = await supabase().from('setting').select('value').eq('key', 'idle_signout_minutes').maybeSingle();
        const m = Number(data?.value);
        if (!off && m > 0) setTotalMs(m * 60_000);
      } catch { /* not readable for this role: keep 30 minutes */ }
    })();
    return () => { off = true; };
  }, []);

  useEffect(() => {
    const warnAt = window.__stintIdleMs ? totalMs * 0.8 : Math.max(totalMs - 120_000, totalMs * 0.5);
    const now = Date.now();
    last.current = now; writeShared(now);
    let lastWrite = now;
    const touch = () => {
      if (warning.current || done.current) return; // while warning, only the button counts
      const t = Date.now(); last.current = t;
      if (t - lastWrite > 1000) { lastWrite = t; writeShared(t); }
    };
    const onVis = () => { if (document.visibilityState === 'visible') touch(); };
    const evs = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart'] as const;
    evs.forEach((e) => window.addEventListener(e, touch, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', onVis);
    const tick = setInterval(async () => {
      if (done.current) return;
      const shared = readShared();
      if (shared > last.current) last.current = shared; // another tab was used
      const idle = Date.now() - last.current;
      if (idle >= totalMs) {
        done.current = true;
        try { await supabase().auth.signOut(); } catch {}
        window.location.href = '/login?reason=idle';
      } else if (idle >= warnAt) { warning.current = true; setLeft(totalMs - idle); }
      else if (warning.current) { warning.current = false; setLeft(null); }
    }, 500);
    return () => { clearInterval(tick); evs.forEach((e) => window.removeEventListener(e, touch, { capture: true })); document.removeEventListener('visibilitychange', onVis); };
  }, [totalMs]);

  const stay = () => { const t = Date.now(); last.current = t; writeShared(t); warning.current = false; setLeft(null); };

  if (left === null) return null;
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="idle-title" aria-describedby="idle-text" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-[380px] rounded-2xl border border-line bg-surface p-6 shadow-2xl">
        <h2 id="idle-title" className="text-lg font-semibold text-text">Still there?</h2>
        <p id="idle-text" className="mt-2 text-[14px] text-text2">You’ll be signed out in <span className="num font-semibold text-text">{fmt(left)}</span> to keep student data safe.</p>
        <button type="button" autoFocus onClick={stay} className="mt-5 flex h-12 w-full items-center justify-center rounded-[10px] bg-accent text-sm font-semibold text-white hover:brightness-110">Stay signed in</button>
      </div>
    </div>
  );
}
