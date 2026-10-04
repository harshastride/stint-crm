'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { DateRange, type Range } from './DateRange';

// Conversion funnel: Leads → Interested → Counselling → Enrolled → Placed. Counts come from funnel_counts (database rights apply).
type Step = { step: number; label: string; page: string; stage: string | null; n: number | null };

export function Funnel({ title = 'Conversion funnel' }: { title?: string }) {
  const [range, setRange] = useState<Range>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setSteps(null);
    supabase().rpc('funnel_counts', { p_from: range?.from ?? null, p_to: range?.to ?? null }).then(({ data, error }) => {
      if (error) setErr(error.message); else { setErr(''); setSteps(((data || []) as Step[]).filter((x) => x.n != null)); }
    });
  }, [range]);

  const top = Math.max(1, ...(steps || []).map((x) => Number(x.n)));
  return (
    <section data-testid="funnel" className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <DateRange value={range} onChange={setRange} label="All time" />
      </div>
      {err && <p className="mt-3 text-[13px] text-badText">Could not load the funnel: {err}</p>}
      {!steps && !err && <div className="mt-4 h-40 animate-pulse rounded-xl bg-surface2" />}
      {steps && steps.length === 0 && <p className="mt-3 text-text2">Nothing to show for your role.</p>}
      {steps && steps.length > 0 && (
        <ol className="mt-4 flex flex-col gap-1.5">
          {steps.map((x, i) => {
            const n = Number(x.n), prev = i > 0 ? Number(steps[i - 1].n) : null;
            const kept = prev ? Math.round((100 * n) / prev) : null;
            const w = Math.max(6, Math.round((100 * n) / top));
            const href = `/p/${x.page}${x.stage ? `?stage=${encodeURIComponent(x.stage)}` : ''}`;
            return (
              <li key={x.step}>
                {kept != null && (
                  <div className="flex items-center gap-3 pl-1 text-[11.5px]" data-testid="funnel-drop">
                    <span className="num font-semibold text-goodText">{kept}% kept</span>
                    <span className="num text-badText">{100 - kept}% lost</span>
                  </div>
                )}
                <Link href={href} data-testid="funnel-step" aria-label={`${x.label}: ${n}. Open the list`}
                  className="group flex min-h-[44px] items-center gap-3 rounded-xl px-1 hover:bg-surface2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                  <span className="w-[96px] shrink-0 text-[13px] font-medium">{x.label}</span>
                  <span className="relative flex h-8 flex-1 justify-center" aria-hidden>
                    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-full transition-[width] duration-300" style={{ width: w + '%' }}>
                      <rect x="0" y="0" width="100" height="32" rx="6" className={i === steps.length - 1 ? 'fill-coral' : 'fill-accent'} style={{ opacity: 1 - i * 0.12 }} />
                    </svg>
                  </span>
                  <span className="num w-[56px] shrink-0 text-right text-[15px] font-semibold">{n}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
