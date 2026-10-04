'use client';
import { useMemo } from 'react';

// Faint diagonal "<name> · <date>" repeated over a screen, so photos or prints of student data show who viewed it.
// Place inside a `relative` container. Does not block clicks; hidden from screen readers; prints too.
export function Watermark({ name, className }: { name: string; className?: string }) {
  const text = useMemo(() => {
    const d = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    return `${name} · ${d}`;
  }, [name]);
  const cells = Array.from({ length: 160 });
  return (
    <div aria-hidden className={'pointer-events-none absolute inset-0 z-[5] select-none overflow-hidden print:fixed ' + (className || '')}
      style={{ opacity: 0.06, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
      <div className="absolute -inset-[50%] flex rotate-[-30deg] flex-wrap content-start gap-x-24 gap-y-20 text-[15px] font-semibold text-text">
        {cells.map((_, i) => <span key={i} className="whitespace-nowrap">{text}</span>)}
      </div>
    </div>
  );
}
