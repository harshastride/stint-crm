'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { PageHeader } from '../ListPage';
import { Button, ButtonGroup, IconButton, cx } from '../ui';
import { TableSkeleton } from '../Skeletons';

// Mon–Sun week of follow-ups, batch classes, mock interviews and counselling (view calendar_feed).
// Row security on the source tables decides what comes back; phones see one day at a time.
type Kind = 'followup' | 'class' | 'interview' | 'counsel';
type Item = { kind: Kind; id: string; title: string; detail: string | null; starts_at: string; ends_at: string | null; person_kind: 'lead' | 'candidate' | null; person_id: string | null; staff_id: string | null };
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
// An item without an end time (a follow-up) is treated as 30 minutes long for clash checks.
const endOf = (e: Item) => (e.ends_at ? new Date(e.ends_at).getTime() : new Date(e.starts_at).getTime() + 30 * 60000);
/** For each item, the other items of the same staff member that overlap it in time. */
export function findClashes(items: Item[]): Map<Item, Item[]> {
  const out = new Map<Item, Item[]>();
  const byStaff = new Map<string, Item[]>();
  items.forEach((e) => { if (e.staff_id) byStaff.set(e.staff_id, [...(byStaff.get(e.staff_id) || []), e]); });
  byStaff.forEach((list) => {
    const sorted = [...list].sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
    sorted.forEach((a, i) => {
      for (let j = i + 1; j < sorted.length && +new Date(sorted[j].starts_at) < endOf(a); j++) {
        const b = sorted[j];
        out.set(a, [...(out.get(a) || []), b]); out.set(b, [...(out.get(b) || []), a]);
      }
    });
  });
  return out;
}
// A sensible default time for a new follow-up on that day: the next full hour today (until 7 pm), otherwise 10 am.
const slotFor = (d: Date) => {
  const x = new Date(d); const now = new Date();
  if (same(d, now) && now.getHours() < 19) x.setHours(now.getHours() + 1, 0, 0, 0); else x.setHours(10, 0, 0, 0);
  return x;
};
const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

