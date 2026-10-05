'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { PageHeader } from '../ListPage';
import { Button, ButtonGroup, IconButton, cx } from '../ui';
import { TableSkeleton } from '../Skeletons';

// Month and week calendar of counselling sessions, mock interviews, follow-ups and batch starts.
// Each source is read only if the role can open its page; row security decides which rows come back.
type Ev = { id: string; at: Date; allDay: boolean; kind: Kind; title: string; who: string; href: string; late?: boolean };
type Kind = 'counsel' | 'mock' | 'followup' | 'batch';
const KIND: Record<Kind, { label: string; dot: string; chip: string }> = {
  counsel: { label: 'Counselling', dot: 'bg-accent', chip: 'bg-accentSoft text-accentText' },
  mock: { label: 'Mock interview', dot: 'bg-coral', chip: 'bg-[#FFF0E9] text-[#B4441B] dark:bg-[#3A2418] dark:text-[#FFB18F]' },
  followup: { label: 'Follow-up', dot: 'bg-muted', chip: 'bg-surface2 text-text2' },
  batch: { label: 'Batch starts', dot: 'bg-goodText', chip: 'bg-goodBg text-goodText' },
};
const DAY = 864e5;
const sod = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const sow = (d: Date) => { const x = sod(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const sameDay = (a: Date, b: Date) => sod(a).getTime() === sod(b).getTime();
const time = (d: Date) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

export function Calendar() {
  const s = useSession();
  const router = useRouter();
  const [mode, setMode] = useState<'month' | 'week'>(() => (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches ? 'week' : 'month'));
  const [anchor, setAnchor] = useState(() => sod(new Date()));
  const [picked, setPicked] = useState<Date>(() => sod(new Date()));
  const [show, setShow] = useState<Record<Kind, boolean>>({ counsel: true, mock: true, followup: true, batch: true });
  const [events, setEvents] = useState<Ev[] | null>(null);

  const range = useMemo(() => {
    if (mode === 'week') { const a = sow(anchor); return [a, new Date(a.getTime() + 7 * DAY)] as const; }
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const a = sow(first); return [a, new Date(a.getTime() + 42 * DAY)] as const;
  }, [mode, anchor]);

  useEffect(() => {
    const db = supabase();
    const [from, to] = range.map((d) => d.toISOString());
    const none = Promise.resolve({ data: [] as Row[] });
    (async () => {
      const [cs, ms, fs, bs] = await Promise.all([
        s.can('counsel') ? db.from('counselling_session').select('id, scheduled_at, status, lead:lead_id(full_name), counsellor:counsellor_id(full_name)').gte('scheduled_at', from).lt('scheduled_at', to) : none,
        s.can('mock') ? db.from('mock_session').select('id, scheduled_at, status, level, candidate:candidate_id(full_name)').gte('scheduled_at', from).lt('scheduled_at', to) : none,
        s.can('followups') ? db.from('follow_up').select('id, due_at, title, status, owner_role, lead:lead_id(full_name), candidate:candidate_id(full_name)').eq('status', 'Open').gte('due_at', from).lt('due_at', to) : none,
        s.can('batch') ? db.from('batch').select('id, code, starts_on, program:program_id(name)').gte('starts_on', from.slice(0, 10)).lt('starts_on', to.slice(0, 10)) : none,
      ]);
      const out: Ev[] = [];
      (cs.data || []).forEach((r: Row) => out.push({ id: 'c' + r.id, at: new Date(r.scheduled_at), allDay: false, kind: 'counsel', title: 'Counselling · ' + (r.lead?.full_name || ''), who: [r.counsellor?.full_name, r.status].filter(Boolean).join(' · '), href: `/p/counsel?edit=lead:${r.id}` }));
      (ms.data || []).forEach((r: Row) => out.push({ id: 'm' + r.id, at: new Date(r.scheduled_at), allDay: false, kind: 'mock', title: `Mock ${r.level} · ` + (r.candidate?.full_name || ''), who: r.status, href: `/p/mock?edit=candidate:${r.id}` }));
      (fs.data || []).forEach((r: Row) => out.push({ id: 'f' + r.id, at: new Date(r.due_at), allDay: false, kind: 'followup', title: r.title + (r.lead?.full_name || r.candidate?.full_name ? ' · ' + (r.lead?.full_name || r.candidate?.full_name) : ''), who: r.owner_role || '', href: `/p/followups?edit=x:${r.id}`, late: new Date(r.due_at).getTime() < Date.now() }));
      (bs.data || []).forEach((r: Row) => out.push({ id: 'b' + r.id, at: new Date(r.starts_on + 'T00:00:00'), allDay: true, kind: 'batch', title: 'Batch ' + r.code + ' starts', who: r.program?.name || '', href: `/p/batch?edit=x:${r.id}` }));
      out.sort((a, b) => a.at.getTime() - b.at.getTime());
      setEvents(out);
    })();
  }, [range, s]);

  const visible = (events || []).filter((e) => show[e.kind]);
  const onDay = (d: Date) => visible.filter((e) => sameDay(e.at, d));
  const days = Array.from({ length: mode === 'week' ? 7 : 42 }, (_, i) => new Date(range[0].getTime() + i * DAY));
  const today = sod(new Date());
  const step = (n: number) => { const d = new Date(anchor); if (mode === 'week') d.setDate(d.getDate() + 7 * n); else d.setMonth(d.getMonth() + n, 1); setAnchor(sod(d)); };
  const title = mode === 'month' ? anchor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : `${range[0].toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${new Date(range[1].getTime() - DAY).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const kinds = (Object.keys(KIND) as Kind[]).filter((k) => (k === 'counsel' ? s.can('counsel') : k === 'mock' ? s.can('mock') : k === 'followup' ? s.can('followups') : s.can('batch')));
  const chip = (e: Ev, compact = false) => (
    <button key={e.id} type="button" onClick={() => router.push(e.href)} title={e.title + (e.who ? ' · ' + e.who : '')}
      className={cx('flex w-full items-center gap-1.5 truncate rounded-md px-1.5 text-left font-medium', compact ? 'min-h-[22px] text-[11px]' : 'min-h-[40px] text-[13px]', KIND[e.kind].chip, e.late && 'ring-1 ring-badText')}>
      <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', e.late ? 'bg-badText' : KIND[e.kind].dot)} />
      {!e.allDay && <span className="num shrink-0 opacity-80">{time(e.at)}</span>}
      <span className="truncate">{e.title}</span>
    </button>
  );

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <PageHeader group="Home" title="Calendar" purpose="Counselling, mock interviews, follow-ups and batch starts. Tap an item to open it." scope={s.staff.role + ' · what your role can see'} />
      <div className="flex flex-wrap items-center gap-2">
        <ButtonGroup label={mode === 'month' ? 'Month' : 'Week'}>
          <IconButton aria-label={mode === 'month' ? 'Previous month' : 'Previous week'} icon={<ChevronLeft size={16} />} onClick={() => step(-1)} />
          <Button variant="quiet" onClick={() => { setAnchor(today); setPicked(today); }}>Today</Button>
          <IconButton aria-label={mode === 'month' ? 'Next month' : 'Next week'} icon={<ChevronRight size={16} />} onClick={() => step(1)} />
        </ButtonGroup>
        <h2 className="min-w-[180px] text-[17px] font-semibold tracking-tight" aria-live="polite">{title}</h2>
        <ButtonGroup label="View" className="ml-auto">
          {(['month', 'week'] as const).map((m) => <Button key={m} variant="quiet" size="sm" active={mode === m} onClick={() => setMode(m)} className="capitalize">{m}</Button>)}
        </ButtonGroup>
      </div>
      <div className="flex flex-wrap gap-2">
        {kinds.map((k) => (
          <button key={k} type="button" aria-pressed={show[k]} onClick={() => setShow({ ...show, [k]: !show[k] })}
            className={cx('flex min-h-[44px] items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-colors hover:bg-surface2', show[k] ? 'text-text' : 'text-muted line-through opacity-70')}>
            <span className={cx('h-2 w-2 rounded-full', KIND[k].dot)} />{KIND[k].label}
          </button>
        ))}
      </div>

      {events === null ? <TableSkeleton rows={6} /> : mode === 'month' ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <div className="overflow-hidden rounded-card bg-surface shadow-1">
            <div className="grid grid-cols-7 border-b border-line text-center text-[12px] font-medium text-muted">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="py-2">{d}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {days.map((d) => {
                const list = onDay(d), out = d.getMonth() !== anchor.getMonth(), isToday = sameDay(d, today), sel = sameDay(d, picked);
                return (
                  <div key={d.toISOString()} role="button" tabIndex={0} aria-label={d.toDateString() + ', ' + list.length + ' items'} onClick={() => setPicked(d)} onKeyDown={(e) => e.key === 'Enter' && setPicked(d)}
                    className={cx('min-h-[96px] cursor-pointer border-b border-r border-line p-1.5 text-left transition-colors hover:bg-surface2/60 max-md:min-h-[64px] [&:nth-child(7n)]:border-r-0', out && 'bg-surface2/50', sel && 'ring-2 ring-inset ring-accent')}>
                    <div className={cx('num mb-1 flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold', isToday ? 'bg-accent text-white' : out ? 'text-muted' : 'text-text')}>{d.getDate()}</div>
                    <div className="flex flex-col gap-0.5 max-md:hidden">
                      {list.slice(0, 3).map((e) => chip(e, true))}
                      {list.length > 3 && <span className="px-1 text-[11px] font-medium text-text2">+{list.length - 3} more</span>}
                    </div>
                    {list.length > 0 && <div className="flex gap-0.5 md:hidden">{list.slice(0, 4).map((e) => <span key={e.id} className={cx('h-1.5 w-1.5 rounded-full', KIND[e.kind].dot)} />)}</div>}
                  </div>
                );
              })}
            </div>
          </div>
          <aside aria-label="Selected day" className="ui-col flex flex-col gap-2 !p-4">
            <h3 className="font-semibold">{picked.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
            {onDay(picked).length === 0 ? <p className="text-[13px] text-text2">Nothing on this day.</p> : onDay(picked).map((e) => (
              <div key={e.id}>{chip(e)}{e.who && <div className="mt-0.5 px-1.5 text-[11.5px] text-muted">{e.who}</div>}</div>
            ))}
          </aside>
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-7">
          {days.map((d) => (
            <section key={d.toISOString()} aria-label={d.toDateString()} className={cx('ui-col flex min-h-[120px] flex-col gap-1.5', sameDay(d, today) && 'ring-1 ring-inset ring-accent')}>
              <div className="flex items-center justify-between px-1 pb-1">
                <span className="text-[12px] font-medium text-muted">{d.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
                <span className={cx('num flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[13px] font-semibold', sameDay(d, today) && 'bg-accent text-white')}>{d.getDate()}</span>
              </div>
              {onDay(d).length === 0 ? <span className="px-1 text-[11.5px] text-muted">—</span> : onDay(d).map((e) => chip(e))}
            </section>
          ))}
        </div>
      )}
      <p className="text-xs text-muted">{visible.length} items in this {mode}. Overdue follow-ups have a red outline.</p>
    </main>
  );
}
