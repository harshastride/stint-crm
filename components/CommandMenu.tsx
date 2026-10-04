'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search, User, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { pageIcon } from '@/lib/icons';
import { cx } from './ui';

// Ctrl+K / ⌘K: jump to any page, any person, or start a common task. Only shows what the role can open.
type Item = { id: string; group: 'People' | 'Do' | 'Go to'; label: string; hint?: string; href: string; icon: React.ComponentType<{ size?: number; className?: string }> };

const ACTIONS: { label: string; page: string; href: string; hint: string }[] = [
  { label: 'New enquiry', page: 'enquiry', href: '/p/enquiry', hint: 'Front desk form' },
  { label: 'Add a follow-up', page: 'followups', href: '/p/followups?new=x:', hint: 'Task for you or your team' },
  { label: 'New fee quote', page: 'quote', href: '/p/quote?new=x:', hint: 'Price offer for a lead' },
  { label: 'Record a payment', page: 'payment', href: '/p/payment?new=x:', hint: 'Settles the oldest instalment' },
  { label: 'Book counselling', page: 'counsel', href: '/p/counsel?new=x:', hint: 'For a lead' },
  { label: 'Book a mock interview', page: 'mock', href: '/p/mock?new=x:', hint: 'For a candidate' },
  { label: 'Mark attendance', page: 'attendance', href: '/p/attendance', hint: 'Today’s batch' },
  { label: 'Record a placement', page: 'placement', href: '/p/placement?new=x:', hint: 'Offer accepted' },
  { label: 'Open the calendar', page: 'calendar', href: '/calendar', hint: 'This week' },
];

export function CommandMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSession();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<Item[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) { setQ(''); setActive(0); setPeople([]); setTimeout(() => input.current?.focus(), 10); } }, [open]);

  // people: leads by name or mobile, candidates by name or code (row security decides who comes back)
  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2) { setPeople([]); return; }
    const t = setTimeout(async () => {
      const db = supabase(), digits = term.replace(/\D/g, ''), safe = term.replace(/[%,()]/g, ' ');
      const [l, c] = await Promise.all([
        s.can('lead') ? db.rpc('search_people', { p_kind: 'lead', p_term: digits.length >= 3 ? digits : term, p_limit: 5 }) : Promise.resolve({ data: [] }),
        s.can('candidate') ? db.from('candidate').select('id, full_name, code, stage').or(`full_name.ilike.%${safe}%,code.ilike.%${safe}%`).limit(5) : Promise.resolve({ data: [] }),
      ]);
      setPeople([
        ...((l.data || []) as { id: string; full_name: string; mobile_masked: string; stage: string }[]).map((x) => ({ id: 'l' + x.id, group: 'People' as const, label: x.full_name, hint: `Lead · ${x.stage} · ${x.mobile_masked || ''}`, href: `/p/lead?person=lead:${x.id}`, icon: User })),
        ...((c.data || []) as { id: string; full_name: string; code: string; stage: string }[]).map((x) => ({ id: 'c' + x.id, group: 'People' as const, label: x.full_name, hint: `Candidate · ${x.stage} · ${x.code}`, href: `/p/candidate?person=candidate:${x.id}`, icon: UserRound })),
      ]);
    }, 160);
    return () => clearTimeout(t);
  }, [q, open, s]);

  const items = useMemo(() => {
    const term = q.trim().toLowerCase();
    const match = (t: string) => !term || t.toLowerCase().includes(term) || term.split(/\s+/).every((w) => t.toLowerCase().includes(w));
    const acts: Item[] = ACTIONS.filter((a) => s.can(a.page, a.page === 'calendar' ? 'r' : 'w') && match(a.label + ' ' + a.hint))
      .map((a) => ({ id: 'a' + a.label, group: 'Do', label: a.label, hint: a.hint, href: a.href, icon: pageIcon(a.page) }));
    const pages: Item[] = s.allPages.filter((p) => s.pages[p.id] && match(p.title + ' ' + p.grp))
      .map((p) => ({ id: 'p' + p.id, group: 'Go to', label: p.title, hint: p.grp, href: p.id === 'home' ? '/' : '/p/' + p.id, icon: pageIcon(p.id) }));
    return [...people, ...acts.slice(0, term ? 6 : 5), ...pages.slice(0, term ? 8 : 6)];
  }, [q, people, s]);

  useEffect(() => { setActive(0); }, [q, people.length]);
  useEffect(() => { list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const go = (it?: Item) => { if (!it) return; onClose(); router.push(it.href); };
  if (!open) return null;

  let lastGroup = '';
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Command menu" onMouseDown={(e) => e.stopPropagation()}
        className="anim-rise w-full max-w-[560px] overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={17} className="shrink-0 text-muted" aria-hidden />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-activedescendant={items[active]?.id}
            placeholder="Search people, pages, or what to do…" className="h-14 w-full border-0 bg-transparent px-0 text-[15px] outline-none focus:ring-0"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); go(items[active]); }
              else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            }} />
          <kbd className="hidden shrink-0 rounded-md border border-line2 px-1.5 py-0.5 text-[11px] text-muted sm:block">Esc</kbd>
        </div>
        <div ref={list} id="cmdk-list" role="listbox" className="max-h-[52vh] overflow-y-auto p-1.5">
          {items.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-text2">{q.trim().length >= 2 ? 'Nothing matches “' + q.trim() + '”.' : 'Type a name, a mobile, or a page.'}</p>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? (lastGroup = it.group) : null;
            const Icon = it.icon;
            return (
              <div key={it.id}>
                {header && <div className="px-2.5 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{header}</div>}
                <div id={it.id} role="option" aria-selected={i === active} data-active={i === active} onMouseEnter={() => setActive(i)} onClick={() => go(it)}
                  className={cx('flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[10px] px-2.5', i === active ? 'bg-accentSoft' : '')}>
                  <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', i === active ? 'bg-accent text-white' : 'bg-surface2 text-text2')}><Icon size={15} /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] font-medium">{it.label}</span>{it.hint && <span className="block truncate text-[11.5px] text-muted">{it.hint}</span>}</span>
                  {i === active && <CornerDownLeft size={14} className="shrink-0 text-muted" aria-hidden />}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-muted"><span>↑↓ move</span><span>↵ open</span><span>Esc close</span></div>
      </div>
    </div>
  );
}
