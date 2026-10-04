'use client';
import { useMemo, useRef, useState } from 'react';
import { useSession } from '@/lib/session';
import { cx } from './ui';

/** A textarea where typing @ suggests staff names; picking one inserts @FirstName (which notifies them). */
export function MentionText({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder?: string; label: string }) {
  const s = useSession();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const people = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return s.refs.staff.filter((p) => p.id !== s.staff.id && p.label.toLowerCase().split(' ').some((w) => w.startsWith(q))).slice(0, 6);
  }, [query, s]);
  const update = (v: string) => {
    onChange(v);
    const caret = ref.current?.selectionStart ?? v.length;
    const m = /(?:^|\s)@([A-Za-z]*)$/.exec(v.slice(0, caret));
    setQuery(m ? m[1] : null); setActive(0);
  };
  const pick = (label: string) => {
    const el = ref.current; if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/@([A-Za-z]*)$/, '@' + label.split(' ')[0] + ' ');
    const next = before + value.slice(caret);
    onChange(next); setQuery(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(before.length, before.length); });
  };
  return (
    <div className="relative">
      <textarea ref={ref} aria-label={label} placeholder={placeholder} value={value} className="min-h-[84px] w-full px-3 py-2 text-sm"
        onChange={(e) => update(e.target.value)} onBlur={() => setTimeout(() => setQuery(null), 120)}
        onKeyDown={(e) => {
          if (!people.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % people.length); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + people.length) % people.length); }
          else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(people[active].label); }
          else if (e.key === 'Escape') setQuery(null);
        }} />
      {people.length > 0 && (
        <div role="listbox" aria-label="Mention someone" className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          {people.map((p, i) => (
            <button key={p.id} type="button" role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); pick(p.label); }}
              className={cx('flex min-h-[40px] w-full items-center justify-between px-3 text-left text-[13px]', i === active ? 'bg-accentSoft' : 'hover:bg-surface2')}>
              <span className="font-medium">@{p.label.split(' ')[0]} <span className="font-normal text-text2">{p.label}</span></span>
              <span className="text-[11.5px] text-muted">{(p as { extra?: { role?: string } }).extra?.role}</span>
            </button>
          ))}
        </div>
      )}
      <p className="mt-1 text-[11.5px] text-muted">Type @ and a name to notify a colleague.</p>
    </div>
  );
}
