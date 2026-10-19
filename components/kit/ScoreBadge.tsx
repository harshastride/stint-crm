'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { cx } from '../ui';
import { BestTime } from './BestTime';

// How promising a lead is, from the database view lead_signal (rule-based, 0–100):
// Cold under 40, Warm 40–69, Hot 70 and up. The word is always shown (never colour alone);
// hover, focus or tap shows the plain reasons behind the number.
export type Band = 'Hot' | 'Warm' | 'Cold';
export type LeadSignal = { lead_id: string; score: number; band: Band; reasons: string[] | null; best_from: number | null; best_to: number | null; best_label: string | null; last_contact_at: string | null };

const WORD: Record<Band, string> = {
  Hot: 'bg-[#FFE4D6] text-[#9A3412] dark:bg-[#3A2418] dark:text-[#FFB08F]',
  Warm: 'bg-warnBg text-warnText',
  Cold: 'bg-surface2 text-text2',
};
const bandOf = (n: number): Band => (n >= 70 ? 'Hot' : n >= 40 ? 'Warm' : 'Cold');

// Thin Cold → Warm → Hot track (zones sized 40 / 30 / 30) with a marker at the score
function Track({ score, wide }: { score: number; wide?: boolean }) {
  const at = Math.max(0, Math.min(100, score));
  return (
    <span aria-hidden className={cx('relative flex shrink-0 overflow-visible', wide ? 'h-1.5 w-24' : 'h-1 w-12')}>
      <span className="h-full w-[40%] rounded-l-full bg-[#C9D8EE] dark:bg-[#2F5288]" />
      <span className="h-full w-[30%] bg-[#F5C77E] dark:bg-[#8A6420]" />
      <span className="h-full w-[30%] rounded-r-full bg-coral" />
      <span className={cx('absolute top-1/2 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-text ring-2 ring-surface', wide ? 'h-3.5' : 'h-2.5')} style={{ left: at + '%' }} />
    </span>
  );
}

export function ScoreBadge({ score, band, reasons, size = 'cell', className }: { score: number | null | undefined; band?: Band | null; reasons?: string[] | null; size?: 'cell' | 'header'; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);   // opened by a click or tap: stays until clicked again, Esc or click outside
  const tip = useId();
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!pinned) return;
    const away = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) { setPinned(false); setOpen(false); } };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [pinned]);
  if (score == null) return <span className={cx('text-muted', className)} title="No score: the lead is closed or hidden">—</span>;
  const b = band || bandOf(score);
  const why = (reasons || []).filter(Boolean);
  const big = size === 'header';
  const label = `${b} lead, score ${score} of 100${why.length ? '. Why: ' + why.join('; ') : ''}`;
  return (
    <span ref={box} className={cx('relative inline-flex', className)}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setOpen(true); }} onPointerLeave={(e) => { if (e.pointerType === 'mouse' && !pinned) setOpen(false); }}>
      <button type="button" aria-label={label} aria-describedby={open ? tip : undefined}
        onFocus={() => setOpen(true)} onBlur={() => { if (!pinned) setOpen(false); }}
        onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); setPinned(false); } }}
        onClick={(e) => { e.stopPropagation(); const next = !pinned; setPinned(next); setOpen(next); }}
        className={cx('inline-flex min-h-[44px] items-center gap-2 rounded-md px-1 text-left md:min-h-[32px] hover:bg-surface2', big && 'md:min-h-[36px]')}>
        <span className={cx('inline-flex items-baseline gap-1 whitespace-nowrap rounded-full font-semibold', WORD[b], big ? 'px-2.5 py-[3px] text-[12.5px]' : 'px-2 py-[2px] text-[11.5px]')}>
          {b}<span className="num font-medium opacity-80">{score}</span>
        </span>
        <Track score={score} wide={big} />
      </button>
      {open && (
        <span id={tip} role="tooltip" onClick={(e) => e.stopPropagation()}
          className="anim-fade absolute left-0 top-full z-40 mt-1 block w-64 max-w-[80vw] cursor-default rounded-xl border border-line bg-surface p-3 text-left font-normal shadow-lg">
          <span className="block text-[12.5px] font-semibold text-text">{b} · {score} of 100</span>
          {why.length > 0
            ? <ul className="mt-1.5 flex flex-col gap-1 text-[12.5px] text-text2">{why.map((r) => <li key={r} className="flex gap-1.5"><span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted" />{r}</li>)}</ul>
            : <span className="mt-1 block text-[12.5px] text-text2">Nothing yet beyond the stage.</span>}
          <span className="mt-2 block border-t border-line pt-2 text-[11.5px] leading-snug text-muted">From stage, call results, counselling, fee quote and brochure reading. Hot 70+, Warm 40–69, Cold under 40.</span>
        </span>
      )}
    </span>
  );
}

// For the lead's side panel header: badge + best time on one line. Loads its own row; shows nothing for closed or hidden leads.
export function LeadSignalLine({ leadId, className }: { leadId: string; className?: string }) {
  const [sig, setSig] = useState<LeadSignal | null>(null);
  useEffect(() => {
    let live = true;
    setSig(null);
    supabase().from('lead_signal').select('*').eq('lead_id', leadId).maybeSingle()
      .then(({ data, error }: { data: LeadSignal | null; error: unknown }) => { if (error) console.error('lead_signal', error); if (live) setSig(data); });
    return () => { live = false; };
  }, [leadId]);
  if (!sig) return null;
  return (
    <div data-testid="lead-signal" className={cx('-mx-1 flex flex-wrap items-center gap-x-3 gap-y-0', className)}>
      <ScoreBadge score={sig.score} band={sig.band} reasons={sig.reasons} size="header" />
      <BestTime label={sig.best_label} from={sig.best_from} to={sig.best_to} />
    </div>
  );
}
