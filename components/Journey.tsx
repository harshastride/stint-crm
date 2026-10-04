'use client';
import { Check } from 'lucide-react';
import type { Step } from '@/lib/journey';
import { cx } from './ui';

const date = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** Step-by-step journey: done steps ticked with the date and who moved them, the current one highlighted, next ones greyed.
 *  Horizontal from 768px, vertical on phones. `student` uses friendlier wording for the portal. */
export function Journey({ steps, student = false }: { steps: Step[]; student?: boolean }) {
  return (
    <ol className="grid gap-0 md:grid-cols-9 md:gap-1" aria-label="Journey">
      {steps.map((s, i) => (
        <li key={s.name} aria-current={s.state === 'current' ? 'step' : undefined} className="relative flex gap-3 pb-4 md:flex-col md:gap-2 md:pb-0">
          {/* connector: vertical on phones, horizontal on wider screens */}
          {i < steps.length - 1 && <span aria-hidden className={cx('absolute left-[13px] top-7 h-[calc(100%-20px)] w-0.5 md:left-7 md:top-[13px] md:h-0.5 md:w-[calc(100%-20px)]', s.state === 'done' ? 'bg-accent' : 'bg-line2')} />}
          <span className={cx('relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold',
            s.state === 'done' ? 'border-accent bg-accent text-white' : s.state === 'current' ? 'border-coral bg-surface text-coral ring-4 ring-coral/15' : 'border-line2 bg-surface text-muted')}>
            {s.state === 'done' ? <Check size={14} strokeWidth={3} /> : i + 1}
          </span>
          <span className="min-w-0 md:pr-1">
            <span className={cx('block text-[13px] font-semibold leading-tight', s.state === 'next' && 'text-muted')}>{s.name}</span>
            <span className="block text-[11.5px] leading-snug text-muted">
              {s.state === 'next' ? (student ? 'Coming up' : s.owner)
                : s.reachedAt ? date(s.reachedAt) + (s.state === 'current' ? (student ? ' · now' : ` · ${s.days ?? 0} day${s.days === 1 ? '' : 's'} so far`) : s.days !== null ? ` · ${s.days}d` : '')
                : s.state === 'current' ? 'Now' : 'Done'}
            </span>
            {!student && s.by && s.state !== 'next' && <span className="block truncate text-[11px] text-muted">by {s.by}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
