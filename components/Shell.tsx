'use client';
import { BarChart3, Bell, Briefcase, CheckSquare, FileText, GraduationCap, Home, IndianRupee, Megaphone, MessageSquare, Phone, Search, Settings, UserPlus, Users, BookOpen } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useSession } from '@/lib/session';
import { PersonSearch } from './Fields';
import { cx, initials } from './ui';

const ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  Home, 'Front desk': UserPlus, Marketing: Megaphone, Telecalling: Phone, Sales: IndianRupee, Enrolment: Users, Training: BookOpen, Mocks: MessageSquare,
  'Resume & docs': FileText, Placement: Briefcase, Alumni: GraduationCap, Fees: IndianRupee, Ops: Bell, Reports: BarChart3, 'Admin settings': Settings,
};

export function Shell({ children }: { children: React.ReactNode }) {
  const s = useSession();
  const path = usePathname();
  const router = useRouter();
  const [theme, setTheme] = useState('light');
  const [searchKind, setSearchKind] = useState<'lead' | 'candidate'>('lead');

  useEffect(() => { const t = localStorage.getItem('stint-theme') || 'light'; setTheme(t); document.documentElement.dataset.theme = t; }, []);
  const toggleTheme = () => { const t = theme === 'light' ? 'dark' : 'light'; setTheme(t); document.documentElement.dataset.theme = t; localStorage.setItem('stint-theme', t); };

  const groups = useMemo(() => {
    const out: { name: string; pages: { id: string; title: string }[] }[] = [];
    s.allPages.filter((p) => s.pages[p.id]).forEach((p) => {
      let g = out.find((x) => x.name === p.grp);
      if (!g) out.push((g = { name: p.grp, pages: [] }));
      g.pages.push({ id: p.id, title: p.title });
    });
    return out;
  }, [s.allPages, s.pages]);

  const current = path === '/' ? 'home' : path.startsWith('/p/') ? path.split('/')[2] : path.startsWith('/candidate/') ? 'candidate' : '';
  const canSearch = { lead: s.can('lead'), candidate: s.can('candidate') };
  useEffect(() => { if (!canSearch.lead && canSearch.candidate) setSearchKind('candidate'); }, [canSearch.lead, canSearch.candidate]);

  return (
    <div className="flex h-screen">
      <nav aria-label="Pages" className="flex w-[232px] shrink-0 flex-col overflow-y-auto border-r border-line bg-surface p-2.5">
        <div className="flex items-center gap-2.5 px-2.5 py-3">
          <span className="inline-block h-4 w-4 rotate-45 rounded-[3px] bg-accent" aria-hidden />
          <span className="text-[15px] font-semibold">Stint CRM</span>
        </div>
        {groups.map((g) => {
          const Icon = ICONS[g.name] || CheckSquare;
          return (
            <div key={g.name} className="mt-2">
              <div className="px-2.5 py-1.5 text-xs font-medium text-muted">{g.name}</div>
              {g.pages.map((p) => {
                const on = current === p.id;
                return (
                  <Link key={p.id} href={p.id === 'home' ? '/' : '/p/' + p.id} aria-current={on ? 'page' : undefined}
                    className={cx('flex min-h-[36px] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px]', on ? 'bg-accentSoft font-semibold text-accentText' : 'text-text2 hover:bg-surface2')}>
                    <Icon size={15} /><span>{p.title}</span>
                  </Link>
                );
              })}
            </div>
          );
        })}
        <div className="mt-auto flex items-center gap-2.5 border-t border-line px-2.5 pt-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accentSoft text-xs font-semibold text-accentText">{initials(s.staff.full_name)}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{s.staff.full_name}</div>
            <div className="truncate text-[11px] text-muted">{s.staff.role}{s.staff.level === 'Head' ? ' · Head' : ''}</div>
          </div>
        </div>
        <button type="button" onClick={s.signOut} className="mx-2.5 mb-1 mt-2 min-h-[36px] rounded-lg border border-line2 bg-surface text-[13px] font-medium">Sign out</button>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-2.5">
          <div className="flex w-full max-w-[520px] items-center gap-2">
            {(canSearch.lead || canSearch.candidate) ? (
              <>
                <Search size={16} className="shrink-0 text-muted" />
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
          <button type="button" onClick={toggleTheme} className="min-h-[40px] shrink-0 rounded-[10px] border border-line2 bg-surface px-3 text-[13px] font-medium">{theme === 'light' ? 'Dark mode' : 'Light mode'}</button>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
