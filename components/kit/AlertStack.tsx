'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AtSign, Bell, Siren, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';

// Cards in the bottom-right corner for urgent things that arrive while the app is open:
// new notifications for me, and new High alerts given to me. Old ones never pop up.
type Card = { key: string; kind: 'mention' | 'note' | 'alert'; title: string; line: string; href: string | null };
const HIDE_MS = 12000;

const pollMs = () => (typeof window !== 'undefined' && (window as unknown as { __stintAlertPollMs?: number }).__stintAlertPollMs) || 30000;

/** source 'staff' (default) reads the staff session; 'student' uses the portal RPCs and needs no staff session. */
export function AlertStack({ source = 'staff', onOpen }: { source?: 'staff' | 'student'; onOpen?: (link: string) => void } = {}) {
  return source === 'student' ? <StudentAlerts onOpen={onOpen} /> : <StaffAlerts onOpen={onOpen} />;
}

function StudentAlerts({ onOpen }: { onOpen?: (link: string) => void }) {
  const [cards, setCards] = useState<Card[]>([]);
  const since = useRef(new Date().toISOString());
  const seen = useRef(new Set<string>());
  const check = useCallback(async () => {
    const { data } = await supabase().rpc('portal_notifications');
    const list = (Array.isArray(data) ? data : []) as Row[];
    const fresh: Card[] = list.filter((n) => !n.read_at && n.created_at > since.current && !seen.current.has('n' + n.id))
      .sort((x, y) => (x.created_at < y.created_at ? -1 : 1)).slice(-10)
      .map((n) => ({ key: 'n' + n.id, kind: 'note', title: n.title, line: n.body || '', href: n.link || null }));
    fresh.forEach((c) => seen.current.add(c.key));
    if (fresh.length) setCards((l) => [...l, ...fresh].slice(-3));
  }, []);
  useEffect(() => { const t = setInterval(check, pollMs()); return () => clearInterval(t); }, [check]);
  const drop = useCallback((key: string) => {
    setCards((l) => l.filter((c) => c.key !== key));
    supabase().rpc('portal_notifications_read', { p_ids: [key.slice(1)] }).then(() => {}, () => {});
  }, []);
  return <Stack cards={cards} drop={drop} clear={() => cards.forEach((c) => drop(c.key))} onOpen={onOpen} />;
}

function StaffAlerts({ onOpen }: { onOpen?: (link: string) => void }) {
  const s = useSession();
  const me = s.staff.id;
  const canAlert = s.can('alert');
  const [cards, setCards] = useState<Card[]>([]);
  const since = useRef(new Date().toISOString());
  const seen = useRef(new Set<string>());

  const check = useCallback(async () => {
    const db = supabase();
    const found: Card[] = [];
    const { data: ns } = await db.from('notification').select('id, kind, title, body, link, created_at')
      .eq('staff_id', me).is('read_at', null).gt('created_at', since.current).order('created_at').limit(10);
    (ns || []).forEach((n: Row) => found.push({ key: 'n' + n.id, kind: n.kind === 'mention' ? 'mention' : 'note', title: n.title, line: n.body || '', href: n.link || null }));
    if (canAlert) {
      const { data: as } = await db.from('alert').select('id, title, area, lead_id, candidate_id, raised_at')
        .eq('owner_id', me).eq('status', 'Open').eq('priority', 'High').gt('raised_at', since.current).order('raised_at').limit(10);
      (as || []).forEach((a: Row) => found.push({ key: 'a' + a.id, kind: 'alert', title: 'High alert: ' + a.title, line: a.area || 'Needs action now',
        href: a.candidate_id ? `/p/candidate?person=candidate:${a.candidate_id}` : a.lead_id ? `/p/lead?person=lead:${a.lead_id}` : '/p/alert' }));
    }
    const fresh = found.filter((c) => !seen.current.has(c.key));
    fresh.forEach((c) => seen.current.add(c.key));
    if (fresh.length) setCards((l) => [...l, ...fresh].slice(-3));
  }, [me, canAlert]);

  useEffect(() => {
    if (!me) return;
    const t = setInterval(check, pollMs());
    return () => clearInterval(t);
  }, [me, check]);

  const drop = useCallback((key: string) => setCards((l) => l.filter((c) => c.key !== key)), []);
  return <Stack cards={cards} drop={drop} clear={() => setCards([])} onOpen={onOpen} />;
}

function Stack({ cards, drop, clear, onOpen }: { cards: Card[]; drop: (key: string) => void; clear: () => void; onOpen?: (link: string) => void }) {
  return (
    <div aria-live="polite" aria-label="New alerts" className="pointer-events-none fixed inset-x-3 bottom-[84px] z-[65] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4">
      {cards.length >= 2 && (
        <button type="button" onClick={clear} className="pointer-events-auto min-h-[44px] rounded-lg border border-line bg-surface px-3 text-[12.5px] font-semibold text-text2 shadow-lg">Dismiss all</button>
      )}
      {cards.map((c) => <AlertCard key={c.key} c={c} onDone={() => drop(c.key)} onOpen={onOpen} />)}
    </div>
  );
}

function AlertCard({ c, onDone, onOpen }: { c: Card; onDone: () => void; onOpen?: (link: string) => void }) {
  const hover = useRef(false);
  const [left, setLeft] = useState(HIDE_MS);
  useEffect(() => {
    const t = setInterval(() => { if (!hover.current) setLeft((x) => x - 250); }, 250);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (left <= 0) onDone(); }, [left, onDone]);
  const Icon = c.kind === 'alert' ? Siren : c.kind === 'mention' ? AtSign : Bell;
  return (
    <div role="status" onMouseEnter={() => (hover.current = true)} onMouseLeave={() => (hover.current = false)}
      onFocus={() => (hover.current = true)} onBlur={() => (hover.current = false)}
      className="anim-rise motion-reduce:animate-none pointer-events-auto flex w-full max-w-[380px] items-start gap-3 rounded-xl border border-line bg-surface p-3 shadow-2xl sm:w-[360px]">
      <span className={'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ' + (c.kind === 'alert' ? 'bg-badBg text-badText' : 'bg-accentSoft text-accentText')}><Icon size={16} aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold leading-snug">{c.title}</p>
        {c.line && <p className="truncate text-[12.5px] text-text2">{c.line}</p>}
        {c.href && c.href.startsWith('portal:') ? (onOpen && <button type="button" onClick={() => { onOpen(c.href!); onDone(); }} className="mt-1 inline-flex min-h-[44px] items-center text-[13px] font-semibold text-accentText">Open</button>)
          : c.href && <Link href={c.href} onClick={onDone} className="mt-1 inline-flex min-h-[44px] items-center text-[13px] font-semibold text-accentText">Open</Link>}
      </div>
      <button type="button" aria-label={'Dismiss ' + c.title} onClick={onDone} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface2"><X size={15} /></button>
    </div>
  );
}
