'use client';
import { useMemo, useState } from 'react';
import { ArrowRightLeft, CalendarCheck, FileText, IndianRupee, Mic, NotebookPen, PhoneCall, StickyNote, UserRoundCheck, Zap } from 'lucide-react';
import type { Row } from '@/lib/pages';
import { cx } from './ui';

// A person's history as a vertical timeline: an icon per kind, grouped by day, with filter chips.
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
  if (t.kind === 'Placement' || t.kind === 'Message') return 'Note';
  return 'Note';
};
const FILTERS: [string, Kind[] | null][] = [['All', null], ['Calls', ['Call']], ['Notes', ['Note', 'Training', 'Recording']], ['Stages', ['Stage']], ['Fees', ['Fee']], ['Automations', ['Automation']]];
const dayLabel = (d: Date) => {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const diff = Math.round((+t - +x) / 864e5);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : x.toLocaleDateString('en-IN', { weekday: diff > 1 && diff < 7 ? 'long' : undefined, day: 'numeric', month: 'short', year: x.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
};

export function Timeline({ items }: { items: Row[] }) {
  const [filter, setFilter] = useState(0);
  const rows = useMemo(() => items.map((t) => ({ ...t, k: kindOf(t) }) as Row & { k: Kind }).filter((t) => !FILTERS[filter][1] || FILTERS[filter][1]!.includes(t.k)), [items, filter]);
  const present = new Set(items.map(kindOf));
  let last = '';
  return (
    <div className="anim-fade flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
        {FILTERS.filter(([, ks], i) => i === 0 || ks!.some((k) => present.has(k))).map(([label]) => {
          const i = FILTERS.findIndex(([l]) => l === label);
          return <button key={label} type="button" aria-pressed={filter === i} onClick={() => setFilter(i)} className={cx('min-h-[32px] rounded-full border px-3 text-xs font-semibold', filter === i ? 'border-accent bg-accentSoft text-accentText' : 'border-line2 text-text2')}>{label}</button>;
        })}
      </div>
      {rows.length === 0 && <div className="text-[13px] text-muted">{items.length ? 'Nothing of this kind.' : 'Nothing recorded yet.'}</div>}
      <ol className="relative">
        {rows.map((t, i) => {
          const d = new Date(t.at), label = dayLabel(d), head = label !== last ? (last = label) : null;
          const { icon: Icon, tone } = STYLE[t.k];
          return (
            <li key={i}>
              {head && <div className="sticky top-0 z-[1] bg-surface pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{head}</div>}
              <div className="relative flex gap-3 pb-3">
                {i < rows.length - 1 && <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-26px)] w-px bg-line2" />}
                <span className={cx('relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full', tone)} aria-label={t.k}><Icon size={14} /></span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="text-[13px] leading-snug">{(t.body || '').replace(/^\[Automation\]\s*/, '').replace(/\b(Payment|Quote) (\d+)(?:\.\d+)?/, (_: string, w: string, n: string) => `${w} ₹${Number(n).toLocaleString('en-IN')}`)}</div>
                  <div className="mt-0.5 text-[11.5px] text-muted">{d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} · {t.by_name || (t.k === 'Automation' ? 'Automation' : 'System')}</div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
