'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { AtSign, Bell, Check, FileText, ListTodo, Mail, MessagesSquare, Undo2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { plainMessage } from '@/lib/plainMessage';
import { cx } from '../ui';
import { EmptyState } from './EmptyState';

/*
  Bell in the top bar, with a notification center behind it.
  - Seen (read_at) is separate from dealt with (done_at). Done items leave the list; the Done tab shows them.
  - Tabs: All (not done) · Unread · Mentions · Done. Grouped by day in India time.
  - Clicking an item marks it seen and opens its record.
  - All changes go through notification_mark() in the database (own rows only).
  - Checks every `pollMs` (30 s by default), when the panel opens, and when the tab comes back into view.
*/

export type NotificationTab = 'all' | 'unread' | 'mentions' | 'done';
export type NotificationItem = { id: string; kind: string; title: string; body: string | null; link: string | null; read_at: string | null; done_at: string | null; created_at: string };
type Props = {
  /** How often to check for new notifications, in ms. */
  pollMs?: number;
  /** How many items to load per tab (newest first). */
  limit?: number;
  /** Open a record. Defaults to the Next.js router. */
  onNavigate?: (link: string) => void;
};

const TZ = 'Asia/Kolkata';
const COLS = 'id, kind, title, body, link, read_at, done_at, created_at';
const TABS: { id: NotificationTab; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'unread', label: 'Unread' }, { id: 'mentions', label: 'Mentions' }, { id: 'done', label: 'Done' },
];
const KIND: Record<string, { label: string; Icon: typeof Bell }> = {
  mention: { label: 'Mention', Icon: AtSign },
  follow_up: { label: 'Follow-up', Icon: ListTodo },
  thread: { label: 'Reply', Icon: MessagesSquare },
  message: { label: 'Message', Icon: Mail },
  brochure: { label: 'Brochure', Icon: FileText },
};
const kindOf = (k: string) => KIND[k] || { label: 'Update', Icon: Bell };

const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD in India time
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const k = dayKey(d);
  if (k === dayKey(new Date())) return 'Today';
  if (k === dayKey(new Date(Date.now() - 86400000))) return 'Yesterday';
  const sameYear = k.slice(0, 4) === dayKey(new Date()).slice(0, 4);
  return d.toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
};
const timeLabel = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  return new Date(iso).toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
};
const groupByDay = (items: NotificationItem[]) => {
  const out: { label: string; items: NotificationItem[] }[] = [];
  for (const n of items) {
    const label = dayLabel(n.created_at);
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(n); else out.push({ label, items: [n] });
  }
  return out;
};

const EMPTY: Record<NotificationTab, { kind: 'done' | 'empty'; title: string; body: string }> = {
  all: { kind: 'done', title: 'All caught up', body: 'Nothing waiting for you. Mentions, follow-ups given to you and replies show here.' },
  unread: { kind: 'done', title: 'All caught up', body: 'You have seen everything. Items stay in All until you press Done.' },
  mentions: { kind: 'done', title: 'No mentions waiting', body: 'When someone @mentions you in a note or a discussion, it shows here.' },
  done: { kind: 'empty', title: 'Nothing marked done yet', body: 'Press Done on a notification once you have dealt with it. It moves here.' },
};

