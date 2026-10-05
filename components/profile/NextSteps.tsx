'use client';
import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { STEP_ICON } from '@/lib/icons';
import type { Step } from '@/lib/nextSteps';
import { cx } from '../ui';

export function StepIcon({ k, size = 15 }: { k: string; size?: number }) { const I = STEP_ICON[k]; return I ? <I size={size} strokeWidth={2} aria-hidden /> : null; }

/** The usual next step for this stage as the main button, the rest under "More steps".
 *  Same names and order in the quick panel and the full profile (from lib/nextSteps). */
export function NextSteps({ stage, steps, onRun, children, inline }: { stage: string; steps: Step[]; onRun: (st: Step) => void; children?: React.ReactNode; inline?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!steps.length && !children) return null;
  const run = (st: Step) => { setOpen(false); onRun(st); };
  return (
    <div className="flex flex-col gap-1.5" aria-label="Next steps" role="group">
      {steps.length > 0 && <div className="text-[11.5px] font-semibold text-muted">Next steps · {stage}</div>}
      <div className={cx('flex gap-1.5', inline ? 'flex-wrap items-center' : 'flex-col')}>
        {steps[0] && <button type="button" onClick={() => run(steps[0])} className={cx('flex min-h-[44px] items-center justify-center gap-1.5 rounded-[10px] bg-accent px-4 text-[13px] font-semibold text-white transition-transform duration-150 ease-out active:scale-[0.97] motion-reduce:transform-none', !inline && 'w-full')}><StepIcon k={steps[0].key} /><span className="truncate">{steps[0].label}</span></button>}
        <div className={cx('flex items-center gap-1.5', !inline && 'w-full')}>
          {steps.length > 1 && (
            <div className={cx('relative', !inline && 'flex-1')}>
              <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-[44px] w-full items-center justify-center gap-1 rounded-[10px] bg-surface2 px-3 text-[13px] font-semibold text-text2"><MoreHorizontal size={16} aria-hidden />More steps ({steps.length - 1})</button>
              {open && <>
                <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
                <div role="menu" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }} className="anim-fade absolute left-0 top-full z-40 mt-1 flex w-64 max-w-[calc(100vw-2rem)] origin-top-left flex-col rounded-[12px] border border-line bg-surface p-1 shadow-xl">
                  {steps.slice(1).map((st, i) => <button key={st.key} role="menuitem" type="button" autoFocus={i === 0} onClick={() => run(st)} className="flex min-h-[44px] items-center gap-2 rounded-lg px-2.5 text-left text-[13px] font-medium hover:bg-surface2 focus-visible:bg-surface2"><StepIcon k={st.key} />{st.label}</button>)}
                </div>
              </>}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
