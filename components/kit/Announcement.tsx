'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Info, Megaphone, PartyPopper, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { cx } from '../ui';

// The latest notice from Admin, shown to every staff member until its date (each person can close it).
const TONE = {
  Info: { icon: Info, cls: 'bg-accentSoft text-accentText' },
  Important: { icon: Megaphone, cls: 'bg-[#FFE4D6] text-[#9A3412] dark:bg-[#3A2418] dark:text-[#FFB18F]' },
  'Good news': { icon: PartyPopper, cls: 'bg-goodBg text-goodText' },
} as const;
export function AnnouncementBar() {
  const s = useSession();
  const [a, setA] = useState<{ id: string; message: string; tone: keyof typeof TONE } | null>(null);
  const [closed, setClosed] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('stint-ann-closed') || '[]'); } catch { return []; } });
  useEffect(() => {
    const load = () => supabase().from('announcement').select('id, message, tone').gte('show_until', new Date().toISOString().slice(0, 10)).order('created_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }: { data: typeof a }) => setA(data));
    load(); const t = setInterval(load, 5 * 60000); return () => clearInterval(t);
  }, []);
  if (!a || closed.includes(a.id)) return null;
  const T = TONE[a.tone] || TONE.Info, I = T.icon;
  const close = () => { const n = [...closed, a.id].slice(-20); setClosed(n); try { localStorage.setItem('stint-ann-closed', JSON.stringify(n)); } catch {} };
  return (
    <div role="status" aria-label="Announcement" className={cx('flex items-center gap-2.5 border-b border-line px-4 py-2 text-[13.5px] font-medium', T.cls)}>
      <I size={16} className="shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{a.message}</span>
      {s.can('announcement', 'w') && <Link href="/p/announcement" className="shrink-0 text-[12.5px] underline">Manage</Link>}
      <button type="button" aria-label="Close announcement" onClick={close} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-black/5"><X size={15} /></button>
    </div>
  );
}