export function NotificationCenter({ pollMs = 30000, limit = 50, onNavigate }: Props = {}) {
  const router = useRouter();
  const go = useCallback((link: string) => (onNavigate ? onNavigate(link) : router.push(link)), [onNavigate, router]);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<NotificationTab>('all');
  const [items, setItems] = useState<NotificationItem[] | null>(null); // null = not loaded yet
  const [counts, setCounts] = useState<{ unread: number; mentions: number; capped: boolean }>({ unread: 0, mentions: 0, capped: false });
  const [error, setError] = useState('');
  const [undo, setUndo] = useState<NotificationItem | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const bellBtn = useRef<HTMLButtonElement>(null);
  const busy = useRef(new Set<string>());
  const seq = useRef(0);
  const panelId = useId();

  // Unread, not done: the badge and the tab counts. One small query.
  const loadCounts = useCallback(async () => {
    const { data, error: e } = await supabase().from('notification').select('id, kind').is('read_at', null).is('done_at', null).limit(100);
    if (e) return; // keep the last good numbers; the list shows any error
    const rows = (data || []) as { kind: string }[];
    setCounts({ unread: rows.length, mentions: rows.filter((r) => r.kind === 'mention').length, capped: rows.length >= 100 });
  }, []);

  const loadList = useCallback(async (which: NotificationTab) => {
    const mine = ++seq.current; // only the latest request may fill the list
    let q = supabase().from('notification').select(COLS).order('created_at', { ascending: false }).limit(limit);
    if (which === 'done') q = q.not('done_at', 'is', null);
    else {
      q = q.is('done_at', null);
      if (which === 'unread') q = q.is('read_at', null);
      if (which === 'mentions') q = q.eq('kind', 'mention');
    }
    const { data, error: e } = await q;
    if (mine !== seq.current) return;
    if (e) { console.error('notifications', e); setError(plainMessage(e.message, 'Couldn’t load notifications. Please try again.')); return; }
    setError('');
    setItems((data || []) as NotificationItem[]);
  }, [limit]);

  const refresh = useCallback(() => { loadCounts(); if (open) loadList(tab); }, [loadCounts, loadList, open, tab]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, pollMs);
    const vis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [refresh, pollMs]);

  // Close on outside click or Escape; Escape returns focus to the bell.
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); bellBtn.current?.focus(); } };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);

  useEffect(() => { if (!undo) return; const t = setTimeout(() => setUndo(null), 8000); return () => clearTimeout(t); }, [undo]);

  const mark = async (ids: string[] | null, read: boolean | null, done: boolean | null) => {
    const { error: e } = await supabase().rpc('notification_mark', { p_ids: ids, p_read: read, p_done: done });
    if (e) { console.error('notification_mark', e); setError(plainMessage(e.message, 'Couldn’t change that notification. Please try again.')); }
    return !e;
  };

  const chooseTab = (t: NotificationTab) => { if (t === tab) return; setTab(t); setItems(null); setError(''); }; // the effect below loads it

  const openOne = async (n: NotificationItem) => {
    if (!n.read_at) {
      setItems((l) => l && l.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      await mark([n.id], true, null);
      loadCounts();
    }
    if (n.link) { setOpen(false); go(n.link); }
  };

  const setDone = async (n: NotificationItem, done: boolean) => {
    if (busy.current.has(n.id)) return; // no double taps
    busy.current.add(n.id);
    const before = items;
    setItems((l) => l && l.filter((x) => x.id !== n.id)); // leaves this tab either way
    const ok = await mark([n.id], null, done);
    busy.current.delete(n.id);
    if (!ok) { setItems(before); return; }
    setUndo(done ? n : null);
    loadCounts();
  };

  const undoDone = async () => {
    const n = undo; if (!n) return;
    setUndo(null);
    if (await mark([n.id], null, false)) { loadList(tab); loadCounts(); }
  };

  const readAll = async () => {
    const now = new Date().toISOString();
    setItems((l) => (l && tab === 'unread' ? [] : l && l.map((x) => (x.read_at ? x : { ...x, read_at: now }))));
    setCounts((c) => ({ ...c, unread: 0, mentions: 0, capped: false }));
    await mark(null, true, null);
    refresh();
  };

  const toggle = () => {
    if (open) { setOpen(false); return; }
    setOpen(true); setItems(null); setError(''); // the effect below loads the list
  };

  const badge = counts.capped || counts.unread > 99 ? '99+' : counts.unread > 9 ? '9+' : String(counts.unread);

  return (
    <div ref={box} className="relative shrink-0">
      <button ref={bellBtn} type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined}
        aria-label={counts.unread ? `Notifications, ${counts.capped ? 'more than 99' : counts.unread} unread` : 'Notifications'} onClick={toggle}
        className="relative flex h-11 w-11 items-center justify-center rounded-[10px] text-text2 transition-colors hover:bg-surface2 hover:text-text active:scale-[0.96]">
        <Bell size={17} aria-hidden />
        {counts.unread > 0 && <span aria-hidden className="num absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-coral px-1 text-[10.5px] font-bold text-white ring-2 ring-surface">{badge}</span>}
      </button>

      {open && (
        <NotificationPanel id={panelId} tab={tab} onTab={chooseTab} items={items} counts={counts} error={error} limit={limit}
          onRetry={() => { setError(''); loadList(tab); }} onReadAll={readAll} onOpen={openOne} onDone={(n) => setDone(n, tab !== 'done')}
          undo={!!undo} onUndo={undoDone} />
      )}
    </div>
  );
}

