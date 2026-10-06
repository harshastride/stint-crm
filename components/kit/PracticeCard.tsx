'use client';
import { Meter } from './Meter';
import { fmtDate } from '../ui';

export type PracticeAttempt = { topic?: string | null; question?: string | null; overall?: number | null; accuracy?: number | null; fluency?: number | null; completeness?: number | null; wpm?: number | null; filler_count?: number | null; created_at: string };

const avg = (xs: (number | null | undefined)[]) => { const v = xs.filter((x): x is number => x != null).map(Number); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };

// Interview Coach practice scores. Pure props: used on Candidate 360 and in the student portal.
export function PracticeCard({ attempts, title = 'Interview practice' }: { attempts: PracticeAttempt[]; title?: string }) {
  const list = [...attempts].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const latest = list[0];
  const trend = list.slice(0, 10).reverse().map((a) => Number(a.overall ?? 0));
  const pts = trend.map((v, i) => `${trend.length > 1 ? (i * 120) / (trend.length - 1) : 60},${30 - (v / 100) * 28}`).join(' ');
  return (
    <section className="border-t border-line pt-4" aria-label={title}>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {!latest ? <p className="text-sm text-text2">No practice yet.</p> : (
        <>
          <div className="mb-3 flex items-end gap-4">
            <div><div className="num text-3xl font-semibold text-text">{latest.overall ?? '—'}<span className="text-base text-muted"> / 100</span></div><div className="text-[12.5px] text-text2">Latest score · {list.length} {list.length === 1 ? 'attempt' : 'attempts'}</div></div>
            {trend.length > 1 && <svg viewBox="0 0 120 32" className="h-8 w-32 text-accent" role="img" aria-label="Score trend, last 10"><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>}
          </div>
          <div className="mb-3 grid gap-2 sm:grid-cols-3">
            {(['accuracy', 'fluency', 'completeness'] as const).map((f) => { const v = avg(list.map((a) => a[f])); return <Meter key={f} label={'Average ' + f} value={v ?? 0} max={100} text={v == null ? '—' : String(v)} />; })}
          </div>
          <ul className="mt-1 divide-y divide-line/70 text-sm">
            {list.slice(0, 5).map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0"><span className="block truncate font-medium">{a.topic || 'Practice'}</span>{a.question && <span className="block truncate text-text2">{a.question}</span>}</span>
                <span className="shrink-0 text-right"><span className="num block font-semibold">{a.overall ?? '—'}</span><span className="block text-[12px] text-muted">{fmtDate(a.created_at)}</span></span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
