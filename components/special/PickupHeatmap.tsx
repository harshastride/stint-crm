'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cx } from '../ui';
import { hourRange } from '../kit/BestTime';

// When do leads pick up? Calls the signed-in person can see, by India weekday and hour (9 am–10 pm),
// shaded by the share that were picked up. Data: pickup_heatmap / pickup_heatmap_days (migration 090).
export type Cell = { weekday: number; hour: number; calls: number; connected: number };
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const HOURS = Array.from({ length: 13 }, (_, i) => 9 + i);   // 9 … 21
const MIN_SLOT = 5;    // a 2-hour slot needs this many calls before we call it the best
const FAINT = 3;       // squares with fewer calls than this are shown faint
// same blue scale as the activity heatmap; index 0 = calls made, none picked up
const SHADES = ['bg-surface2', 'bg-[#C9D8EE] dark:bg-[#22385A]', 'bg-[#8FB0DD] dark:bg-[#2F5288]', 'bg-[#5F8FCB] dark:bg-[#3D6BB0]', 'bg-[#2F5C9C] dark:bg-[#6A9BE0]'];
const shadeFor = (rate: number) => SHADES[rate <= 0 ? 0 : Math.min(4, Math.ceil(rate * 4))];
const pct = (a: number, b: number) => (b > 0 ? Math.round((100 * a) / b) : 0);
const hourWord = (h: number) => (h % 12 === 0 ? 12 : h % 12) + (h >= 12 ? ' pm' : ' am');
const hourShort = (h: number) => (h % 12 === 0 ? 12 : h % 12) + (h >= 12 ? 'p' : 'a');
const plural = (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many);

export function PickupHeatmap({ days: want = 60 }: { days?: number }) {
  const [rows, setRows] = useState<Cell[] | null>(null);
  const [days, setDays] = useState<number>(want);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    const db = supabase();
    const [h, d] = await Promise.all([db.rpc('pickup_heatmap', { p_days: want }), db.rpc('pickup_heatmap_days', { p_days: want })]);
    if (h.error) { console.error('pickup_heatmap', h.error); setFailed(true); return; }
    setRows((h.data as Cell[]) || []);
    if (!d.error && typeof d.data === 'number') setDays(d.data);
  }, [want]);
  useEffect(() => { load(); }, [load]);
  return <PickupGrid rows={rows} days={days} failed={failed} onRetry={load} />;
}