export type NotificationCounts = { unread: number; mentions: number; capped: boolean };
type PanelProps = {
  id?: string; tab: NotificationTab; onTab: (t: NotificationTab) => void; items: NotificationItem[] | null; counts: NotificationCounts;
  error: string; limit: number; undo: boolean; onRetry: () => void; onReadAll: () => void; onUndo: () => void;
  onOpen: (n: NotificationItem) => void; onDone: (n: NotificationItem) => void;
};

/** The panel itself, without data loading (NotificationCenter wires it up). */
export function NotificationPanel({ id, tab, onTab, items, counts, error, limit, undo, onRetry, onReadAll, onUndo, onOpen, onDone }: PanelProps) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabCount = (t: NotificationTab) => (t === 'unread' ? counts.unread : t === 'mentions' ? counts.mentions : 0);
  const empty = EMPTY[tab];
  const onTabKey = (e: KeyboardEvent, i: number) => {
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null;
    if (n == null) return;
    e.preventDefault();
    const j = (n + TABS.length) % TABS.length;
    onTab(TABS[j].id); tabRefs.current[j]?.focus();
  };
  return (
    <div id={id} role="dialog" aria-label="Notifications"
      className="anim-rise z-50 flex max-h-[min(640px,calc(100dvh-80px))] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl max-sm:fixed max-sm:inset-x-3 max-sm:top-[64px] sm:absolute sm:right-0 sm:mt-2 sm:w-[400px]">
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-1 pt-3">
        <h2 className="text-[15px] font-semibold">Notifications</h2>
        {counts.unread > 0 && tab !== 'done' && (
          <button type="button" onClick={onReadAll} className="inline-flex h-11 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-accentText hover:bg-surface2 md:h-9">
            <Check size={14} aria-hidden />Mark all read
          </button>
        )}
      </div>

      <div role="tablist" aria-label="Show" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3">
        {TABS.map((t, i) => {
          const sel = tab === t.id; const c = tabCount(t.id);
          return (
            <button key={t.id} ref={(el) => { tabRefs.current[i] = el; }} type="button" role="tab" aria-selected={sel} tabIndex={sel ? 0 : -1}
              onClick={() => onTab(t.id)} onKeyDown={(e) => onTabKey(e, i)}
              className={cx('-mb-px inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 border-b-2 px-2.5 text-[13px] md:h-10',
                sel ? 'border-accent font-semibold text-text' : 'border-transparent font-medium text-text2 hover:text-text')}>
              {t.label}
              {c > 0 && <span className={cx('num rounded-full px-1.5 text-[11px] font-semibold leading-[18px]', sel ? 'bg-accentSoft text-accentText' : 'bg-surface2 text-text2')}>
                <span className="sr-only">(</span>{t.id === 'unread' && counts.capped ? '99+' : c}<span className="sr-only"> unread)</span>
              </span>}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {error && (
          <div role="alert" className="m-3 flex items-center justify-between gap-2 rounded-lg bg-badBg px-3 py-2 text-[13px] text-badText">
            <span>{error}</span>
            <button type="button" onClick={onRetry} className="h-11 shrink-0 rounded-lg px-2 font-semibold text-badText underline-offset-2 hover:underline md:h-9">Try again</button>
          </div>
        )}
        {items === null && !error && (
          <ul aria-label="Loading" className="space-y-3 p-4">
            {[0, 1, 2].map((i) => <li key={i} className="flex gap-3"><span className="h-8 w-8 rounded-lg bg-surface2" /><span className="flex-1 space-y-2"><span className="block h-3 w-3/4 rounded bg-surface2" /><span className="block h-3 w-1/2 rounded bg-surface2" /></span></li>)}
          </ul>
        )}
        {items && items.length === 0 && !error && (
          <div className="p-3"><EmptyState kind={empty.kind} title={empty.title} body={empty.body} /></div>
        )}
        {items && items.length > 0 && groupByDay(items).map((g) => (
          <section key={g.label} aria-label={g.label}>
            <h3 className="sticky top-0 z-[1] bg-surface px-4 pb-1 pt-3 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{g.label}</h3>
            <ul>
              {g.items.map((n) => <Row key={n.id} n={n} doneTab={tab === 'done'} onOpen={() => onOpen(n)} onDone={() => onDone(n)} />)}
            </ul>
          </section>
        ))}
        {items && items.length >= limit && <p className="px-4 py-3 text-center text-[12px] text-muted">Showing the newest {limit}.</p>}
      </div>

      <div aria-live="polite" className="shrink-0 empty:hidden">
        {undo && (
          <div className="flex items-center justify-between gap-2 border-t border-line bg-surface2 px-4 py-1 text-[13px]">
            <span className="min-w-0 truncate text-text2">Marked done. It is in the Done tab.</span>
            <button type="button" onClick={onUndo} className="inline-flex h-11 shrink-0 items-center gap-1 rounded-lg px-2 font-semibold text-accentText hover:bg-surface md:h-9"><Undo2 size={14} aria-hidden />Undo</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ n, doneTab, onOpen, onDone }: { n: NotificationItem; doneTab: boolean; onOpen: () => void; onDone: () => void }) {
  const { label, Icon } = kindOf(n.kind);
  const unread = !n.read_at && !doneTab;
  return (
    <li className={cx('group flex items-start gap-1 border-b border-line pr-2 last:border-0')}>
      <button type="button" onClick={onOpen} className="flex min-h-[44px] min-w-0 flex-1 gap-3 py-3 pl-4 text-left hover:bg-surface2/60 focus-visible:bg-surface2/60">
        <span className={cx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', n.kind === 'mention' ? 'bg-accentSoft text-accentText' : 'bg-surface2 text-text2')}>
          <Icon size={15} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cx('block break-words text-[13px] leading-snug', unread ? 'font-semibold text-text' : 'font-normal text-text2')}>{n.title}</span>
          {n.body && <span className="mt-0.5 line-clamp-2 block break-words text-[12.5px] text-text2">{n.body}</span>}
          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-muted">
            {unread && <span className="font-semibold text-coral">New</span>}
            {unread && <span aria-hidden>·</span>}
            <span>{label}</span><span aria-hidden>·</span>
            <time dateTime={n.created_at}>{timeLabel(n.created_at)}</time>
            {!n.link && <><span aria-hidden>·</span><span>No record to open</span></>}
          </span>
        </span>
      </button>
      <button type="button" onClick={onDone} aria-label={(doneTab ? 'Move back to the list: ' : 'Done: ') + n.title}
        title={doneTab ? 'Move back to the list' : 'Done — dealt with'}
        className="mt-2 inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-[12.5px] font-medium text-text2 hover:bg-surface2 hover:text-text md:h-9">
        {doneTab ? <Undo2 size={15} aria-hidden /> : <Check size={15} aria-hidden />}
        <span>{doneTab ? 'Move back' : 'Done'}</span>
      </button>
    </li>
  );
}
