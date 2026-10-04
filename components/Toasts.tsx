'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Undo2, X } from 'lucide-react';
import { cx } from './ui';

// Small messages in the corner that go away by themselves. Ones that change data offer Undo for a few seconds.
type Toast = { id: number; text: string; tone: 'good' | 'bad'; undo?: () => Promise<unknown> | void; ms: number };
type Show = (text: string, opts?: { tone?: 'good' | 'bad'; undo?: () => Promise<unknown> | void; ms?: number }) => void;
const Ctx = createContext<Show>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const seq = useRef(0);
  const show = useCallback<Show>((text, opts = {}) => {
    const t: Toast = { id: ++seq.current, text, tone: opts.tone || 'good', undo: opts.undo, ms: opts.ms ?? (opts.undo ? 6000 : opts.tone === 'bad' ? 7000 : 3500) };
    setList((l) => [...l.slice(-3), t]);
  }, []);
  const drop = (id: number) => setList((l) => l.filter((t) => t.id !== id));
  return (
    <Ctx.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-3 bottom-3 z-[70] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:items-end">
        {list.map((t) => <ToastItem key={t.id} t={t} onDone={() => drop(t.id)} />)}
      </div>
    </Ctx.Provider>
  );
}

function ToastItem({ t, onDone }: { t: Toast; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(t.ms);
  const paused = useRef(false);
  useEffect(() => {
    const step = 100;
    const timer = setInterval(() => { if (!paused.current) setLeft((x) => x - step); }, step);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { if (left <= 0) onDone(); }, [left, onDone]);
  const Icon = t.tone === 'bad' ? AlertTriangle : CheckCircle2;
  return (
    <div role={t.tone === 'bad' ? 'alert' : 'status'} onMouseEnter={() => (paused.current = true)} onMouseLeave={() => (paused.current = false)}
      className="anim-rise pointer-events-auto relative flex w-full max-w-[420px] items-center gap-3 overflow-hidden rounded-xl border border-line bg-ink px-3.5 py-3 text-[13px] text-white shadow-2xl sm:w-auto sm:min-w-[300px]">
      <Icon size={17} className={cx('shrink-0', t.tone === 'bad' ? 'text-[#FFB18F]' : 'text-[#7EE2A8]')} aria-hidden />
      <span className="min-w-0 flex-1 leading-snug">{t.text}</span>
      {t.undo && (
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await t.undo!(); } finally { onDone(); } }}
          className="flex min-h-[34px] shrink-0 items-center gap-1 rounded-lg bg-white/15 px-2.5 font-semibold hover:bg-white/25"><Undo2 size={14} />{busy ? 'Undoing…' : 'Undo'}</button>
      )}
      <button type="button" aria-label="Dismiss" onClick={onDone} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/70 hover:bg-white/10"><X size={14} /></button>
      {t.undo && <span aria-hidden className="absolute bottom-0 left-0 h-0.5 bg-coral" style={{ width: Math.max(0, (100 * left) / t.ms) + '%', transition: 'width .1s linear' }} />}
    </div>
  );
}
