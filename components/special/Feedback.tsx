'use client';
import { useEffect, useMemo, useState } from 'react';
import { Star } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { PageHeader } from '../kit/PageHeader';
import { EmptyState } from '../kit/EmptyState';
import { Notice, cx } from '../ui';

type F = { id: string; batch_id: string | null; batch_code: string | null; trainer_id: string | null; trainer_name: string | null; subject: 'mock' | 'module' | 'overall'; subject_label: string; rating: number; comment: string | null; created_at: string; student_name: string | null };
const MIN_N = 3; // below this an average is not shown: one or two ratings say little
const SUBJECT: Record<string, string> = { mock: 'Mock interviews', module: 'Weekly classes', overall: 'Whole course' };
const PERIOD: [string, string, number][] = [['30', 'Last 30 days', 30], ['90', 'Last 90 days', 90], ['365', 'Last 12 months', 365]];
const field = 'h-11 min-w-0 rounded-[10px] border border-line2 bg-surface px-2.5 text-[13px] md:h-9';
const avg = (xs: F[]) => xs.reduce((a, r) => a + r.rating, 0) / (xs.length || 1);
const day = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
// Monday of the week (local), as yyyy-mm-dd
const weekOf = (d: string) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toISOString().slice(0, 10); };

function Stars({ n, size = 13 }: { n: number; size?: number }) {
  return <span className="inline-flex" aria-label={`${n} out of 5`}>{[1, 2, 3, 4, 5].map((i) => <Star key={i} size={size} aria-hidden className={i <= Math.round(n) ? 'fill-[#F59E0B] text-[#F59E0B]' : 'text-line2'} />)}</span>;
}
const Avg = ({ xs, short }: { xs: F[]; short?: boolean }) => xs.length < MIN_N
  ? <span className="whitespace-nowrap text-[12.5px] text-muted" title={`Only ${xs.length} rating${xs.length === 1 ? '' : 's'}; an average needs ${MIN_N}`}>{short ? 'Too few' : 'Not enough data'} <span className="num">({xs.length})</span></span>
  : <span className="num font-semibold">{avg(xs).toFixed(1)} <span className="font-normal text-muted">({xs.length})</span></span>;

