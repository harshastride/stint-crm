'use client';
import { useEffect, useState } from 'react';

export const rupees = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

const THUMB = 'stint-range pointer-events-none absolute inset-0 h-11 w-full appearance-none bg-transparent [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:cursor-pointer [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:cursor-pointer';
const trackOff = { '--fill': '0%', '--surface2': 'transparent', '--bar': '#4474B9' } as React.CSSProperties;

/** Pick a low and high amount by dragging two handles or typing. Arrow keys move the focused handle. */
export function RangeSlider({ label, min, max, value, onChange }: { label: string; min: number; max: number; value: [number, number]; onChange: (v: [number, number]) => void }) {
  const span = Math.max(1, max - min);
  const step = span > 100000 ? 1000 : span > 10000 ? 500 : span > 1000 ? 100 : 1;
  const [lo, hi] = value;
  const [text, setText] = useState<[string, string]>([String(lo), String(hi)]);
  useEffect(() => setText([String(lo), String(hi)]), [lo, hi]);
  const pct = (v: number) => (100 * (v - min)) / span;
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const commit = (i: 0 | 1, raw: string) => {
    const n = Number(raw.replace(/[^\d.]/g, ''));
    if (!raw.trim() || isNaN(n)) { setText([String(lo), String(hi)]); return; }
    const v = clamp(n);
    onChange(i === 0 ? [Math.min(v, hi), hi] : [lo, Math.max(v, lo)]);
  };
  const box = 'num h-10 w-full rounded-[10px] border border-line2 bg-surface px-3 text-[13.5px]';
  return (
    <div className="flex flex-col gap-2 px-2.5 py-2">
      <div className="relative h-11">
        <div aria-hidden className="absolute inset-x-0 top-[18px] h-2 rounded-full bg-surface2" />
        <div aria-hidden className="absolute top-[18px] h-2 rounded-full bg-accent" style={{ left: pct(lo) + '%', width: Math.max(0, pct(hi) - pct(lo)) + '%' }} />
        <input type="range" min={min} max={max} step={step} value={lo} aria-label={label + ' from'} aria-valuetext={rupees(lo)}
          onChange={(e) => onChange([Math.min(Number(e.target.value), hi), hi])} className={THUMB} style={trackOff} />
        <input type="range" min={min} max={max} step={step} value={hi} aria-label={label + ' up to'} aria-valuetext={rupees(hi)}
          onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo)])} className={THUMB} style={trackOff} />
      </div>
      <div className="flex items-center gap-2">
        <label className="flex flex-1 flex-col gap-0.5 text-[11.5px] text-muted">From (₹)
          <input inputMode="numeric" className={box} value={text[0]} aria-label={label + ' from, in rupees'}
            onChange={(e) => setText([e.target.value, text[1]])} onBlur={(e) => commit(0, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit(0, e.currentTarget.value); }} />
        </label>
        <label className="flex flex-1 flex-col gap-0.5 text-[11.5px] text-muted">Up to (₹)
          <input inputMode="numeric" className={box} value={text[1]} aria-label={label + ' up to, in rupees'}
            onChange={(e) => setText([text[0], e.target.value])} onBlur={(e) => commit(1, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit(1, e.currentTarget.value); }} />
        </label>
      </div>
      <div className="flex justify-between text-[11.5px] text-muted"><span>{rupees(min)}</span><span>{rupees(max)}</span></div>
    </div>
  );
}
