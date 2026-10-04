'use client';
import { useEffect, useState } from 'react';

// Numbers that count up when they first show ("₹4,29,500", "12", "83%"); the text around the number is kept.
export function CountUp({ value, ms = 700 }: { value: string | number; ms?: number }) {
  const text = String(value);
  const m = text.match(/[\d,]+(\.\d+)?/);
  const target = m ? Number(m[0].replace(/,/g, '')) : NaN;
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!Number.isFinite(target) || target === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(target); return; }
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / ms); setN(Math.round(target * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  if (!m || !Number.isFinite(target)) return <>{text}</>;
  const shown = m[0].includes(',') || text.includes('₹') ? n.toLocaleString('en-IN') : String(n);
  return <span aria-label={text}><span aria-hidden>{text.slice(0, m.index) + shown + text.slice((m.index || 0) + m[0].length)}</span></span>;
}
