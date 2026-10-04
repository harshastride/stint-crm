'use client';
import { Menu, X, Search } from 'lucide-react';
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
import { ChangePassword } from './ChangePassword';


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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdOpen((o) => !o); } };
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
  const current = path === '/' ? 'home' : path.startsWith('/p/') ? path.split('/')[2] : path.startsWith('/candidate/') ? 'candidate' : '';
  const canSearch = { lead: s.can('lead'), candidate: s.can('candidate') };
  useEffect(() => { if (!canSearch.lead && canSearch.candidate) setSearchKind('candidate'); }, [canSearch.lead, canSearch.candidate]);

  return (
    <div className="flex h-[100dvh]">
      {navOpen && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" aria-hidden onClick={() => setNavOpen(false)} />}
      <nav aria-label="Pages" className={cx('fixed inset-y-0 left-0 z-40 flex w-[264px] shrink-0 flex-col overflow-y-auto border-r border-line bg-surface p-2.5 transition-transform duration-200 md:static md:w-[232px] md:translate-x-0',
        navOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full')}>
        <div className="flex items-center gap-2.5 px-2.5 py-3">
          <span className="flex flex-1 items-end gap-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/stint-logo.svg" alt="Stint" width={92} height={30} className="logo-light h-[30px] w-auto" />
            <img src="/brand/stint-logo-dark.svg" alt="" width={92} height={30} className="logo-dark h-[30px] w-auto" />
            <span className="mb-[11px] rounded-md bg-accentSoft px-1.5 py-0.5 text-[10px] font-semibold text-accentText">CRM</span>
          </span>
          <button type="button" aria-label="Close menu" onClick={() => setNavOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-[10px] md:hidden"><X size={18} /></button>
        </div>
        {groups.map((g) => {
          return (
            <div key={g.name} className="mt-2">
              <div className="px-2.5 py-1.5 text-xs font-medium text-muted">{g.name}</div>
              {g.pages.map((p) => {
                const on = current === p.id;
                return (
                  <Link key={p.id} href={p.id === 'home' ? '/' : '/p/' + p.id} aria-current={on ? 'page' : undefined}
                    className={cx('flex min-h-[36px] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px]', on ? 'bg-accentSoft font-semibold text-accentText' : 'text-text2 hover:bg-surface2')}>
                    {(() => { const Icon = pageIcon(p.id); return <Icon size={16} strokeWidth={1.8} className="shrink-0" aria-hidden />; })()}<span>{p.title}</span>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
      <CommandMenu open={cmdOpen} onClose={() => setCmdOpen(false)} />
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
          <button type="button" onClick={() => setCmdOpen(true)} aria-label="Open command menu (Ctrl+K)" className="flex min-h-[44px] shrink-0 items-center gap-2 rounded-[10px] border border-line2 bg-surface px-3 text-[13px] font-medium text-text2">
            <span className="max-md:hidden">Jump to…</span><kbd className="rounded-md bg-surface2 px-1.5 py-0.5 text-[11px] text-muted">{typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
          <NotificationBell />
          <UserMenu staff={s.staff} theme={theme} onTheme={chooseTheme} onChangePassword={() => setPwOpen(true)} onSignOut={s.signOut} canCalendar={s.can('calendar')} />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
