'use client';
import { useId, useState } from 'react';

// Small 30-day trend line for a number card. Pure SVG, no chart library.
// Hover or tap (or arrow keys when focused) shows the value for that day.
export type SparkPoint = { day: string; value: number };

export function Sparkline({ points, format = (n) => n.toLocaleString('en-IN'), label, height = 36, color = 'var(--accent, #4474B9)' }: {
  points: SparkPoint[]; format?: (n: number) => string; label: string; height?: number; color?: string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return null;
  const W = 200, H = height, pad = 3;
  const max = Math.max(1, ...points.map((p) => p.value)), min = Math.min(0, ...points.map((p) => p.value));
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  const total = points.reduce((a, p) => a + p.value, 0);
  const pick = (clientX: number, el: Element) => { const r = el.getBoundingClientRect(); setHover(Math.max(0, Math.min(points.length - 1, Math.round(((clientX - r.left) / r.width) * (points.length - 1))))); };
  const h = hover != null ? points[hover] : null;
  const dayLabel = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return (
    <div className="relative" data-testid="sparkline">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} role="img" tabIndex={0}
        aria-label={`${label}: last ${points.length} days, ${format(total)} in all`}
        className="block cursor-crosshair touch-none outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)} onPointerDown={(e) => pick(e.clientX, e.currentTarget)} onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setHover((v) => Math.max(0, (v ?? points.length) - 1));
          else if (e.key === 'ArrowRight') setHover((v) => Math.min(points.length - 1, (v ?? -1) + 1));
          else if (e.key === 'Escape') setHover(null);
        }}>
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${id})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="1.75" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} stroke="currentColor" strokeOpacity="0.25" vectorEffect="non-scaling-stroke" />}
        {hover != null && <circle cx={x(hover)} cy={y(points[hover].value)} r="3" fill={color} vectorEffect="non-scaling-stroke" />}
      </svg>
      {h && (
        <div role="status" data-testid="sparkline-tip"
          className="num pointer-events-none absolute -top-8 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11.5px] font-medium text-white shadow"
          style={{ left: `${Math.min(85, Math.max(15, (hover! / (points.length - 1)) * 100))}%` }}>
          {dayLabel(h.day)} · {format(h.value)}
        </div>
      )}
    </div>
  );
}

/** % change of the last `n` days against the `n` days before, or null when there is nothing to compare with. */
export function periodChange(points: SparkPoint[], n = 30): number | null {
  const now = points.slice(-n).reduce((a, p) => a + p.value, 0);
  const before = points.slice(-2 * n, -n).reduce((a, p) => a + p.value, 0);
  if (!before) return null;
  return Math.round(((now - before) / before) * 100);
}
