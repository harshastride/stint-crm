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
        <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-[44px] w-full items-center gap-3 rounded-lg px-2 text-left text-[13.5px] font-medium transition-colors duration-150 hover:bg-surface2">
          <span className="flex-1">{q}</span>
          <ChevronDown size={17} className={cx('shrink-0 text-muted transition-transform duration-200', open && 'rotate-180')} aria-hidden />
        </button>
      </h3>
      {open && <p className="anim-fade px-2 pb-3 text-[13.5px] leading-relaxed text-text2">{a}</p>}
    </li>
  );
}

/** Search box + topic list (left, like the sidebar) + tap-to-open answers (right). Stacked on phones. */
export function HelpList({ topics, footer }: { topics: Topic[]; footer?: ReactNode }) {
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState<string>('');
  const [open, setOpen] = useState<string[]>([]);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matched = useMemo(() => topics.map((t) => ({ ...t, items: t.items.filter((i) => {
    const hay = (t.title + ' ' + i.q + ' ' + i.a).toLowerCase();
    return words.every((w) => hay.includes(w));
  }) })).filter((t) => t.items.length), [query, topics]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = topic && !words.length ? matched.filter((t) => t.title === topic) : matched;
  const toggle = (q: string) => setOpen((o) => o.includes(q) ? o.filter((x) => x !== q) : [...o, q]);
  const navBtn = (on: boolean) => cx('flex min-h-[44px] shrink-0 items-center gap-2 rounded-lg px-2.5 text-left text-[13.5px] transition-colors duration-150', on ? 'bg-accentSoft font-semibold text-accentText' : 'font-medium text-text2 hover:bg-surface2');

  return (
    <div className="mt-3 grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-0">
      <div className="flex min-w-0 flex-col gap-2 lg:border-r lg:border-line lg:pr-3">
        <label className="flex min-h-[44px] items-center gap-2 rounded-[10px] border border-line2 bg-surface px-3 focus-within:border-accent">
          <Search size={16} className="text-muted" aria-hidden />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search help, e.g. payment" aria-label="Search help" className="h-11 min-w-0 flex-1 border-0 bg-transparent text-[14px] outline-none" />
        </label>
        <nav aria-label="Help topics" className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0.5 lg:overflow-visible">
          <button type="button" aria-pressed={!topic} onClick={() => setTopic('')} className={navBtn(!topic || !!words.length)}><span className="flex-1">All topics</span></button>
          {topics.map((t) => (
            <button key={t.title} type="button" aria-pressed={topic === t.title} onClick={() => { setTopic(t.title); setQuery(''); }} className={navBtn(topic === t.title && !words.length)}>
              <span className="flex-1 truncate">{t.title}</span><span className="text-[12px] font-normal text-muted">{t.items.length}</span>
            </button>
          ))}
        </nav>
      </div>
      <div className="min-w-0 space-y-4 lg:pl-5">
        {shown.map((t) => (
          <section key={t.title}>
            <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 px-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t.title}</h2>
              {t.roles && <span className="text-[12px] text-muted">For: {t.roles}</span>}
            </div>
            <ul className="border-t border-line">{t.items.map((i) => <Question key={i.q} {...i} open={open.includes(i.q)} onToggle={() => toggle(i.q)} />)}</ul>
          </section>
        ))}
        {!shown.length && <p className="px-2 py-3 text-[14px] text-muted">No answers match &ldquo;{query}&rdquo;. Try another word.</p>}
        {footer && <p className="px-2 pt-2 text-[13.5px] text-muted">{footer}</p>}
      </div>
    </div>
  );
}
