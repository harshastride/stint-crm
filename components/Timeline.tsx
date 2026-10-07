'use client';
import { useMemo, useState } from 'react';
import { ArrowRightLeft, ChevronDown, FileText, IndianRupee, Mic, NotebookPen, PhoneCall, StickyNote, UserRoundCheck, Zap } from 'lucide-react';
import type { Row } from '@/lib/pages';
import { cx } from './ui';

// A person's history as a vertical timeline: grouped by day with sticky headers, an icon per kind,
// who did it, relative time, rows that open to show the full note, filter chips and "Load older".
type Kind = 'Call' | 'Note' | 'Stage' | 'Fee' | 'Mock' | 'Training' | 'Resume' | 'Recording' | 'Automation';
const STYLE: Record<Kind, { icon: React.ComponentType<{ size?: number }>; tone: string }> = {
  Call: { icon: PhoneCall, tone: 'bg-accentSoft text-accentText' },
  Note: { icon: StickyNote, tone: 'bg-surface2 text-text2' },
  Stage: { icon: ArrowRightLeft, tone: 'bg-[#FFF0E9] text-[#B4441B] dark:bg-[#3A2418] dark:text-[#FFB18F]' },
  Fee: { icon: IndianRupee, tone: 'bg-goodBg text-goodText' },
  Mock: { icon: UserRoundCheck, tone: 'bg-accentSoft text-accentText' },
  Training: { icon: NotebookPen, tone: 'bg-surface2 text-text2' },
  Resume: { icon: FileText, tone: 'bg-surface2 text-text2' },
  Recording: { icon: Mic, tone: 'bg-surface2 text-text2' },
  Automation: { icon: Zap, tone: 'bg-warnBg text-warnText' },
};
const kindOf = (t: Row): Kind => {
  if (/^\[Automation\]/.test(t.body || '')) return 'Automation';
  if (/^Recorded talk/.test(t.body || '')) return 'Recording';
  if (t.kind in STYLE) return t.kind as Kind;
  return 'Note';
};
const FILTERS: [string, Kind[] | null][] = [['All', null], ['Calls', ['Call']], ['Notes', ['Note', 'Training', 'Recording']], ['Stages', ['Stage']], ['Fees', ['Fee']], ['Mocks', ['Mock', 'Resume']], ['Automations', ['Automation']]];
const PAGE = 20;

const dayLabel = (d: Date) => {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const diff = Math.round((+t - +x) / 864e5);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const ago = (d: Date) => {
  const s = Math.round((Date.now() - +d) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24); if (days < 30) return `${days} d ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
const clean = (b: string) => b.replace(/^\[Automation\]\s*/, '').replace(/\b(Payment|Quote) (\d+)(?:\.\d+)?/, (_: string, w: string, n: string) => `${w} ₹${Number(n).toLocaleString('en-IN')}`);

export function Timeline({ items, pageSize = PAGE }: { items: Row[]; pageSize?: number }) {
  const [filter, setFilter] = useState(0);
  const [shown, setShown] = useState(pageSize);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const all = useMemo(() => items.map((t, idx) => ({ ...t, k: kindOf(t), idx }) as Row & { k: Kind; idx: number })
    .sort((a, b) => +new Date(b.at) - +new Date(a.at)), [items]);
  const matched = useMemo(() => all.filter((t) => !FILTERS[filter][1] || FILTERS[filter][1]!.includes(t.k)), [all, filter]);
  const rows = matched.slice(0, shown);
  const present = new Set(all.map((t) => t.k));
  const groups: { label: string; rows: typeof rows }[] = [];
  for (const r of rows) {
    const label = dayLabel(new Date(r.at));
    if (groups.at(-1)?.label === label) groups.at(-1)!.rows.push(r); else groups.push({ label, rows: [r] });
  }
  const toggle = (i: number) => setOpen((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });

  return (
    <div className="anim-fade flex flex-col gap-3" data-testid="timeline">
      <style>{`@keyframes tlRail{from{transform:scaleY(0)}to{transform:scaleY(1)}}.tl-rail{transform-origin:top;animation:tlRail .5s ease-out both}@media (prefers-reduced-motion: reduce){.tl-rail{animation:none}}`}</style>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
        {FILTERS.map(([label, ks], i) => (i === 0 || ks!.some((k) => present.has(k))) && (
          <button key={label} type="button" aria-pressed={filter === i} onClick={() => { setFilter(i); setShown(pageSize); }}
            className={cx('min-h-[36px] rounded-full border px-3 text-xs font-semibold', filter === i ? 'border-accent bg-accentSoft text-accentText' : 'border-line2 text-text2 hover:bg-surface2')}>
            {label}{i > 0 && <span className="ml-1 text-muted">{all.filter((t) => ks!.includes(t.k)).length}</span>}
          </button>
        ))}
      </div>
      {rows.length === 0 && <div className="text-[13px] text-muted">{items.length ? 'Nothing of this kind.' : 'Nothing recorded yet.'}</div>}
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label}>
          <h4 className="sticky top-0 z-[2] bg-surface pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{g.label}</h4>
          <ol className="relative">
            <span aria-hidden className="tl-rail absolute bottom-4 left-[15px] top-4 w-px bg-line2" />
            {g.rows.map((t) => {
              const d = new Date(t.at), { icon: Icon, tone } = STYLE[t.k];
              const who = t.by_name || (t.k === 'Automation' ? 'Automation' : 'System');
              const body = clean(t.body || ''), long = body.length > 90 || body.includes('\n');
              const isOpen = open.has(t.idx);
              return (
                <li key={t.idx} className="relative flex gap-3 pb-3" data-kind={t.k}>
                  <span className={cx('relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-surface', tone)} role="img" aria-label={t.k}><Icon size={14} /></span>
                  <div className="min-w-0 flex-1">
                    <button type="button" disabled={!long} aria-expanded={long ? isOpen : undefined} onClick={() => toggle(t.idx)}
                      className={cx('flex min-h-[44px] w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left', long && 'hover:bg-surface2')}>
                      <span className="min-w-0 flex-1">
                        <span className={cx('block whitespace-pre-wrap text-[13px] leading-snug', !isOpen && 'line-clamp-2')}>{body || t.k}</span>
                        <span className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted">
                          <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-surface2 text-[9px] font-bold text-text2">{initials(who)}</span>
                          <span>{who}</span><span aria-hidden>·</span>
                          <time dateTime={d.toISOString()} title={d.toLocaleString('en-IN')}>{ago(d)}</time>
                        </span>
                      </span>
                      {long && <ChevronDown size={16} aria-hidden className={cx('mt-0.5 shrink-0 text-muted transition-transform motion-reduce:transition-none', isOpen && 'rotate-180')} />}
                    </button>
                    {isOpen && <div className="anim-fade ml-1.5 mt-1 text-[11.5px] text-muted">{t.k} · {d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      {matched.length > shown && (
        <button type="button" onClick={() => setShown((s) => s + pageSize)} className="min-h-[44px] rounded-lg border border-line2 text-[13px] font-semibold text-text2 hover:bg-surface2">
          Load older ({matched.length - shown} more)
        </button>
      )}
    </div>
  );
}
