'use client';
import { useMemo, useRef, useState } from 'react';
import { useSession } from '@/lib/session';
import { cx } from '../ui';
import { VoiceInput, appendText } from './VoiceInput';

type Person = { id: string; label: string; extra?: { role?: string } };

/**
 * Note box with @mentions. Typing @ opens a staff picker (Up/Down, Enter or Tab to pick, Esc to close).
 * A pick inserts @FirstName in the text and a chip above it; `mentions` holds the picked staff ids.
 * The database keeps only staff who can open this record and notifies them on save.
 */
export function MentionInput({ value, onChange, mentions, onMentionsChange, placeholder, label }: {
  value: string; onChange: (v: string) => void; mentions: string[]; onMentionsChange: (ids: string[]) => void; placeholder?: string; label: string;
}) {
  const s = useSession();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const all = s.refs.staff as Person[];
  const people = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return all.filter((p) => p.id !== s.staff.id && p.label.toLowerCase().split(' ').some((w) => w.startsWith(q))).slice(0, 6);
  }, [query, all, s.staff.id]);
  const chips = mentions.map((id) => all.find((p) => p.id === id)).filter(Boolean) as Person[];
  const first = (l: string) => l.split(' ')[0];

  const update = (v: string) => {
    onChange(v);
    // a chip goes when its @Name is deleted from the text
    const kept = mentions.filter((id) => { const p = all.find((x) => x.id === id); return p && v.includes('@' + first(p.label)); });
    if (kept.length !== mentions.length) onMentionsChange(kept);
    const caret = ref.current?.selectionStart ?? v.length;
    const m = /(?:^|\s)@([A-Za-z]*)$/.exec(v.slice(0, caret));
    setQuery(m ? m[1] : null); setActive(0);
  };
  const pick = (p: Person) => {
    const el = ref.current; if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/@([A-Za-z]*)$/, '@' + first(p.label) + ' ');
    onChange(before + value.slice(caret)); setQuery(null);
    if (!mentions.includes(p.id)) onMentionsChange([...mentions, p.id]);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(before.length, before.length); });
  };
  const remove = (p: Person) => {
    onMentionsChange(mentions.filter((id) => id !== p.id));
    onChange(value.split('@' + first(p.label) + ' ').join('').split('@' + first(p.label)).join(''));
  };

  return (
    <div className="relative">
      {chips.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5" aria-label="Will be notified">
          {chips.map((p) => (
            <span key={p.id} data-testid="mention-chip" className="inline-flex min-h-[32px] items-center gap-1 rounded-full bg-accentSoft pl-3 pr-1 text-[12.5px] font-medium text-accent">
              @{p.label}
              <button type="button" aria-label={'Remove ' + p.label} onClick={() => remove(p)}
                className="grid h-[28px] w-[28px] place-items-center rounded-full hover:bg-surface2">×</button>
            </span>
          ))}
        </div>
      )}
      <textarea ref={ref} aria-label={label} placeholder={placeholder} value={value} className={cx('w-full px-3 py-2 text-sm transition-[min-height] duration-150 ease-out focus:min-h-[84px] motion-reduce:transition-none', value ? 'min-h-[84px]' : 'min-h-[40px]')}
        role="combobox" aria-expanded={people.length > 0} aria-autocomplete="list"
        onChange={(e) => update(e.target.value)} onBlur={() => setTimeout(() => setQuery(null), 120)}
        onKeyDown={(e) => {
          if (!people.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % people.length); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + people.length) % people.length); }
          else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(people[active]); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setQuery(null); }
        }} />
      {people.length > 0 && (
        <div role="listbox" aria-label="Mention someone" className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          {people.map((p, i) => (
            <button key={p.id} type="button" role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              className={cx('flex min-h-[44px] w-full items-center justify-between px-3 text-left text-[13px]', i === active ? 'bg-accentSoft' : 'hover:bg-surface2')}>
              <span className="font-medium">@{first(p.label)} <span className="font-normal text-text2">{p.label}</span></span>
              <span className="text-[11.5px] text-muted">{p.extra?.role}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-1.5"><VoiceInput context="note" onText={(t) => onChange(appendText(value, t))} /></div>
      <p className="mt-1 text-[11px] text-muted">Type @ to notify a colleague. Only people who can open this record are told.</p>
    </div>
  );
}