export function WeekCalendar() {
  const s = useSession();
  const router = useRouter();
  const [start, setStart] = useState(() => sow(new Date()));
  const [day, setDay] = useState(() => (new Date().getDay() + 6) % 7); // phone: which day of the week
  const [show, setShow] = useState<Record<Kind, boolean>>({ followup: true, class: true, interview: true, counsel: true });
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'week' | 'agenda'>('week');
  const [mine, setMine] = useState(false);
  useEffect(() => { if (isPhone()) setMode('agenda'); }, []);
  const canAdd = s.can('followups', 'w');
  const addAt = (d: Date) => router.push('/p/followups?new=x:&due_at=' + encodeURIComponent(slotFor(d).toISOString()));

  useEffect(() => {
    setItems(null); setError('');
    const to = new Date(start.getTime() + 7 * DAY);
    supabase().from('calendar_feed').select('*').gte('starts_at', start.toISOString()).lt('starts_at', to.toISOString()).order('starts_at').limit(2000)
      .then(({ data, error: e }) => { if (e) setError('Could not load the calendar. Please try again.'); setItems((data as Item[]) || []); });
  }, [start]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY)), [start]);
  const today = sod(new Date());
  const shown = (items || []).filter((e) => show[e.kind] && (!mine || e.staff_id === s.staff.id));
  const clashes = useMemo(() => findClashes(items || []), [items]);
  const staffName = (id: string | null) => (s.refs.staff || []).find((x) => x.id === id)?.label || 'the same person';
  const onDay = (d: Date) => shown.filter((e) => same(new Date(e.starts_at), d));
  const step = (n: number) => setStart(new Date(start.getTime() + n * 7 * DAY));
  const goToday = () => { setStart(sow(today)); setDay((today.getDay() + 6) % 7); };
  const present = new Set((items || []).map((e) => e.kind));
  const title = `${days[0].toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const card = (e: Item) => {
    const late = e.kind === 'followup' && new Date(e.starts_at).getTime() < Date.now();
    const clash = clashes.get(e);
    const clashText = clash ? `Overlaps for ${e.staff_id === s.staff.id ? 'you' : staffName(e.staff_id)}: ` + clash.map((o) => `${o.title} at ${hm(o.starts_at)}`).join('; ') : '';
    return (
      <button key={e.kind + e.id + e.starts_at} type="button" data-kind={e.kind} onClick={() => router.push(href(e))}
        title={e.title + (e.detail ? ' · ' + e.detail : '') + (clash ? ' — ' + clashText : '')} data-clash={clash ? 'yes' : undefined}
        className={cx('flex min-h-[44px] w-full flex-col items-start rounded-lg border-l-[3px] px-2 py-1.5 text-left transition-shadow hover:shadow-2', KIND[e.kind].chip, late && 'ring-1 ring-badText')}>
        <span className="num text-[11px] font-semibold opacity-80">{hm(e.starts_at)}{e.ends_at ? '–' + hm(e.ends_at) : ''}{late ? ' · overdue' : ''}</span>
        <span className="w-full truncate text-[12.5px] font-medium">{e.title}</span>
        {e.detail && <span className="w-full truncate text-[11px] opacity-75">{e.detail}</span>}
        {clash && <span className="mt-0.5 flex w-full items-center gap-1 text-[11px] font-semibold text-warnText"><AlertTriangle size={12} aria-hidden /><span className="truncate">Clash: {clash.length} other at this time</span><span className="sr-only">. {clashText}</span></span>}
      </button>
    );
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <PageHeader group="Home" title="Week calendar" purpose="Follow-ups, batch classes and mock interviews for the week. Tap an item to open it, or add a follow-up on a day." scope={s.staff.role + ' · what your role can see'} />
      <div className="flex flex-wrap items-center gap-2">
        <ButtonGroup label="Week">
          <IconButton aria-label="Previous week" icon={<ChevronLeft size={16} />} onClick={() => step(-1)} />
          <Button variant="quiet" onClick={goToday}>Today</Button>
          <IconButton aria-label="Next week" icon={<ChevronRight size={16} />} onClick={() => step(1)} />
        </ButtonGroup>
        <h2 className="text-[17px] font-semibold tracking-tight" aria-live="polite">{title}</h2>
        <div className="flex flex-wrap items-center gap-2 md:ml-auto">
          <ButtonGroup label="Layout">
            <Button variant="quiet" active={mode === 'week'} onClick={() => setMode('week')}>Week</Button>
            <Button variant="quiet" active={mode === 'agenda'} onClick={() => setMode('agenda')}>Agenda</Button>
          </ButtonGroup>
          <Button variant="outline" active={mine} onClick={() => setMine(!mine)}>Only mine</Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Show or hide">
        {(Object.keys(KIND) as Kind[]).filter((k) => present.has(k) || !show[k]).map((k) => (
          <button key={k} type="button" aria-pressed={show[k]} onClick={() => setShow({ ...show, [k]: !show[k] })}
            className={cx('flex min-h-[44px] items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-colors hover:bg-surface2', show[k] ? 'text-text' : 'text-muted line-through opacity-70')}>
            <span className={cx('h-2.5 w-2.5 rounded-full', KIND[k].dot)} />{KIND[k].label}
          </button>
        ))}
      </div>

      {/* phone: day picker */}
      {mode === 'week' && <div className="grid grid-cols-7 gap-1 md:hidden" role="tablist" aria-label="Day">
        {days.map((d, i) => (
          <button key={i} type="button" role="tab" aria-selected={day === i} onClick={() => setDay(i)}
            className={cx('flex min-h-[52px] flex-col items-center justify-center rounded-[10px] text-[11px] transition-colors', day === i ? 'bg-accentSoft font-semibold text-accentText' : 'text-text2 hover:bg-surface2')}>
            {d.toLocaleDateString('en-IN', { weekday: 'narrow' })}
            <span className={cx('num text-[14px] font-semibold', same(d, today) && 'text-coral')}>{d.getDate()}</span>
            {onDay(d).length > 0 && <span className="h-1 w-1 rounded-full bg-accent" />}
          </button>
        ))}
      </div>}

      {error && <p role="alert" className="rounded-lg bg-badBg px-3 py-2 text-[13px] text-badText">{error}</p>}
      {items === null ? <TableSkeleton rows={6} /> : mode === 'agenda' ? (
        <div className="flex flex-col gap-3" data-view="agenda">
          {days.map((d) => {
            const list = onDay(d);
            const past = sod(d) < today;
            if (!list.length && past) return null;
            return (
              <section key={d.toISOString()} aria-label={d.toDateString()} className={cx('ui-col flex flex-col gap-1.5', same(d, today) && 'ring-1 ring-inset ring-accent')}>
                <div className="flex min-h-[44px] items-center justify-between gap-2 px-1">
                  <h3 className="text-[14px] font-semibold">{same(d, today) ? 'Today · ' : ''}{d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
                    <span className="ml-2 text-[12px] font-normal text-muted">{list.length ? list.length + (list.length === 1 ? ' item' : ' items') : 'Nothing planned'}</span></h3>
                  {canAdd && !past && <Button variant="quiet" size="sm" leftIcon={<Plus size={15} />} onClick={() => addAt(d)} aria-label={'Add follow-up on ' + d.toDateString()}>Follow-up</Button>}
                </div>
                {list.map(card)}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-7">
          {days.map((d, i) => {
            const list = onDay(d);
            return (
              <section key={d.toISOString()} aria-label={d.toDateString()} data-day={i}
                className={cx('ui-col min-h-[160px] flex-col gap-1.5 md:flex', i === day ? 'flex' : 'hidden', same(d, today) && 'ring-1 ring-inset ring-accent')}>
                <div className="flex items-center justify-between px-1 pb-1">
                  <span className="text-[12px] font-medium text-muted">{d.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
                  <span className={cx('num flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[13px] font-semibold', same(d, today) && 'bg-accent text-white')}>{d.getDate()}</span>
                </div>
                {list.length === 0 && <span className="px-1 text-[12px] text-muted">Nothing planned</span>}
                {list.map(card)}
                {canAdd && sod(d) >= today && (
                  <button type="button" onClick={() => addAt(d)} aria-label={'Add follow-up on ' + d.toDateString()}
                    className="mt-auto flex min-h-[44px] w-full items-center justify-center gap-1 rounded-lg border border-dashed border-line2 text-[12px] font-medium text-muted transition-colors hover:border-accent hover:text-accentText">
                    <Plus size={14} aria-hidden />Follow-up
                  </button>
                )}
              </section>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted">{shown.length} items this week{mine ? ' (only yours)' : ''}{clashes.size ? ` · ${[...clashes.keys()].filter((e) => shown.includes(e)).length} overlap with another item for the same person` : ''}. Overdue follow-ups have a red outline.</p>
    </main>
  );
}
