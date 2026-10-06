'use client';
import { useEffect, useState } from 'react';

// Monthly target ring: "18 / 25 enrolments this month", coloured by pace against days elapsed,
// with "need X more, ~Y per day". The ring fills on load unless the person prefers reduced motion.
export function TargetRing({ value, target, label = 'enrolments this month', title = 'My monthly target', now = new Date() }:
  { value: number; target: number; label?: string; title?: string; now?: Date }) {
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const day = now.getDate();
  const expected = (target * day) / days;
  const done = value >= target;
  const onTrack = done || value >= Math.floor(expected);
  const need = Math.max(0, target - value);
  const left = days - day + 1;
  const perDay = need ? Math.ceil((need / left) * 10) / 10 : 0;
  const frac = target > 0 ? Math.min(1, value / target) : 0;
  const pct = Math.round(frac * 100);

  const [shown, setShown] = useState(0);
  const [animate, setAnimate] = useState(true);
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setAnimate(!reduce);
    if (reduce) { setShown(frac); return; }
    const t = requestAnimationFrame(() => setShown(frac));
    return () => cancelAnimationFrame(t);
  }, [frac]);

  const R = 52, C = 2 * Math.PI * R;
  const colour = done ? '#16A34A' : onTrack ? 'var(--accent, #4474B9)' : '#FF6B35';
  const status = done ? 'Target reached' : onTrack ? 'On track' : 'Behind pace';

  return (
    <section data-testid="target-ring" data-pace={done ? 'done' : onTrack ? 'on-track' : 'behind'} aria-label={title}
      className="anim-rise flex flex-wrap items-center gap-4 rounded-card bg-surface shadow-1 px-4 py-3">
      <svg width="132" height="132" viewBox="0 0 132 132" role="img" aria-label={`${value} of ${target} ${label}, ${pct}%, ${status.toLowerCase()}`}>
        <circle cx="66" cy="66" r={R} fill="none" stroke="var(--surface2)" strokeWidth="12" />
        <circle cx="66" cy="66" r={R} fill="none" stroke={colour} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - shown)} transform="rotate(-90 66 66)"
          style={{ transition: animate ? 'stroke-dashoffset 900ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none' }} />
        <text x="66" y="62" textAnchor="middle" className="num" fontSize="26" fontWeight="600" fill="var(--text)">{value}</text>
        <text x="66" y="84" textAnchor="middle" fontSize="13" fill="var(--muted)">of {target}</text>
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-muted">{title}</p>
        <p className="num mt-1 text-xl font-semibold">{value} / {target} {label}</p>
        <span data-testid="target-status" className={'mt-2 inline-block rounded-md px-2 py-0.5 text-[12px] font-semibold ' + (onTrack ? 'bg-goodBg text-goodText' : 'bg-badBg text-badText')}>{status}</span>
        <p data-testid="target-need" className="mt-2 text-sm text-text2">
          {done ? 'Well done. Anything more is a bonus.' : `Need ${need} more, ~${perDay} per day (${left} day${left === 1 ? '' : 's'} left).`}
        </p>
      </div>
    </section>
  );
}
