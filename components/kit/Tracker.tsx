'use client';
import { Check } from 'lucide-react';
import { cx } from '../ui';

// A parcel-style tracker: each step with a date or note, the current one highlighted.
export type TrackStep = { label: string; note?: string; done: boolean; bad?: boolean };
export function Tracker({ steps, label }: { steps: TrackStep[]; label: string }) {
  const now = steps.findIndex((s) => !s.done);
  return (
    <ol aria-label={label} className="flex flex-col">
      {steps.map((s, i) => {
        const state = s.bad ? 'bad' : s.done ? 'done' : i === now ? 'now' : 'later';
        return (
          <li key={s.label} className="relative flex gap-3 pb-4 last:pb-0" aria-current={state === 'now' ? 'step' : undefined}>
            {i < steps.length - 1 && <span aria-hidden className={cx('absolute left-[13px] top-7 h-[calc(100%-24px)] w-0.5', s.done ? 'bg-accent' : 'bg-line2')} />}
            <span className={cx('relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold',
              state === 'done' ? 'bg-accent text-white' : state === 'now' ? 'border-2 border-coral bg-surface text-[#C2410C] ring-4 ring-[#FFE4D6] dark:ring-[#3A2418]' : state === 'bad' ? 'bg-[#DC2626] text-white' : 'border-2 border-line2 bg-surface text-muted')}>
              {state === 'done' ? <Check size={14} strokeWidth={3} /> : state === 'bad' ? '!' : i + 1}
            </span>
            <span className="min-w-0 pt-0.5">
              <span className={cx('block text-[13.5px]', state === 'later' ? 'text-muted' : 'font-semibold text-text')}>{s.label}{state === 'now' && <span className="ml-2 rounded-full bg-[#FFE4D6] px-2 py-0.5 text-[11px] font-semibold text-[#9A3412] dark:bg-[#3A2418] dark:text-[#FFB18F]">Now</span>}</span>
              {s.note && <span className="block text-[12.5px] text-text2">{s.note}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
