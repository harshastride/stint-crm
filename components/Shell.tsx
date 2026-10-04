'use client';
import { ChevronDown, ChevronsLeft, ChevronsRight, Menu, Search, Star, User, UserRound, X } from 'lucide-react';
import { AnnouncementBar } from './kit/Announcement';
import { AlertStack } from './kit/AlertStack';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useSession } from '@/lib/session';
import { PersonSearch } from './Fields';
import { cx } from './ui';
import { pageIcon } from '@/lib/icons';
import { CommandMenu } from './CommandMenu';
import { NotificationBell } from './NotificationBell';
import { UserMenu, type ThemePref } from './UserMenu';
import { Tour } from './Tour';
import { Shortcuts } from './kit/Shortcuts';
import { ChangePassword } from './ChangePassword';
import { supabase } from '@/lib/supabase';
import { readRecent, type Recent } from '@/lib/recent';
import { IdleGuard } from './kit/IdleGuard';
import { Watermark } from './kit/Watermark';


export function Shell({ children }: { children: React.ReactNode }) {
  const s = useSession();
  const path = usePathname();
  const router = useRouter();
  const [theme, setTheme] = useState<ThemePref>('light');
  const [pwOpen, setPwOpenRaw] = useState(false);
  const [pwDone, setPwDone] = useState(false);
  const setPwOpen = (v: boolean) => { setPwOpenRaw(v); if (v) setPwDone(false); };
  const [searchKind, setSearchKind] = useState<'lead' | 'candidate'>('lead');
  const [navOpen, setNavOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  // sidebar preferences, remembered in this browser per person
  const pref = (k: string) => 'stint-nav-' + k + ':' + s.staff.id;
  const [collapsed, setCollapsedRaw] = useState(false);
  const [folded, setFolded] = useState<string[]>([]);
  const [favs, setFavs] = useState<string[]>([]);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      setCollapsedRaw(localStorage.getItem(pref('collapsed')) === '1');
      setFolded(JSON.parse(localStorage.getItem(pref('folded')) || '[]'));
      setFavs(JSON.parse(localStorage.getItem(pref('favs')) || '[]'));
    } catch {}
    const r = () => setRecent(readRecent(s.staff.id)); r();
    window.addEventListener('stint:recent', r); return () => window.removeEventListener('stint:recent', r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.staff.id]);
  const save = (k: string, v: unknown) => { try { localStorage.setItem(pref(k), typeof v === 'string' ? v : JSON.stringify(v)); } catch {} };
  const setCollapsed = (v: boolean) => { setCollapsedRaw(v); save('collapsed', v ? '1' : '0'); };
  const toggleFold = (g: string) => { const n = folded.includes(g) ? folded.filter((x) => x !== g) : [...folded, g]; setFolded(n); save('folded', n); };
  const toggleFav = (id: string) => { const n = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id].slice(-6); setFavs(n); save('favs', n); };
  useEffect(() => { if (!s.staff.tour_done_at) { const t = setTimeout(() => setTourOpen(true), 900); return () => clearTimeout(t); } }, [s.staff.tour_done_at]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdOpen((o) => !o); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); setCollapsedRaw((c) => { try { localStorage.setItem('stint-nav-collapsed:' + s.staff.id, c ? '0' : '1'); } catch {} return !c; }); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);

  // theme: light, dark, or the device's setting (followed live)
  useEffect(() => { try { setTheme(((localStorage.getItem('stint-theme') as ThemePref) || 'light')); } catch {} }, []);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme; };
    apply();
    if (theme !== 'system') return;
    mq.addEventListener('change', apply); return () => mq.removeEventListener('change', apply);
  }, [theme]);
  const chooseTheme = (t: ThemePref) => { setTheme(t); try { localStorage.setItem('stint-theme', t); } catch {} };

  const groups = useMemo(() => {
    const out: { name: string; pages: { id: string; title: string }[] }[] = [];
    s.allPages.filter((p) => s.pages[p.id]).forEach((p) => {
      let g = out.find((x) => x.name === p.grp);
      if (!g) out.push((g = { name: p.grp, pages: [] }));
      g.pages.push({ id: p.id, title: p.title });
    });
    return out;
  }, [s.allPages, s.pages]);

  useEffect(() => { setNavOpen(false); }, [path]);
  useEffect(() => {
    const load = () => supabase().rpc('sidebar_counts').then(({ data }) => data && setCounts(data));
    load(); const t = setInterval(load, 60000); return () => clearInterval(t);
  }, [path]);
  const badge = (id: string): { n: number; tone: 'bad' | 'soft' } | null => {
    const n = id === 'followups' ? counts.followups : counts[id];
    if (!n) return null;
    return { n, tone: (id === 'followups' && counts.followups_late) || ['alert', 'payment', 'deliveries'].includes(id) ? 'bad' : 'soft' };
  };
  const current = path === '/' ? 'home' : path === '/calendar' ? 'calendar' : path.startsWith('/p/') ? path.split('/')[2] : path.startsWith('/candidate/') ? 'candidate' : '';
  const canSearch = { lead: s.can('lead'), candidate: s.can('candidate') };
  useEffect(() => { if (!canSearch.lead && canSearch.candidate) setSearchKind('candidate'); }, [canSearch.lead, canSearch.candidate]);

  return (
    <div className="flex h-[100dvh]">
      {navOpen && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" aria-hidden onClick={() => setNavOpen(false)} />}
      <nav data-tour="nav" aria-label="Pages" className={cx('fixed inset-y-0 left-0 z-40 flex w-[264px] shrink-0 flex-col overflow-y-auto border-r border-line bg-surface p-2.5 transition-[transform,width] duration-200 md:static md:translate-x-0', collapsed ? 'md:w-[64px]' : 'md:w-[232px]',
        navOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full')}>
        <div className="flex items-center gap-2.5 px-2.5 py-3">
          <span className={cx('flex flex-1 items-end gap-1.5', collapsed && 'md:hidden')}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/stint-logo.svg" alt="Stint" width={92} height={30} className="logo-light h-[30px] w-auto" />
            <img src="/brand/stint-logo-dark.svg" alt="" width={92} height={30} className="logo-dark h-[30px] w-auto" />
            <span className="mb-[11px] rounded-md bg-accentSoft px-1.5 py-0.5 text-[10px] font-semibold text-accentText">CRM</span>
          </span>
          {collapsed && <img src="/brand/stint-icon.svg" alt="Stint" className="mx-auto hidden h-7 w-7 md:block" />}
          <button type="button" aria-label="Close menu" onClick={() => setNavOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-[10px] md:hidden"><X size={18} /></button>
        </div>
        {(() => {
          const pageById = new Map(groups.flatMap((g) => g.pages).map((p) => [p.id, p]));
          const item = (p: { id: string; title: string }, inFavs = false) => {
            const on = current === p.id, b = badge(p.id), Icon = pageIcon(p.id), fav = favs.includes(p.id);
            return (
              <div key={(inFavs ? 'f-' : '') + p.id} className="group relative">
                <Link data-tour={p.id === 'home' && !inFavs ? 'home' : undefined} href={p.id === 'home' ? '/' : p.id === 'calendar' ? '/calendar' : '/p/' + p.id} aria-current={on ? 'page' : undefined} title={collapsed ? p.title + (b ? ` (${b.n})` : '') : undefined}
                  className={cx('flex min-h-[36px] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px]', collapsed && 'md:justify-center md:px-0', on ? 'bg-accentSoft font-semibold text-accentText' : 'text-text2 hover:bg-surface2')}>
                  <span className="relative shrink-0"><Icon size={16} strokeWidth={1.8} aria-hidden />
                    {b && collapsed && <span className={cx('absolute -right-1.5 -top-1.5 hidden h-2.5 w-2.5 rounded-full border-2 border-surface md:block', b.tone === 'bad' ? 'bg-coral' : 'bg-accent')} />}</span>
                  <span className={cx('min-w-0 flex-1 truncate', collapsed && 'md:hidden')}>{p.title}</span>
                  {b && <span className={cx('num rounded-full px-1.5 text-[11px] font-bold', collapsed && 'md:hidden', b.tone === 'bad' ? 'bg-coral text-white' : 'bg-accentSoft text-accentText')} aria-label={b.n + ' waiting'}>{b.n > 99 ? '99+' : b.n}</span>}
                </Link>
                {!collapsed && (
                  <button type="button" onClick={() => toggleFav(p.id)} aria-label={(fav ? 'Remove from' : 'Add to') + ' favourites: ' + p.title} aria-pressed={fav}
                    className={cx('absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md hover:bg-surface', b && 'right-9', fav ? 'text-coral' : 'text-muted opacity-0 focus:opacity-100 group-hover:opacity-100')}>
                    <Star size={13} fill={fav ? 'currentColor' : 'none'} />
                  </button>
                )}
              </div>
            );
          };
          const favPages = favs.map((id) => pageById.get(id)).filter(Boolean) as { id: string; title: string }[];
          const head = (label: string, folding?: string) => collapsed ? <div className="mx-auto my-2 hidden h-px w-6 bg-line md:block" aria-hidden /> : folding ? (
            <button type="button" aria-expanded={!folded.includes(folding)} onClick={() => toggleFold(folding)} className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium text-muted hover:text-text2">
              {label}<ChevronDown size={13} className={cx('transition-transform', folded.includes(folding) && '-rotate-90')} />
            </button>
          ) : <div className="px-2.5 py-1.5 text-xs font-medium text-muted">{label}</div>;
          return (<>
            {favPages.length > 0 && <div className="mt-1">{head('Favourites')}{favPages.map((p) => item(p, true))}</div>}
            {recent.length > 0 && !collapsed && (
              <div className="mt-2">{head('Recently viewed', '__recent')}
                {!folded.includes('__recent') && recent.map((r) => (
                  <Link key={r.kind + r.id} href={`/p/${r.kind}?person=${r.kind}:${r.id}`} className="flex min-h-[34px] items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-text2 hover:bg-surface2">
                    {r.kind === 'lead' ? <User size={15} className="shrink-0" /> : <UserRound size={15} className="shrink-0" />}<span className="truncate">{r.name}</span>
                  </Link>
                ))}
              </div>
            )}
            {groups.map((g) => (
              <div key={g.name} className="mt-2">
                {head(g.name, g.name)}
                {(collapsed || !folded.includes(g.name)) && g.pages.map((p) => item(p))}
              </div>
            ))}
          </>);
        })()}
        <button type="button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand the menu (Ctrl+B)' : 'Collapse the menu (Ctrl+B)'} title={collapsed ? 'Expand (Ctrl+B)' : 'Collapse (Ctrl+B)'}
          className="mt-auto hidden min-h-[40px] items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-muted hover:bg-surface2 hover:text-text2 md:flex">
          {collapsed ? <ChevronsRight size={16} className="mx-auto" /> : <><ChevronsLeft size={16} /> Collapse menu <kbd className="ml-auto rounded bg-surface2 px-1.5 text-[10.5px]">Ctrl B</kbd></>}
        </button>
      </nav>
      <CommandMenu open={cmdOpen} onClose={() => setCmdOpen(false)} />
      <Shortcuts />
      <Tour open={tourOpen} onClose={() => { setTourOpen(false); s.reload(); }} />
      {/* outside the sidebar: the sidebar's slide-in transform would otherwise trap this fixed window inside it */}
        {pwOpen && (
          <div role="dialog" aria-label="Change password" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPwOpen(false)}>
            <div className="w-full max-w-[380px] rounded-2xl border border-line bg-surface p-6" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">Change password</h2>
                <button type="button" aria-label="Close" onClick={() => setPwOpen(false)} className="h-9 w-9 rounded-lg border border-line2">×</button></div>
              {pwDone ? <p className="text-text2">Password changed. Use it next time you sign in.</p> : <ChangePassword onDone={() => setPwDone(true)} />}
            </div>
          </div>
        )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-line bg-surface px-3 py-2.5 md:gap-3 md:px-5">
          <button type="button" aria-label="Open menu" onClick={() => setNavOpen(true)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-line2 md:hidden"><Menu size={18} /></button>
          <div className="flex min-w-0 w-full max-w-[520px] items-center gap-2">
            {(canSearch.lead || canSearch.candidate) ? (
              <>
                <Search size={16} className="hidden shrink-0 text-muted md:block" />
                <div className="flex-1">
                  <PersonSearch key={searchKind + path} kind={searchKind} value={null} label="Search people"
                    onChange={(id) => { if (id) router.push('/p/' + searchKind + '?person=' + searchKind + ':' + id); }} />
                </div>
                {canSearch.lead && canSearch.candidate && (
                  <select aria-label="Search in" className="h-[42px] px-2 text-[13px]" value={searchKind} onChange={(e) => setSearchKind(e.target.value as 'lead' | 'candidate')}>
                    <option value="lead">Leads</option><option value="candidate">Candidates</option>
                  </select>
                )}
              </>
            ) : <span />}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
          <button data-tour="jump" type="button" onClick={() => setCmdOpen(true)} aria-label="Open command menu (Ctrl+K)" className="flex min-h-[44px] shrink-0 items-center gap-2 rounded-[10px] border border-line2 bg-surface px-3 text-[13px] font-medium text-text2">
            <span className="max-md:hidden">Jump to…</span><kbd className="rounded-md bg-surface2 px-1.5 py-0.5 text-[11px] text-muted">{typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
          <span data-tour="bell"><NotificationBell /></span>
          <span data-tour="account"><UserMenu onTour={() => setTourOpen(true)} staff={s.staff} theme={theme} onTheme={chooseTheme} onChangePassword={() => setPwOpen(true)} onSignOut={s.signOut} canCalendar={s.can('calendar')} /></span>
          </div>
        </div>
        <AnnouncementBar />
        <AlertStack />
        <div className="relative flex min-h-0 min-w-0 flex-1">{children}{path.startsWith('/candidate/') && <Watermark name={s.staff.full_name} />}</div>
        <IdleGuard />
      </div>
    </div>
  );
}