/** Student feedback: how students rate classes, mocks and the course. Trainers see their own batches only, and no names the student chose to hide. */
export function Feedback() {
  const s = useSession();
  const isTrainer = s.staff.role === 'Trainer';
  const [rows, setRows] = useState<F[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ period: '90', batch: '', trainer: '', subject: '' });
  useEffect(() => {
    const since = new Date(Date.now() - Number(f.period) * 86400000).toISOString();
    setRows(null); setErr(null);
    supabase().from('feedback_for_trainer').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(2000)
      .then(({ data, error }) => { if (error) setErr(error.message); setRows((data || []) as F[]); });
  }, [f.period]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const opts = useMemo(() => {
    const b = new Map<string, string>(), t = new Map<string, string>();
    (rows || []).forEach((r) => { if (r.batch_id) b.set(r.batch_id, r.batch_code || '—'); if (r.trainer_id) t.set(r.trainer_id, r.trainer_name || '—'); });
    return { batches: [...b].sort((x, y) => x[1].localeCompare(y[1])), trainers: [...t].sort((x, y) => x[1].localeCompare(y[1])) };
  }, [rows]);
  const list = useMemo(() => (rows || []).filter((r) => (!f.batch || r.batch_id === f.batch) && (!f.trainer || r.trainer_id === f.trainer) && (!f.subject || r.subject === f.subject)), [rows, f]);
  const groups = useMemo(() => {
    const m = new Map<string, { batch: string; trainer: string; xs: F[] }>();
    list.forEach((r) => { const k = (r.batch_id || '') + '|' + (r.trainer_id || ''); if (!m.has(k)) m.set(k, { batch: r.batch_code || 'No batch', trainer: r.trainer_name || '—', xs: [] }); m.get(k)!.xs.push(r); });
    return [...m.values()].sort((a, b) => b.xs.length - a.xs.length);
  }, [list]);
  const weeks = useMemo(() => {
    const m = new Map<string, F[]>(); list.forEach((r) => { const w = weekOf(r.created_at); m.set(w, [...(m.get(w) || []), r]); });
    return [...m].sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
  }, [list]);
  const comments = list.filter((r) => r.comment).slice(0, 30);

  return (
    <main className="flex flex-1 flex-col gap-3 overflow-y-auto p-4 md:px-6 md:py-4">
      <PageHeader title="Student feedback" group="Training" scope={isTrainer ? 'Your batches' : undefined}
        description={`Ratings students give after a mock, each week of classes and at the end of the course (1–5 stars). Averages need at least ${MIN_N} ratings.${isTrainer ? ' Names are hidden when the student asked.' : ''}`}
        filters={
          <div className="flex flex-wrap items-center gap-1.5">
            <select aria-label="Period" className={field} value={f.period} onChange={set('period')}>{PERIOD.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <select aria-label="Batch" className={field} value={f.batch} onChange={set('batch')}><option value="">All batches</option>{opts.batches.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            {!isTrainer && <select aria-label="Trainer" className={field} value={f.trainer} onChange={set('trainer')}><option value="">All trainers</option>{opts.trainers.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
            <select aria-label="About" className={field} value={f.subject} onChange={set('subject')}><option value="">Everything rated</option>{Object.entries(SUBJECT).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </div>
        } />
      {err && <Notice tone="bad">Could not load feedback: {err}</Notice>}
      {rows === null ? <div className="rounded-[14px] bg-surface p-6 text-muted">Loading…</div>
        : list.length === 0 ? <EmptyState kind={rows.length ? 'search' : 'empty'} title={rows.length ? 'No ratings match these filters' : 'No ratings yet in this period'} body="Students are asked after each mock interview, once a week during classes and at the end of training." />
        : (
          <div className="grid gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
            <div className="flex min-w-0 flex-col gap-5">
              <section aria-label="Overall rating" className="flex flex-wrap items-center gap-6" data-testid="feedback-summary">
                <div>
                  {list.length < MIN_N ? <div className="text-[15px] font-semibold text-muted">Not enough data</div>
                    : <div className="num text-[32px] font-semibold leading-none">{avg(list).toFixed(1)}<span className="text-[14px] text-muted"> / 5</span></div>}
                  {list.length >= MIN_N && <div className="mt-1"><Stars n={avg(list)} size={16} /></div>}
                  <div className="mt-1 text-[12px] text-text2"><span className="num">{list.length}</span> rating{list.length === 1 ? '' : 's'}</div>
                </div>
                <div className="min-w-[200px] flex-1 space-y-1" aria-label="How ratings spread">
                  {[5, 4, 3, 2, 1].map((n) => {
                    const k = list.filter((r) => r.rating === n).length, pct = Math.round((100 * k) / list.length);
                    return (
                      <div key={n} className="flex items-center gap-2 text-[12px]">
                        <span className="w-12 text-text2">{n} star{n > 1 ? 's' : ''}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface2"><div className="h-full rounded-full bg-[#F59E0B]" style={{ width: pct + '%' }} /></div>
                        <span className="num w-12 text-right text-muted">{k} · {pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section aria-label="By batch and trainer">
                <h2 className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">By batch and trainer</h2>
                <table className="w-full text-[13px]">
                  <thead><tr className="border-b border-line text-left text-[12px] text-muted"><th className="py-1.5 font-medium">Batch</th><th className="font-medium">Trainer</th><th className="text-right font-medium">Average (n)</th></tr></thead>
                  <tbody>{groups.map((g) => (
                    <tr key={g.batch + g.trainer} className="border-b border-line last:border-0"><td className="py-2 font-medium">{g.batch}</td><td className="text-text2">{g.trainer}</td><td className="text-right"><Avg xs={g.xs} /></td></tr>
                  ))}</tbody>
                </table>
              </section>

              <section aria-label="Trend by week">
                <h2 className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Average by week</h2>
                <ul className="flex flex-col">
                  {weeks.map(([w, xs]) => (
                    <li key={w} className="flex items-center gap-2 py-1 text-[12.5px]">
                      <span className="w-20 shrink-0 text-text2">w/c {day(w)}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface2">{xs.length >= MIN_N && <div className="h-full rounded-full bg-accent" style={{ width: (avg(xs) / 5) * 100 + '%' }} />}</div>
                      <span className="w-24 shrink-0 text-right"><Avg xs={xs} short /></span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <section aria-label="Recent comments" className="min-w-0">
              <h2 className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Recent comments</h2>
              {comments.length === 0 ? <p className="text-[13px] text-text2">No written comments in this view.</p> : (
                <ul data-testid="feedback-comments">
                  {comments.map((r) => (
                    <li key={r.id} className="border-b border-line py-2.5 last:border-0">
                      <div className="flex items-center justify-between gap-2"><Stars n={r.rating} /><span className="text-[12px] text-muted">{day(r.created_at)}</span></div>
                      <p className="mt-1 whitespace-pre-line break-words text-[13.5px]">{r.comment}</p>
                      <p className={cx('mt-0.5 text-[12px]', r.student_name ? 'text-text2' : 'italic text-muted')}>{[r.student_name || 'Name hidden', r.subject_label, r.batch_code].filter(Boolean).join(' · ')}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
    </main>
  );
}
