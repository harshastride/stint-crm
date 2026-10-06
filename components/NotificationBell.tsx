'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AtSign, Bell, ListTodo } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Row } from '@/lib/pages';
import { cx } from './ui';

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

/** Bell in the top bar: @mentions and follow-ups others gave you. Checks every 30 seconds. */
export function NotificationBell() {
  const router = useRouter();
  const [items, setItems] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    const { data } = await supabase().from('notification').select('*, from:from_id(full_name)').order('created_at', { ascending: false }).limit(30);
    setItems(data || []);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const unread = items.filter((n) => !n.read_at).length;
  const readAll = async () => { await supabase().from('notification').update({ read_at: new Date().toISOString() }).is('read_at', null); load(); };
  const openOne = async (n: Row) => {
    if (!n.read_at) await supabase().from('notification').update({ read_at: new Date().toISOString() }).eq('id', n.id);
    setOpen(false); load(); if (n.link) router.push(n.link);
  };

  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={open} onClick={() => { setOpen(!open); if (!open) load(); }}
        className="relative flex h-11 w-11 items-center justify-center rounded-[10px] text-text2 transition-colors hover:bg-surface2 hover:text-text active:scale-[0.96]">
        <Bell size={17} />
        {unread > 0 && <span className="num absolute right-1 top-1 flex h-[18px] min-w-[18px] ring-2 ring-surface items-center justify-center rounded-full bg-coral px-1 text-[10.5px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="anim-rise absolute right-0 z-50 mt-2 w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="font-semibold">Notifications</span>
            {unread > 0 && <button type="button" onClick={readAll} className="text-[12.5px] font-medium text-accentText">Mark all read</button>}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-text2">Nothing yet. When someone @mentions you or gives you a follow-up, it shows here.</p>}
            {items.map((n) => (
              <button key={n.id} type="button" onClick={() => openOne(n)} className={cx('flex w-full gap-3 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-surface2', !n.read_at && 'bg-accentSoft/60')}>
                <span className={cx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', n.kind === 'mention' ? 'bg-accentSoft text-accentText' : 'bg-surface2 text-text2')}>
                  {n.kind === 'mention' ? <AtSign size={15} /> : <ListTodo size={15} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cx('block text-[13px] leading-snug', n.read_at ? 'font-normal text-text2' : 'font-semibold text-text')}>{n.title}</span>
                  {n.body && <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-text2">{n.body}</span>}
                  <span className="mt-1 block text-[11px] text-muted">{!n.read_at && <span className="font-semibold text-coral">New · </span>}{ago(n.created_at)}</span>
                </span>
                {!n.read_at && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-coral" aria-label="Unread" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
