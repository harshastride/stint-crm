'use client';
import type { ReactNode } from 'react';
import { cx } from '../ui';

// Page header (docs/design/system.md): title + one line, primary action top-right, filters row beneath.
export function PageHeader({ title, description, actions, filters }: { title: string; description?: string; actions?: ReactNode; filters?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-tight">{title}</h1>
          {description && <p className="mt-1 truncate text-[13.5px] text-text2">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}
    </header>
  );
}

/** KPI card: muted label, big number, optional hint/trend. No border; soft surface. */
export function KpiCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-card bg-surface p-card shadow-1">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="num mt-1 text-[26px] font-semibold leading-none">{value}</div>
      {hint && <div className={cx('mt-2 text-xs', tone === 'good' ? 'text-goodText' : tone === 'bad' ? 'text-badText' : 'text-text2')}>{hint}</div>}
    </div>
  );
}

/** Board column (sidebar section-label header + count). Cards inside use `.ui-card`. */
export function BoardColumn({ title, count, tone, children }: { title: string; count?: number; tone?: 'bad'; children: ReactNode }) {
  return (
    <section aria-label={title} className="ui-col flex w-[280px] shrink-0 flex-col gap-2">
      <div className="ui-col-head"><span className="flex-1 truncate">{title}</span>{count != null && <span className="ui-count" data-tone={tone}>{count}</span>}</div>
      {children}
    </section>
  );
}
