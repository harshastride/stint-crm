'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { cx } from '../ui';

// "Getting started" for new staff: a few real first actions, ticked off from what they have actually done.
type Item = { key: string; label: string; href?: string; show: boolean };
export function Checklist() {
  const s = useSession();
  const k = 'stint-checklist-hidden:' + s.staff.id;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(k) === '1'; } catch { return false; } });
  const [done, setDone] = useState<Record<string, boolean> | null>(null);
  useEffect(() => { if (!hidden) supabase().rpc('my_onboarding').then(({ data }: { data: Record<string, boolean> | null }) => setDone(data || {})); }, [hidden]);
  if (hidden || !done) return null;
  const items: Item[] = [
    { key: 'tour', label: 'Take the 1-minute tour (account menu → Show me around)', show: true },
    { key: 'call', label: 'Log your first call', href: '/p/call', show: s.can('call', 'w') },
    { key: 'note', label: 'Add a note on a lead or student', href: s.can('lead') ? '/p/lead' : '/p/candidate', show: s.can('lead') || s.can('candidate') },
    { key: 'followup', label: 'Set a follow-up for yourself', href: '/p/followups?new=x:', show: s.can('followups', 'w') },
    { key: 'view', label: 'Save a list view you use often', href: s.can('lead') ? '/p/lead' : '/p/followups', show: true },
  ].filter((i) => i.show);
  const n = items.filter((i) => done[i.key]).length;
  if (n === items.length) return null;
  const hide = () => { setHidden(true); try { localStorage.setItem(k, '1'); } catch {} };
  return (
    <section className="anim-rise rounded-2xl border border-[rgba(68,116,185,.4)] bg-[rgba(68,116,185,.06)] p-5" aria-label="Getting started">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-base font-semibold">Getting started</h2><p className="text-xs text-text2">{n} of {items.length} done · learn the CRM by doing</p></div>
        <button type="button" onClick={hide} aria-label="Hide getting started" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface"><X size={16} /></button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface"><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: (100 * n) / items.length + '%' }} /></div>
      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {items.map((i) => {
          const ok = !!done[i.key];
          const body = <><span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2', ok ? 'border-accent bg-accent text-white' : 'border-line2 bg-surface')}>{ok && <Check size={12} strokeWidth={3} />}</span>
            <span className={cx('text-[13.5px]', ok ? 'text-muted line-through' : 'font-medium')}>{i.label}</span></>;
          return <li key={i.key}>{i.href && !ok ? <Link href={i.href} className="flex min-h-[44px] items-center gap-2.5 rounded-lg bg-surface px-3 hover:ring-1 hover:ring-accent">{body}</Link> : <span className="flex min-h-[44px] items-center gap-2.5 rounded-lg bg-surface px-3">{body}</span>}</li>;
        })}
      </ul>
    </section>
  );
}
