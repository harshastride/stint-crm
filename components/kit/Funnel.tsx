'use client';
import { friendlyError } from '@/components/Fields';
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
  const [direct, setDirect] = useState<number | null>(null);   // students enrolled without a lead record (not in this group)

  useEffect(() => {
    let live = true;
    setSteps(null);
    supabase().rpc('funnel_cohort', { p_from: range?.from ?? null, p_to: range?.to ?? null }).then(({ data, error }) => {
      if (!live) return;
      if (error) setErr(friendlyError(error, 'this', 'Please try again.')); else { setErr(''); setSteps(((data || []) as Step[]).filter((x) => x.n != null)); }
    });
    // students added straight to Candidates have no lead, so they cannot be part of this lead group: count them for a note
    let q = supabase().from('candidate').select('id', { count: 'exact', head: true }).is('lead_id', null);
    if (range) q = q.gte('created_at', range.from + 'T00:00:00+05:30').lte('created_at', range.to + 'T23:59:59+05:30');
    q.then(({ count, error }: { count: number | null; error: unknown }) => { if (live) setDirect(error ? null : count); });
    return () => { live = false; };
  }, [range]);

  const base = steps?.[0] ? Number(steps[0].n) : 0;
  const scope = range ? `Leads created ${nice(range.from)} – ${nice(range.to)}` : 'Leads created at any time';
  const since = steps?.[0]?.history_since;
  const listHref = '/p/lead' + (range ? `?from=${range.from}&to=${range.to}` : '');

  return (
    <section data-testid="funnel" aria-label={title} className="rounded-card bg-surface px-4 py-3 shadow-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          <button type="button" aria-expanded={why} aria-controls="funnel-def" onClick={() => setWhy(!why)} aria-label="How this is counted"
            className="flex h-11 w-11 items-center justify-center rounded-row text-muted hover:bg-surface2 hover:text-text"><Info size={15} /></button>
        </div>
        <DateRange value={range} onChange={setRange} label="All time" />
      </div>
      <p data-testid="funnel-scope" className="text-[13px] text-text2">
        {scope}{steps && steps.length > 0 && <>: of <span className="num font-semibold text-text">{base}</span>, how many reached each step.</>}
      </p>
      {why && <p id="funnel-def" className="mt-2 rounded-row bg-surface2 p-3 text-[12.5px] leading-relaxed text-text2">{DEFINITION}{since ? ` Stage history is recorded from ${new Date(since).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}; earlier moves are known only from the current stage.` : ''}</p>}
      {err && <p className="mt-3 text-[13px] text-badText">Could not load the funnel. {err}</p>}
      {!steps && !err && <div className="mt-4 h-40 animate-pulse rounded-card bg-surface2" />}
      {steps && steps.length === 0 && <p className="mt-3 text-text2">Your role cannot see leads, so there is no funnel to show.</p>}
      {steps && steps.length > 0 && base === 0 && <p data-testid="funnel-empty" className="mt-3 text-text2">Not enough data: no leads were created in these dates.</p>}
      {steps && base > 0 && (() => {
        const ns = steps.map((x) => Number(x.n));
        // the biggest drop between two neighbouring steps (share of the step before that did not go on)
        let leak: { i: number; lost: number; pct: number } | null = null;
        ns.forEach((n, i) => { if (i === 0 || ns[i - 1] <= 0) return; const lost = ns[i - 1] - n, pct = Math.round((100 * lost) / ns[i - 1]); if (lost > 0 && (!leak || pct > leak.pct)) leak = { i, lost, pct }; });
        const L = leak as { i: number; lost: number; pct: number } | null;
        return (<>
          {L && (
            <p data-testid="funnel-leak" className="mt-2 rounded-row bg-[rgba(255,107,53,0.10)] px-3 py-2 text-[13px] text-text">
              <b className="text-[#C2410C] dark:text-[#FFB18F]">Biggest drop:</b> {steps[L.i - 1].label} → {steps[L.i].label}. {L.lost} of {ns[L.i - 1]} ({L.pct}%) did not go on.
            </p>
          )}
          <FunnelShape steps={steps} ns={ns} base={base} leakAt={L?.i ?? -1} />
          <ol className="mt-3 flex flex-col sm:sr-only">
            {steps.map((x, i) => {
              const n = ns[i], prev = i > 0 ? ns[i - 1] : null;
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
                    <div className={'pl-[120px] text-[11.5px] ' + (i === L?.i ? 'font-semibold text-[#C2410C] dark:text-[#FFB18F]' : 'text-muted')} data-testid="funnel-drop">
                      {fromPrev == null ? 'Not enough data (none at the step before)' : `${fromPrev}% of the step before` + (prev! - n > 0 ? ` · ${prev! - n} did not go on` : '')}
                    </div>
                  )}
                  {i === 0
                    ? <Link href={listHref} aria-label={`${x.label}: ${n}. Open these leads`} className="flex min-h-[44px] items-center gap-3 rounded-row px-1 hover:bg-surface2">{row}</Link>
                    : <div className="flex min-h-[44px] items-center gap-3 px-1" aria-label={`${x.label}: ${n} of ${base} (${ofAll}%)`}>{row}</div>}
                </li>
              );
            })}
          </ol>
        </>);
      })()}
      {steps && direct != null && direct > 0 && (
        <p data-testid="funnel-direct" className="mt-2 text-[12.5px] text-text2">
          Not in this funnel: {direct} student{direct === 1 ? ' was' : 's were'} enrolled {range ? 'in these dates ' : ''}without a lead record (added straight to Candidates), so the Enrolled step only counts students who came through Leads.
        </p>
      )}
      {steps && base > 0 && <p className="mt-2 text-[11.5px] text-muted">Percent = share of all {base} leads in this group. <Link href={listHref} className="font-medium text-accentText underline">Open these leads</Link></p>}
    </section>
  );
}

