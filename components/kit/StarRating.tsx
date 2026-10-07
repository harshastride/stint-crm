'use client';
import { useRef } from 'react';
import { Star } from 'lucide-react';
import { cx } from '../ui';

export const STAR_LABELS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'] as const;

/** 1–5 star input. A real radio group: Tab focuses it, arrow keys move, 44px targets, the chosen word shows beside it. */
export function StarRating({ value, onChange, label, disabled }: { value: number; onChange: (n: number) => void; label: string; disabled?: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const pick = (n: number) => { const v = Math.min(5, Math.max(1, n)); onChange(v); refs.current[v - 1]?.focus(); };
  const onKey = (e: React.KeyboardEvent) => {
    const cur = value || refs.current.indexOf(document.activeElement as HTMLButtonElement) + 1; // like native radios: move from the focused star
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); pick(cur + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); pick(cur - 1); }
    else if (e.key === 'Home') { e.preventDefault(); pick(1); }
    else if (e.key === 'End') { e.preventDefault(); pick(5); }
  };
  return (
    <div className="flex flex-wrap items-center gap-x-2">
      <div role="radiogroup" aria-label={label} className="flex" onKeyDown={onKey}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} ref={(el) => { refs.current[n - 1] = el; }} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}, ${STAR_LABELS[n - 1]}`}
            tabIndex={value ? (value === n ? 0 : -1) : n === 1 ? 0 : -1} disabled={disabled} onClick={() => onChange(n)}
            className="group flex h-11 w-11 items-center justify-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60">
            <Star size={28} strokeWidth={1.75} className={cx('transition-transform duration-100 group-active:scale-90 motion-reduce:transition-none', n <= value ? 'fill-[#F59E0B] text-[#F59E0B]' : 'text-line2')} />
          </button>
        ))}
      </div>
      <span className="min-w-[72px] text-[13.5px] font-medium text-text2" aria-live="polite">{value ? STAR_LABELS[value - 1] : 'Tap a star'}</span>
    </div>
  );
}
