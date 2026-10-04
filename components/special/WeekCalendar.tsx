'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { PageHeader } from '../ListPage';
import { cx } from '../ui';
import { TableSkeleton } from '../Skeletons';

// Mon–Sun week of follow-ups, batch classes, mock interviews and counselling (view calendar_feed).
// Row security on the source tables decides what comes back; phones see one day at a time.
type Kind = 'followup' | 'class' | 'interview' | 'counsel';
type Item = { kind: Kind; id: string; title: string; detail: string | null; starts_at: string; ends_at: string | null; person_kind: 'lead' | 'candidate' | null; person_id: string | null };
const KIND: Record<Kind, { label: string; dot: string; chip: string }> = {
  followup: { label: 'Follow-up', dot: 'bg-accent', chip: 'bg-accentSoft text-accentText border-accent' },
  class: { label: 'Batch class', dot: 'bg-goodText', chip: 'bg-goodBg text-goodText border-goodText' },
  interview: { label: 'Mock interview', dot: 'bg-coral', chip: 'bg-[#FFF0E9] text-[#B4441B] border-coral dark:bg-[#3A2418] dark:text-[#FFB18F]' },
  counsel: { label: 'Counselling', dot: 'bg-muted', chip: 'bg-surface2 text-text2 border-line2' },
};
const DAY = 864e5;
const sod = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const sow = (d: Date) => { const x = sod(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const same = (a: Date, b: Date) => sod(a).getTime() === sod(b).getTime();
const hm = (s: string) => new Date(s).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const href = (e: Item) => {
  if (e.person_kind && e.person_id) return `/p/${e.person_kind}?person=${e.person_kind}:${e.person_id}`;
  if (e.kind === 'class') return `/p/batch?edit=batch:${e.id}`;
  return `/p/followups?edit=x:${e.id}`;
};

export function WeekCalendar() {
  const s = useSession();
  const router = useRouter();
  const [start, setStart] = useState(() => sow(new Date()));
  const [day, setDay] = useState(() => (new Date().getDay() + 6) % 7); // phone: which day of the week
  const [show, setShow] = useState<Record<Kind, boolean>>({ followup: true, class: true, interview: true, counsel: true });
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setItems(null); setError('');
    const to = new Date(start.getTime() + 7 * DAY);
    supabase().from('calendar_feed').select('*').gte('starts_at', start.toISOString()).lt('starts_at', to.toISOString()).order('starts_at').limit(2000)
      .then(({ data, error: e }) => { if (e) setError('Could not load the calendar. Please try again.'); setItems((data as Item[]) || []); });
  }, [start]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY)), [start]);
  const today = sod(new Date());
  const shown = (items || []).filter((e) => show[e.kind]);
  const onDay = (d: Date) => shown.filter((e) => same(new Date(e.starts_at), d));
  const step = (n: number) => setStart(new Date(start.getTime() + n * 7 * DAY));
  const goToday = () => { setStart(sow(today)); setDay((today.getDay() + 6) % 7); };
  const present = new Set((items || []).map((e) => e.kind));
  const title = `${days[0].toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const card = (e: Item) => {
    const late = e.kind === 'followup' && new Date(e.starts_at).getTime() < Date.now();
    return (
      <button key={e.kind + e.id + e.starts_at} type="button" data-kind={e.kind} onClick={() => router.push(href(e))}
        title={e.title + (e.detail ? ' · ' + e.detail : '')}
        className={cx('flex min-h-[44px] w-full flex-col items-start rounded-lg border-l-4 px-2 py-1.5 text-left', KIND[e.kind].chip, late && 'ring-1 ring-badText')}>
        <span className="num text-[11px] font-semibold opacity-80">{hm(e.starts_at)}{e.ends_at ? '–' + hm(e.ends_at) : ''}{late ? ' · overdue' : ''}</span>
        <span className="w-full truncate text-[12.5px] font-medium">{e.title}</span>
        {e.detail && <span className="w-full truncate text-[11px] opacity-75">{e.detail}</span>}
      </button>
    );
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <PageHeader group="Home" title="Week calendar" purpose="Follow-ups, batch classes and mock interviews for the week. Tap an item to open it." scope={s.staff.role + ' · what your role can see'} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous week" onClick={() => step(-1)} className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-line2 bg-surface"><ChevronLeft size={17} /></button>
          <button type="button" onClick={goToday} className="h-11 rounded-[10px] border border-line2 bg-surface px-4 text-[13px] font-medium">Today</button>
          <button type="button" aria-label="Next week" onClick={() => step(1)} className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-line2 bg-surface"><ChevronRight size={17} /></button>
        </div>
        <h2 className="text-lg font-semibold" aria-live="polite">{title}</h2>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Show or hide">
        {(Object.keys(KIND) as Kind[]).filter((k) => present.has(k) || !show[k]).map((k) => (
          <button key={k} type="button" aria-pressed={show[k]} onClick={() => setShow({ ...show, [k]: !show[k] })}
            className={cx('flex min-h-[44px] items-center gap-2 rounded-full border px-3 text-xs font-semibold', show[k] ? 'border-line2 bg-surface text-text' : 'border-line text-muted line-through')}>
            <span className={cx('h-2.5 w-2.5 rounded-full', KIND[k].dot)} />{KIND[k].label}
          </button>
        ))}
      </div>

      {/* phone: day picker */}
      <div className="grid grid-cols-7 gap-1 md:hidden" role="tablist" aria-label="Day">
        {days.map((d, i) => (
          <button key={i} type="button" role="tab" aria-selected={day === i} onClick={() => setDay(i)}
            className={cx('flex min-h-[52px] flex-col items-center justify-center rounded-[10px] border text-[11px]', day === i ? 'border-accent bg-accentSoft font-semibold text-accentText' : 'border-line bg-surface text-text2')}>
            {d.toLocaleDateString('en-IN', { weekday: 'narrow' })}
            <span className={cx('num text-[14px] font-semibold', same(d, today) && 'text-coral')}>{d.getDate()}</span>
            {onDay(d).length > 0 && <span className="h-1 w-1 rounded-full bg-accent" />}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="rounded-lg bg-badBg px-3 py-2 text-[13px] text-badText">{error}</p>}
      {items === null ? <TableSkeleton rows={6} /> : (
        <div className="grid gap-2 md:grid-cols-7">
          {days.map((d, i) => {
            const list = onDay(d);
            return (
              <section key={d.toISOString()} aria-label={d.toDateString()} data-day={i}
                className={cx('min-h-[160px] flex-col gap-1.5 rounded-xl border bg-surface p-2 md:flex', i === day ? 'flex' : 'hidden', same(d, today) ? 'border-accent' : 'border-line')}>
                <div className="flex items-baseline justify-between px-1">
                  <span className="text-[11px] font-semibold uppercase text-text2">{d.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
                  <span className={cx('num text-[15px] font-semibold', same(d, today) && 'text-accentText')}>{d.getDate()}</span>
                </div>
                {list.length === 0 ? <span className="px-1 text-[12px] text-muted">Nothing planned</span> : list.map(card)}
              </section>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted">{shown.length} items this week. Overdue follow-ups have a red outline.</p>
    </main>
  );
}
