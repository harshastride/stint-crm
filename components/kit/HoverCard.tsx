'use client';
import { useRef, useState } from 'react';

// Show a small card after the pointer rests on something for a moment. Touch screens just tap through.
export function HoverCard({ children, card, block }: { children: React.ReactNode; card: () => React.ReactNode; block?: boolean }) {
  const [open, setOpen] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const enter = (e: React.PointerEvent) => { if (e.pointerType !== 'mouse') return; clearTimeout(t.current); t.current = setTimeout(() => setOpen(true), 450); };
  const leave = () => { clearTimeout(t.current); t.current = setTimeout(() => setOpen(false), 120); };
  return (
    <span className={block ? 'relative block max-w-full' : 'relative inline-block'} onPointerEnter={enter} onPointerLeave={leave}>
      {children}
      {open && (
        <span role="tooltip" onPointerEnter={() => clearTimeout(t.current)} onPointerLeave={leave}
          className="anim-fade absolute left-0 top-full z-40 mt-1.5 block w-72 cursor-default rounded-xl border border-line bg-surface p-3 text-left font-normal shadow-lg" onClick={(e) => e.stopPropagation()}>
          {card()}
        </span>
      )}
    </span>
  );
}
