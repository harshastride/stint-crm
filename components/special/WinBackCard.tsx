'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { supabase } from '@/lib/supabase';

// Dashboard line for Telecaller / Sales / Admin: how many lost or quiet leads can be won back now, and how many came
// back this month. Shows nothing when the role can't open Win-back or there is nothing to say.
type Summary = { can_win_back: number; back_this_month: number; moved_on_this_month: number; after_days: number };

export function WinBackCard() {
  const [sum, setSum] = useState<Summary | null>(null);
  useEffect(() => {
    let alive = true;
    supabase().rpc('winback_summary').then(({ data, error }: { data: Summary | null; error: unknown }) => { if (alive && !error) setSum(data); });
    return () => { alive = false; };
  }, []);
  if (!sum || (sum.can_win_back === 0 && sum.back_this_month === 0)) return null;
  return (
    <section aria-label="Win-back" className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface px-4 py-3 shadow-1">
      <div className="min-w-0">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold"><RotateCcw size={14} className="text-accentText" aria-hidden />Win-back</h2>
        <p className="mt-0.5 text-[13px] text-text2">
          <span className="num font-semibold text-text">{sum.can_win_back}</span> lost or quiet lead{sum.can_win_back === 1 ? '' : 's'} can be tried again
          {' · '}<span className="num font-semibold text-text">{sum.back_this_month}</span> back in calling this month
          {sum.moved_on_this_month > 0 && <>, {sum.moved_on_this_month} now Interested or further</>}
        </p>
      </div>
      <Link href="/p/winback" className="inline-flex h-11 shrink-0 items-center rounded-[10px] border border-line2 bg-surface px-4 text-[13.5px] font-medium text-accentText hover:bg-surface2 md:h-9">Open Win-back</Link>
    </section>
  );
}
