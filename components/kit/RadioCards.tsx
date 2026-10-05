'use client';
import { Check } from 'lucide-react';
import { cx } from '../ui';

// A short list of choices as big tappable cards (instead of a small dropdown).
export function RadioCards({ label, options, value, onChange, disabled }: { label: string; options: string[]; value: string | null; onChange: (v: string | null) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${options.length > 3 ? 120 : 100}px, 1fr))` }}>
      {options.map((o) => {
        const on = value === o;
        return (
          <button key={o} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onChange(on ? null : o)}
            className={cx('relative flex min-h-[44px] items-center justify-center rounded-[10px] border px-3 py-2 text-center text-[13.5px] transition-colors duration-150 active:scale-[.97] disabled:opacity-60',
              on ? 'border-transparent bg-accentSoft font-semibold text-accentText' : 'border-line2 bg-surface font-medium text-text2 hover:bg-surface2 hover:text-text')}>
            {on && <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white"><Check size={10} strokeWidth={3} /></span>}
            {o}
          </button>
        );
      })}
    </div>
  );
}
