'use client';
import { useEffect, useRef, useState } from 'react';
import { cx } from '../ui';

// A small "Are you sure?" bubble next to the button, instead of a full-screen dialog.
export function Confirm({ children, title, body, yes = 'Yes, do it', danger = true, onYes, disabled, className, align = 'right', full, ariaLabel }: {
  children: React.ReactNode; title: string; body?: string; yes?: string; danger?: boolean; onYes: () => void; disabled?: boolean; className?: string; align?: 'left' | 'right'; full?: boolean; ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <span ref={box} className={cx('relative', full ? 'flex w-full [&>button]:flex-1' : 'inline-flex')}>
      <button type="button" aria-label={ariaLabel} disabled={disabled} aria-expanded={open} aria-haspopup="dialog" onClick={(e) => { e.stopPropagation(); setOpen(!open); }} className={className}>{children}</button>
      {open && (
        <span role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}
          className={cx('anim-fade absolute bottom-full z-40 mb-2 w-64 rounded-xl border border-line bg-surface p-3 text-left shadow-lg', align === 'right' ? 'right-0' : 'left-0')}>
          <span className="block text-[13.5px] font-semibold text-text">{title}</span>
          {body && <span className="mt-1 block text-[12.5px] text-text2">{body}</span>}
          <span className="mt-3 flex justify-end gap-2">
            <button type="button" autoFocus onClick={() => setOpen(false)} className="min-h-[36px] rounded-lg px-3 text-[13px] font-medium text-text2 hover:bg-surface2">Cancel</button>
            <button type="button" onClick={() => { setOpen(false); onYes(); }} className={cx('min-h-[36px] rounded-lg px-3 text-[13px] font-semibold text-white', danger ? 'bg-[#C2410C]' : 'bg-accent')}>{yes}</button>
          </span>
        </span>
      )}
    </span>
  );
}
