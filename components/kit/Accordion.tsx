'use client';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from '../ui';

// A section that folds away; shows a short status (e.g. "3 of 4 filled") while closed.
export function Section({ title, status, defaultOpen = false, children, done }: { title: string; status?: string; defaultOpen?: boolean; children: React.ReactNode; done?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-line">
      <h2>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-[44px] w-full items-center gap-3 px-2 text-left">
          <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', done ? 'bg-[#16A34A]' : 'bg-line2')} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{title}</span>
          {status && <span className="text-[12.5px] text-muted">{status}</span>}
          <ChevronDown size={18} className={cx('shrink-0 text-muted transition-transform duration-200', open && 'rotate-180')} aria-hidden />
        </button>
      </h2>
      {open && <div className="anim-fade px-2 pb-3 pt-1">{children}</div>}
    </section>
  );
}