// The picture itself, from rows already loaded (null = still loading).
export function PickupGrid({ rows, days, failed, onRetry }: { rows: Cell[] | null; days: number; failed?: boolean; onRetry?: () => void }) {

  const grid = useMemo(() => {
    const m = new Map<string, Cell>();
    (rows || []).forEach((r) => m.set(r.weekday + ':' + r.hour, r));
    return m;
  }, [rows]);

  const sum = useMemo(() => {
    const all = rows || [];
    const calls = all.reduce((a, r) => a + r.calls, 0), connected = all.reduce((a, r) => a + r.connected, 0);
    // best 2-hour slot across the week (by pickup share, at least MIN_SLOT calls)
    let best: { from: number; calls: number; connected: number } | null = null;
    for (const h of HOURS.slice(0, -1)) {
      const c = all.filter((r) => r.hour === h || r.hour === h + 1);
      const n = c.reduce((a, r) => a + r.calls, 0), k = c.reduce((a, r) => a + r.connected, 0);
      if (n < MIN_SLOT || k === 0) continue;
      if (!best || k / n > best.connected / best.calls || (k / n === best.connected / best.calls && n > best.calls)) best = { from: h, calls: n, connected: k };
    }
    // best day (at least MIN_SLOT calls)
    let day: { d: number; calls: number; connected: number } | null = null;
    for (let d = 1; d <= 7; d++) {
      const c = all.filter((r) => r.weekday === d);
      const n = c.reduce((a, r) => a + r.calls, 0), k = c.reduce((a, r) => a + r.connected, 0);
      if (n < MIN_SLOT || k === 0) continue;
      if (!day || k / n > day.connected / day.calls) day = { d, calls: n, connected: k };
    }
    return { calls, connected, best, day };
  }, [rows]);

  const inBest = (h: number) => !!sum.best && (h === sum.best.from || h === sum.best.from + 1);

  return (
    <section aria-label="When leads pick up" data-testid="pickup-heatmap" className="rounded-card bg-surface px-4 py-3 shadow-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="text-[13px] font-semibold">When leads pick up</h2>
          <p className="text-[11.5px] text-muted">Calls you can see · last {plural(days, 'day')} · India time</p>
        </div>
        {rows && sum.calls > 0 && (
          <p className="text-[12.5px] text-text2"><b className="num text-text">{sum.connected}</b> of <b className="num text-text">{sum.calls}</b> calls picked up ({pct(sum.connected, sum.calls)}%)</p>
        )}
      </div>

      {failed && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-text2">
          Could not load the pickup times.
          {onRetry && <button type="button" onClick={onRetry} className="btn h-11 rounded-md px-3 text-[13px] font-medium text-accentText hover:bg-accentSoft md:h-9">Try again</button>}
        </div>
      )}
      {!failed && !rows && <div className="mt-3 h-[240px] animate-pulse rounded-xl bg-surface2" aria-hidden />}
      {!failed && rows && sum.calls === 0 && <p className="mt-3 text-[13px] text-text2">No calls between 9 am and 10 pm in the last {plural(days, 'day')} yet. Once calls are logged, this shows the hours leads usually answer.</p>}

      {!failed && rows && sum.calls > 0 && <>
        <p className="mt-2 flex items-start gap-1.5 text-[13px]" data-testid="pickup-best">
          <Clock size={15} strokeWidth={1.8} aria-hidden className="mt-[2px] shrink-0 text-accentText" />
          {sum.best
            ? <span><b>Best time to call: {hourRange(sum.best.from, sum.best.from + 2)}</b> — {pct(sum.best.connected, sum.best.calls)}% picked up ({sum.best.connected} of {sum.best.calls} calls){sum.day ? <>. Best day: <b>{FULL_DAYS[sum.day.d - 1]}</b> ({pct(sum.day.connected, sum.day.calls)}%).</> : '.'}</span>
            : <span className="text-text2">Not enough calls yet to pick a best time (a 2-hour slot needs at least {MIN_SLOT} calls).</span>}
        </p>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full table-fixed border-separate border-spacing-[3px] text-[10.5px]">
            <caption className="sr-only">Share of calls picked up, by weekday and hour, India time. Each square is one hour.</caption>
            <thead>
              <tr>
                <th scope="col" className="w-9"><span className="sr-only">Day</span></th>
                {HOURS.map((h) => (
                  <th key={h} scope="col" className={cx('px-0 pb-0.5 text-center font-medium', inBest(h) ? 'text-accentText' : 'text-muted')}>
                    <span aria-hidden className="hidden sm:inline">{hourShort(h)}</span><span aria-hidden className="sm:hidden">{h % 3 === 0 ? hourShort(h) : ''}</span>
                    <span className="sr-only">{hourWord(h)}</span>
                    {inBest(h) && <span aria-hidden className="mx-auto mt-0.5 block h-[2px] w-3/4 rounded-full bg-accent" />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAYS.map((d, i) => (
                <tr key={d}>
                  <th scope="row" className="pr-1 text-left text-[11px] font-medium text-muted">{d}</th>
                  {HOURS.map((h) => {
                    const c = grid.get(i + 1 + ':' + h);
                    const text = c ? `${FULL_DAYS[i]} ${hourWord(h)}: ${c.connected} of ${plural(c.calls, 'call')} picked up (${pct(c.connected, c.calls)}%)` : `${FULL_DAYS[i]} ${hourWord(h)}: no calls`;
                    return (
                      <td key={h} title={text} className="p-0">
                        <span className={cx('flex h-6 items-center justify-center rounded-[4px] text-[10px] md:h-7',
                          c ? cx(shadeFor(c.connected / c.calls), c.calls < FAINT && 'opacity-50', c.connected / c.calls > 0.6 ? 'text-white' : 'text-text2') : 'border border-dashed border-line')}>
                          <span className="sr-only">{text}</span>
                          {c && <span aria-hidden className="num hidden md:inline">{pct(c.connected, c.calls)}</span>}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-muted">
          <span className="flex items-center gap-1">
            <span className="h-[11px] w-[11px] rounded-[3px] border border-dashed border-line" />No calls
            <span className="ml-2">0%</span>{SHADES.map((s) => <span key={s} className={'h-[11px] w-[11px] rounded-[3px] ' + s} />)}<span>100% picked up</span>
          </span>
          <span>Faint = fewer than {FAINT} calls</span>
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-muted">Picked up = the call was logged as Connected, Interested, Callback or Booked counselling. No answer, Wrong number and Not interested count as calls only. Numbers in squares are % picked up.</p>
      </>}
    </section>
  );
}
