'use client';
import { ChevronRight } from 'lucide-react';
import { useId } from 'react';
import { cx } from '../ui';

/** Small meter shown on a closed card's line, e.g. fees paid. Decorative: the text next to it says the same. */
export function MiniMeter({ value, max, tone = 'accent' }: { value: number; max: number; tone?: 'accent' | 'good' | 'bad' }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((100 * value) / max))) : 0;
  return (
    <span aria-hidden className="h-[5px] w-11 shrink-0 overflow-hidden rounded-full bg-surface2 ring-1 ring-inset ring-line">
      <span className={cx('block h-full rounded-full', tone === 'bad' ? 'bg-[#DC2626]' : tone === 'good' || pct === 100 ? 'bg-[#16A34A]' : 'bg-accent')} style={{ width: pct + '%' }} />
    </span>
  );
}

/** Coloured status chip used in card lines and rows. */
export function Chip({ tone = 'info', children }: { tone?: 'good' | 'warn' | 'bad' | 'info' | 'plain'; children: React.ReactNode }) {
  const c = { good: 'bg-goodBg text-goodText', warn: 'bg-warnBg text-warnText', bad: 'bg-badBg text-badText', info: 'bg-accentSoft text-accentText', plain: 'bg-surface2 text-text2' }[tone];
  return <span className={cx('inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold', c)}>{children}</span>;
}

/**
 * One topic in the person panel: a single line (label + chevron on the left, a short answer on the right) that opens
 * in place to show detail. Like the cards in the Claude app's side rail.
 */
export function RailCard({ id, label, summary, open, onToggle, children, testId }: {
  id: string; label: string; summary?: React.ReactNode; open: boolean; onToggle: (id: string) => void; children: React.ReactNode; testId?: string;
}) {
  const bodyId = useId();
  return (
    <section data-card={id} data-testid={testId} data-open={open} className={cx('rounded-xl border bg-surface transition-[box-shadow,border-color] duration-150', open ? 'border-line shadow-[var(--shadow-2)]' : 'border-line hover:border-line2')}>
      <h3 className="m-0">
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => onToggle(id)}
          className="btn flex min-h-[48px] w-full items-center gap-2.5 rounded-xl px-3.5 text-left">
          <span className="inline-flex shrink-0 items-center gap-1 text-[13.5px] font-semibold">
            {label}
            <ChevronRight size={14} strokeWidth={2.2} aria-hidden className={cx('text-muted transition-transform duration-200 ease-out motion-reduce:transition-none', open && 'rotate-90')} />
          </span>
          {summary != null && <span className="ml-auto flex min-w-0 items-center justify-end gap-2 text-[12.5px] text-text2 [&>span.t]:truncate">{summary}</span>}
        </button>
      </h3>
      <div id={bodyId} role="region" aria-label={label} hidden={!open} className="anim-fade px-3.5 pb-3.5 pt-0.5 text-[13px]">
        {open && children}
      </div>
    </section>
  );
}

/** Label/value row inside a card body (instalments, documents, mocks). */
export function CardRow({ title, sub, right }: { title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex min-h-[40px] items-center justify-between gap-2.5 border-b border-line py-1.5 last:border-b-0">
      <div className="min-w-0"><div className="truncate">{title}</div>{sub && <div className="truncate text-[11.5px] text-muted">{sub}</div>}</div>
      {right}
    </div>
  );
}
