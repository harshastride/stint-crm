'use client';
import { Check } from 'lucide-react';
import { cx } from '../ui';

// Numbered steps with ticks for finished ones: Details → Documents → Sign → Fees.
export type Step = { label: string; done: boolean; onClick?: () => void };
export function Stepper({ steps, label = 'Your steps' }: { steps: Step[]; label?: string }) {
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol className="flex w-full items-start" aria-label={label}>
      {steps.map((s, i) => {
        const state = s.done ? 'done' : i === current ? 'now' : 'later';
        return (
          <li key={s.label} className="relative flex flex-1 flex-col items-center text-center" aria-current={state === 'now' ? 'step' : undefined}>
            {i > 0 && <span aria-hidden className={cx('absolute right-1/2 top-[17px] h-0.5 w-full', steps[i - 1].done ? 'bg-accent' : 'bg-line2')} />}
            <button type="button" disabled={!s.onClick} onClick={s.onClick}
              className={cx('relative z-10 flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-semibold',
                state === 'done' ? 'bg-accent text-white' : state === 'now' ? 'border-2 border-accent bg-surface text-accentText ring-4 ring-accentSoft' : 'border-2 border-line2 bg-surface text-muted')}>
              {state === 'done' ? <Check size={16} strokeWidth={3} /> : i + 1}
            </button>
            <span className={cx('mt-1.5 px-1 text-[12px] leading-tight', state === 'later' ? 'text-muted' : 'font-medium text-text')}>{s.label}</span>
            <span className="sr-only">{state === 'done' ? 'done' : state === 'now' ? 'to do next' : 'later'}</span>
          </li>
        );
      })}
    </ol>
  );
}
