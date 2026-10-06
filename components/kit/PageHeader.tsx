'use client';
import type { ReactNode } from 'react';
import { cx } from '../ui';

// Page header v2 (docs/design/system.md): one compact block, about 70px. Context + title + scope chip on one line,
// the purpose as one muted line (full text on hover), primary action on the right. Optional filters row beneath.
export function PageHeader({ title, description, actions, filters, group, scope }: { title: string; description?: string; actions?: ReactNode; filters?: ReactNode; /** section in the sidebar, shown before the title */ group?: string; /** e.g. "Admin · all records": small muted chip next to the title */ scope?: string }) {
  return (
    <header className="flex flex-col gap-3" data-testid="page-header">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {group && <span className="hidden shrink-0 text-[12px] font-medium text-muted sm:inline">{group}<span aria-hidden className="ml-2">/</span></span>}
            <h1 className="truncate text-[20px] font-semibold leading-7">{title}</h1>
            {scope && <span className="hidden shrink-0 rounded-full bg-surface2 px-2 py-0.5 text-[11px] font-medium text-muted sm:inline" data-testid="page-scope">{scope}</span>}
          </div>
          {description && <p className="truncate text-[13px] leading-5 text-text2" title={description}>{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
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
