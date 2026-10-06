'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { cx } from '../ui';

type Metric = 'calls' | 'enrolments' | 'placements';
type Period = 'week' | 'month';
type Row = { staff_id: string; full_name: string; role: string; total: number; rank: number; prev_rank: number | null; is_me: boolean };

const METRICS: [Metric, string][] = [['calls', 'Calls made'], ['enrolments', 'Enrolments'], ['placements', 'Placements']];
const MEDAL = ['🥇', '🥈', '🥉'];

function defaultMetric(role: string): Metric {
  if (role === 'Placement') return 'placements';
  if (role === 'Sales' || role === 'HR / Counsellor') return 'enrolments';
  return 'calls';
}

// Team leaderboard: staff ranked by calls, enrolments or placements, this week or this month.
export function Leaderboard({ role }: { role: string }) {
  const [metric, setMetric] = useState<Metric>(defaultMetric(role));
  const [period, setPeriod] = useState<Period>('week');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let live = true;
    setRows(null); setErr(false);
    supabase().rpc('leaderboard', { p_metric: metric, p_period: period }).then(({ data, error }) => {
      if (!live) return;
      if (error) setErr(true); else setRows((data as Row[]) || []);
    });
    return () => { live = false; };
  }, [metric, period]);

  const prevLabel = period === 'week' ? 'last week' : 'last month';
  const btn = (on: boolean) => cx('min-h-[44px] rounded-lg px-3 text-[13px] font-medium', on ? 'bg-accent text-white' : 'text-text2 hover:bg-surface2');

  return (
    <section aria-label="Team leaderboard" data-testid="leaderboard" className="rounded-card bg-surface shadow-1 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold">Team leaderboard</h2>
        <div role="group" aria-label="Period" className="flex gap-1 rounded-xl bg-surface2 p-1">
          <button type="button" aria-pressed={period === 'week'} className={btn(period === 'week')} onClick={() => setPeriod('week')}>This week</button>
          <button type="button" aria-pressed={period === 'month'} className={btn(period === 'month')} onClick={() => setPeriod('month')}>This month</button>
        </div>
      </div>
      <div role="group" aria-label="Measure" className="mt-3 flex flex-wrap gap-1">
        {METRICS.map(([m, label]) => (
          <button key={m} type="button" aria-pressed={metric === m} className={btn(metric === m)} onClick={() => setMetric(m)}>{label}</button>
        ))}
      </div>

      {err && <p className="mt-3 text-text2">Could not load the leaderboard.</p>}
      {!err && rows === null && <div className="mt-3 h-24 animate-pulse rounded-xl bg-surface2" />}
      {rows && rows.length === 0 && <p className="mt-3 text-text2">No staff in this team yet.</p>}
      {rows && rows.length > 0 && (
        <ol className="mt-3">
          {rows.map((r) => {
            const move = r.prev_rank == null ? null : r.prev_rank - r.rank;
            return (
              <li key={r.staff_id} data-me={r.is_me || undefined}
                className={cx('flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2', r.is_me && 'bg-accentSoft ring-1 ring-accent')}>
                <span className="num w-8 text-center text-[15px] font-semibold" aria-label={'Rank ' + r.rank}>
                  {r.total > 0 && r.rank <= 3 ? MEDAL[r.rank - 1] : r.rank}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{r.full_name}{r.is_me && <span className="ml-1.5 text-xs text-accentText">(you)</span>}</span>
                  <span className="block text-xs text-muted">{r.role}</span>
                </span>
                <span className="w-16 text-right text-[11.5px] font-semibold" title={'Rank compared with ' + prevLabel}>
                  {move == null ? <span className="text-muted">new</span>
                    : move > 0 ? <span className="text-goodText">▲ {move}</span>
                    : move < 0 ? <span className="text-badText">▼ {-move}</span>
                    : <span className="text-muted">–</span>}
                </span>
                <span className="num w-10 text-right text-[15px] font-semibold">{r.total}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
