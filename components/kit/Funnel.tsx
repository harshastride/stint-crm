'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { DateRange, type Range } from './DateRange';

// Cohort funnel: take the leads CREATED in the chosen dates, then count how many of those same leads ever
// reached each later step. Counts come from funnel_cohort (database rights apply), so each step is at most the
// one before it. A step is null when the viewer cannot see that part of the CRM.
type Step = { step: number; label: string; n: number | null; history_since: string | null };

const nice = (s: string) => new Date(s + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const DEFINITION = 'Each row counts leads from the same group: the leads created in the dates you picked. '
  + 'A lead counts as having reached a step if its stage is at or past that step now, its stage history shows it got there, '
  + 'it had a counselling session (for Counselled), or it became a candidate (for Enrolled). Placed means its candidate is Placed or Alumni. '
  + 'Leads closed long ago may be hidden by the old-data rule and are then not counted.';

export function Funnel({ title = 'Lead conversion' }: { title?: string }) {
  const [range, setRange] = useState<Range>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [err, setErr] = useState('');
  const [why, setWhy] = useState(false);

  useEffect(() => {
    let live = true;
    setSteps(null);
    supabase().rpc('funnel_cohort', { p_from: range?.from ?? null, p_to: range?.to ?? null }).then(({ data, error }) => {
      if (!live) return;
      if (error) setErr(error.message); else { setErr(''); setSteps(((data || []) as Step[]).filter((x) => x.n != null)); }
    });
    return () => { live = false; };
  }, [range]);

  const base = steps?.[0] ? Number(steps[0].n) : 0;
  const scope = range ? `Leads created ${nice(range.from)} – ${nice(range.to)}` : 'Leads created at any time';
  const since = steps?.[0]?.history_since;
  const listHref = '/p/lead' + (range ? `?from=${range.from}&to=${range.to}` : '');

  return (
    <section data-testid="funnel" aria-label={title} className="rounded-card bg-surface p-5 shadow-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" aria-expanded={why} aria-controls="funnel-def" onClick={() => setWhy(!why)} aria-label="How this is counted"
            className="flex h-11 w-11 items-center justify-center rounded-row text-muted hover:bg-surface2 hover:text-text"><Info size={15} /></button>
        </div>
        <DateRange value={range} onChange={setRange} label="All time" />
      </div>
      <p data-testid="funnel-scope" className="text-[13px] text-text2">
        {scope}{steps && steps.length > 0 && <>: of <span className="num font-semibold text-text">{base}</span>, how many reached each step.</>}
      </p>
      {why && <p id="funnel-def" className="mt-2 rounded-row bg-surface2 p-3 text-[12.5px] leading-relaxed text-text2">{DEFINITION}{since ? ` Stage history is recorded from ${new Date(since).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}; earlier moves are known only from the current stage.` : ''}</p>}
      {err && <p className="mt-3 text-[13px] text-badText">Could not load the funnel: {err}</p>}
      {!steps && !err && <div className="mt-4 h-40 animate-pulse rounded-card bg-surface2" />}
      {steps && steps.length === 0 && <p className="mt-3 text-text2">Your role cannot see leads, so there is no funnel to show.</p>}
      {steps && steps.length > 0 && base === 0 && <p data-testid="funnel-empty" className="mt-3 text-text2">Not enough data: no leads were created in these dates.</p>}
      {steps && base > 0 && (
        <ol className="mt-3 flex flex-col">
          {steps.map((x, i) => {
            const n = Number(x.n), prev = i > 0 ? Number(steps[i - 1].n) : null;
            const ofAll = Math.round((100 * n) / base);
            const fromPrev = prev == null ? null : prev > 0 ? Math.round((100 * n) / prev) : null;
            const row = (
              <>
                <span className="w-[120px] shrink-0 text-[13px] font-medium">{x.label}</span>
                <span className="relative h-6 flex-1 rounded-chip bg-surface2" aria-hidden>
                  <span className="absolute inset-y-0 left-0 rounded-chip bg-accent" style={{ width: Math.max(n ? 2 : 0, ofAll) + '%' }} />
                </span>
                <span className="num w-[44px] shrink-0 text-right text-[15px] font-semibold">{n}</span>
                <span className="num w-[44px] shrink-0 text-right text-[12.5px] text-muted">{ofAll}%</span>
              </>
            );
            return (
              <li key={x.step} data-testid="funnel-step" data-n={n}>
                {i > 0 && (
                  <div className="pl-[120px] text-[11.5px] text-muted" data-testid="funnel-drop">
                    {fromPrev == null ? 'Not enough data (none at the step before)' : `${fromPrev}% of the step before`}
                  </div>
                )}
                {i === 0
                  ? <Link href={listHref} aria-label={`${x.label}: ${n}. Open these leads`} className="flex min-h-[44px] items-center gap-3 rounded-row px-1 hover:bg-surface2">{row}</Link>
                  : <div className="flex min-h-[44px] items-center gap-3 px-1" aria-label={`${x.label}: ${n} of ${base} (${ofAll}%)`}>{row}</div>}
              </li>
            );
          })}
        </ol>
      )}
      {steps && base > 0 && <p className="mt-2 text-[11.5px] text-muted">Percent on the right = share of all {base} leads in this group. Tap “Leads created” to open the same leads.</p>}
    </section>
  );
}
