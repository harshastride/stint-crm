'use client';
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { cx } from '../ui';

const TONES = ['bg-[#FFE4D6] text-[#9A3412] dark:bg-[#3A2418] dark:text-[#FFB18F]', 'bg-accentSoft text-accentText', 'bg-goodBg text-goodText', 'bg-warnBg text-warnText', 'bg-[#EDE9FE] text-[#5B21B6] dark:bg-[#2E2546] dark:text-[#C4B5FD]', 'bg-surface2 text-text2'];
/** The same tag always gets the same colour. */
export const tagTone = (t: string) => TONES[[...t].reduce((a, ch) => a + ch.charCodeAt(0), 0) % TONES.length];

export function TagChips({ tags, max = 3 }: { tags?: string[] | null; max?: number }) {
  if (!tags?.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {tags.slice(0, max).map((t) => <span key={t} className={cx('rounded-full px-2 py-0.5 text-[11.5px] font-medium', tagTone(t))}>{t}</span>)}
      {tags.length > max && <span className="rounded-full bg-surface2 px-2 py-0.5 text-[11.5px] text-muted">+{tags.length - max}</span>}
    </span>
  );
}

/** Pick tags from the "Tags" dropdown list (Admin changes the choices under Dropdowns). */
export function TagPicker({ value, options, onChange, disabled, label = 'Tags' }: { value: string[] | null; options: string[]; onChange: (v: string[]) => void; disabled?: boolean; label?: string }) {
  const cur = value || [];
  const [open, setOpen] = useState(false);
  const left = options.filter((o) => !cur.includes(o));
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={label}>
      {cur.map((t) => (
        <span key={t} className={cx('flex min-h-[32px] items-center gap-1 rounded-full pl-2.5 text-[12.5px] font-medium', tagTone(t))}>
          {t}
          {!disabled && <button type="button" aria-label={'Remove tag ' + t} onClick={() => onChange(cur.filter((x) => x !== t))} className="flex h-8 w-7 items-center justify-center rounded-r-full"><X size={12} /></button>}
        </span>
      ))}
      {!disabled && left.length > 0 && (
        <span className="relative">
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-[32px] items-center gap-1 rounded-full border border-dashed border-line2 px-2.5 text-[12.5px] font-medium text-text2 transition-colors hover:bg-surface2 hover:text-text"><Plus size={12} /> Add tag</button>
          {open && (
            <span role="menu" className="absolute left-0 z-30 mt-1 block max-h-60 w-48 overflow-auto rounded-[10px] border border-line bg-surface p-1 shadow-3">
              {left.map((o) => <button key={o} type="button" role="menuitem" onClick={() => { onChange([...cur, o]); setOpen(false); }} className="flex min-h-[38px] w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] hover:bg-surface2"><span className={cx('h-2.5 w-2.5 rounded-full', tagTone(o).split(' ')[0])} />{o}</button>)}
            </span>
          )}
        </span>
      )}
      {!disabled && !cur.length && !options.length && <span className="text-[12.5px] text-muted">No tags set up yet (Admin → Dropdowns → Tags).</span>}
    </div>
  );
}