/** Tapering funnel (desktop): one column per step, the shape narrows with the count; drop between steps marked. */
function FunnelShape({ steps, ns, base, leakAt }: { steps: Step[]; ns: number[]; base: number; leakAt: number }) {
  const W = 1000, H = 150, n = steps.length, gap = 6, segW = (W - gap * (n - 1)) / n, my = H / 2;
  const half = (v: number, k: number) => Math.max(v > 0 ? 2.5 : 0.75, (v / base) * H * 0.46 * k);
  const path = (a: number, b: number, k: number) => { const h0 = half(a, k), h1 = half(b, k); return `M0 ${my - h0} L${segW} ${my - h1} L${segW} ${my + h1} L0 ${my + h0} Z`; };
  return (
    <div className="mt-3 hidden sm:block" aria-hidden data-testid="funnel-shape">
      <div className="grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, columnGap: gap / 10 + '%' }}>
        {steps.map((x, i) => (
          <div key={x.step} className="min-w-0 px-1">
            <div className="truncate text-[12.5px] font-medium text-text2" title={x.label}>{x.label}</div>
            <div className="flex items-baseline gap-1.5"><span className="num text-[20px] font-semibold text-text">{ns[i]}</span><span className="num text-[12px] text-muted">{Math.round((100 * ns[i]) / base)}%</span></div>
          </div>
        ))}
      </div>
      <div className="relative mt-1.5">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[120px] w-full">
          {steps.map((x, i) => (
            <g key={x.step} transform={`translate(${i * (segW + gap)} 0)`}>
              {/* the fade-in sits on an inner group: a CSS transform on the outer one would replace its position */}
              <g className="funnel-seg" style={{ animationDelay: i * 70 + 'ms' }}>
                {[1, 0.82, 0.65].map((k, l) => <path key={l} d={path(ns[i], ns[Math.min(i + 1, n - 1)], k)} fill="var(--accent)" opacity={[0.18, 0.4, 0.9][l]} />)}
              </g>
            </g>
          ))}
        </svg>
        {steps.map((x, i) => {
          if (i === 0) return null;
          const prev = ns[i - 1], lost = prev - ns[i];
          if (prev <= 0) return null;
          const pct = Math.round((100 * lost) / prev);
          return (
            <span key={x.step} className={'num absolute top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold shadow-1 '
              + (i === leakAt ? 'bg-coral text-[#0F2545]' : 'bg-surface text-text2')}
              style={{ left: `${(i * (segW + gap) - gap / 2) / 10}%` }}>
              {lost > 0 ? `−${pct}%` : '0%'}
            </span>
          );
        })}
      </div>
    </div>
  );
}
