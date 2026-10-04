'use client';
import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { cx } from '@/components/ui';

export type QA = { q: string; a: string };
export type Topic = { title: string; roles?: string; items: QA[] };

function Question({ q, a, open, onToggle }: QA & { open: boolean; onToggle: () => void }) {
  return (
    <li className="border-b border-line last:border-0">
      <h3>
        <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-[48px] w-full items-center gap-3 px-4 text-left text-[14px] font-medium">
          <span className="flex-1">{q}</span>
          <ChevronDown size={17} className={cx('shrink-0 text-muted transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
      </h3>
      {open && <p className="anim-fade px-4 pb-3 text-[13.5px] text-text2">{a}</p>}
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
      <label className="mt-4 flex min-h-[44px] items-center gap-2 rounded-[12px] border border-line2 bg-surface px-3">
        <Search size={16} className="text-muted" aria-hidden />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search help, e.g. payment" aria-label="Search help" className="h-11 flex-1 bg-transparent text-[14px] outline-none" />
      </label>
      <div className="mt-4 space-y-4">
        {shown.map((t) => (
          <section key={t.title} className="rounded-2xl border border-line bg-surface">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
              <h2 className="flex-1 font-semibold">{t.title}</h2>
              {t.roles && <span className="rounded-md bg-accentSoft px-1.5 py-0.5 text-[11px] font-semibold text-accentText">For: {t.roles}</span>}
            </div>
            <ul>{t.items.map((i) => <Question key={i.q} {...i} open={open.includes(i.q)} onToggle={() => toggle(i.q)} />)}</ul>
          </section>
        ))}
        {!shown.length && <p className="rounded-2xl border border-line bg-surface p-4 text-[14px] text-muted">No answers match &ldquo;{query}&rdquo;. Try another word.</p>}
      </div>
      {footer && <p className="mt-6 text-center text-[14px] font-medium">{footer}</p>}
    </>
  );
}
