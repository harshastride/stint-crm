'use client';
import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { cx } from '@/components/ui';

export type QA = { q: string; a: string };
export type Topic = { title: string; roles?: string; items: QA[] };

function Question({ q, a, open, onToggle }: QA & { open: boolean; onToggle: () => void }) {
  return (
    <li className="mx-2 border-b border-line last:border-0">
      <h3>
        <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-[48px] w-full items-center gap-3 rounded-lg px-2 text-left text-[13.5px] font-medium transition-colors duration-150 hover:bg-surface2">
          <span className="flex-1">{q}</span>
          <ChevronDown size={17} className={cx('shrink-0 text-muted transition-transform duration-200', open && 'rotate-180')} aria-hidden />
        </button>
      </h3>
      {open && <p className="anim-fade px-2 pb-3 text-[13.5px] leading-relaxed text-text2">{a}</p>}
    </li>
  );
}

/** Search box + topic cards with tap-to-open questions. */
export function HelpList({ topics, footer }: { topics: Topic[]; footer?: ReactNode }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string[]>([]);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(() => topics.map((t) => ({ ...t, items: t.items.filter((i) => {
    const hay = (t.title + ' ' + i.q + ' ' + i.a).toLowerCase();
    return words.every((w) => hay.includes(w));
  }) })).filter((t) => t.items.length), [query, topics]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (q: string) => setOpen((o) => o.includes(q) ? o.filter((x) => x !== q) : [...o, q]);

  return (
    <>
      <label className="mt-6 flex min-h-[44px] items-center gap-2 rounded-[10px] border border-line2 bg-surface px-3 focus-within:border-accent">
        <Search size={16} className="text-muted" aria-hidden />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search help, e.g. payment" aria-label="Search help" className="h-11 min-w-0 flex-1 border-0 bg-transparent text-[14px] outline-none" />
      </label>
      <div className="mt-6 space-y-6">
        {shown.map((t) => (
          <section key={t.title}>
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
              <h2 className="text-[15px] font-semibold">{t.title}</h2>
              {t.roles && <span className="text-[12px] text-muted">For: {t.roles}</span>}
            </div>
            <ul className="rounded-card bg-surface py-1 shadow-1">{t.items.map((i) => <Question key={i.q} {...i} open={open.includes(i.q)} onToggle={() => toggle(i.q)} />)}</ul>
          </section>
        ))}
        {!shown.length && <p className="rounded-card bg-surface p-card text-[14px] text-muted shadow-1">No answers match &ldquo;{query}&rdquo;. Try another word.</p>}
      </div>
      {footer && <p className="mt-8 text-center text-[13.5px] text-muted">{footer}</p>}
    </>
  );
}
