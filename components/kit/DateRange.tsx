'use client';
import { useEffect, useRef, useState } from 'react';
import { CalendarRange, X } from 'lucide-react';
import { cx } from '../ui';

// One button for a date range: quick picks (Today, This week, Last month…) or your own from–to dates.
export type Range = { from: string; to: string; label: string } | null;   // from/to are YYYY-MM-DD, both inclusive
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const add = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export function presets(): Exclude<Range, null>[] {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const mon = add(t, -((t.getDay() + 6) % 7));
  const m0 = new Date(t.getFullYear(), t.getMonth(), 1), m1 = new Date(t.getFullYear(), t.getMonth() - 1, 1);
  return [
    { label: 'Today', from: iso(t), to: iso(t) }, { label: 'Yesterday', from: iso(add(t, -1)), to: iso(add(t, -1)) },
    { label: 'This week', from: iso(mon), to: iso(t) }, { label: 'Last 7 days', from: iso(add(t, -6)), to: iso(t) },
    { label: 'This month', from: iso(m0), to: iso(t) }, { label: 'Last month', from: iso(m1), to: iso(add(m0, -1)) },
    { label: 'Last 90 days', from: iso(add(t, -89)), to: iso(t) },
  ];
}
/** Is this timestamp / date inside the range (local days)? */
export const inRange = (v: unknown, r: Range) => {
  if (!r) return true; if (!v) return false;
  const d = iso(new Date(String(v).length === 10 ? String(v) + 'T00:00' : String(v)));
  return d >= r.from && d <= r.to;
};
const nice = (s: string) => new Date(s + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export function DateRange({ value, onChange, label = 'Dates', className }: { value: Range; onChange: (r: Range) => void; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(value?.from || ''), [to, setTo] = useState(value?.to || '');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away); return () => document.removeEventListener('mousedown', away);
  }, [open]);
  return (
    <div ref={box} className={cx('relative', className)}>
      <span className={cx('flex h-[38px] items-center rounded-[10px] border text-[13px] font-medium', value ? 'border-accent bg-accentSoft text-accentText' : 'border-line2 bg-surface')}>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex h-full items-center gap-1.5 px-3">
          <CalendarRange size={14} aria-hidden />{value ? (value.label || `${nice(value.from)} – ${nice(value.to)}`) : label}
        </button>
        {value && <button type="button" aria-label="Clear dates" onClick={() => onChange(null)} className="flex h-full w-7 items-center justify-center"><X size={13} /></button>}
      </span>
      {open && (
        <div role="dialog" aria-label="Pick dates" className="absolute left-0 z-30 mt-1 flex w-[min(300px,calc(100vw-32px))] flex-col gap-2 rounded-xl border border-line bg-surface p-2 shadow-lg sm:w-[420px] sm:flex-row">
          <div className="flex flex-wrap gap-1 sm:w-[140px] sm:flex-col">
            {presets().map((p) => (
              <button key={p.label} type="button" onClick={() => { onChange(p); setOpen(false); }}
                className={cx('min-h-[36px] rounded-lg px-2.5 text-left text-[13px]', value?.label === p.label ? 'bg-accent text-white' : 'hover:bg-surface2')}>{p.label}</button>
            ))}
          </div>
          <form className="flex flex-1 flex-col gap-2 border-line p-1 sm:border-l sm:pl-3" onSubmit={(e) => { e.preventDefault(); if (from && to) { const [a, b] = from <= to ? [from, to] : [to, from]; onChange({ from: a, to: b, label: '' }); setOpen(false); } }}>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Your own dates</span>
            <label className="text-[12.5px] text-text2">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-0.5 h-10 w-full px-2 text-[13px]" /></label>
            <label className="text-[12.5px] text-text2">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-0.5 h-10 w-full px-2 text-[13px]" /></label>
            <button type="submit" disabled={!from || !to} className="mt-auto min-h-[40px] rounded-lg bg-accent text-[13px] font-semibold text-white disabled:opacity-40">Apply</button>
          </form>
        </div>
      )}
    </div>
  );
}
