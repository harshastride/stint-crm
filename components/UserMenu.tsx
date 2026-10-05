'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, CircleHelp, Compass, Keyboard, ChevronDown, KeyRound, ListTodo, LoaderCircle, LogOut, Monitor, Moon, Sun, SunMoon } from 'lucide-react';
import type { Staff } from '@/lib/session';
import { cx, initials } from './ui';
import { openShortcuts } from './kit/Shortcuts';

export type ThemePref = 'light' | 'dark' | 'system';

/** Account menu at the top right: who you are, quick links, theme, and sign out. A bottom sheet on phones. */
export function UserMenu({ staff, theme, onTheme, onChangePassword, onSignOut, canCalendar, onTour }: {
  onTour?: () => void; staff: Staff; theme: ThemePref; onTheme: (t: ThemePref) => void; onChangePassword: () => void; onSignOut: () => Promise<void>; canCalendar: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away, true);
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);

  const close = (refocus = true) => { setOpen(false); if (refocus) trigger.current?.focus(); };
  const go = (href: string) => { close(false); router.push(href); };
  const signOut = async () => { setLeaving(true); await onSignOut(); };
  const onKey = (e: React.KeyboardEvent) => {
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"],[role="menuitemradio"][aria-checked="true"]') || []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(); }
  };
  const item = 'flex min-h-[42px] w-full items-center gap-3 rounded-[10px] px-2.5 text-left text-[13.5px] font-medium outline-none hover:bg-surface2 focus-visible:bg-surface2';
  const THEMES: [ThemePref, string, React.ReactNode][] = [['light', 'Light', <Sun key="l" size={15} />], ['dark', 'Dark', <Moon key="d" size={15} />], ['system', 'Same as device', <Monitor key="s" size={15} />]];

  return (
    <div ref={root} className="relative shrink-0">
      <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Account menu, ${staff.full_name}`}
        onClick={() => setOpen(!open)} onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }}
        className={cx('flex min-h-[44px] items-center gap-2 rounded-[12px] px-1.5 transition-colors md:pr-2.5', open ? 'bg-accentSoft' : 'hover:bg-surface2')}>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-[12px] font-semibold text-white">{initials(staff.full_name)}</span>
        <span className="hidden text-left leading-tight md:block">
          <span className="block max-w-[140px] truncate text-[13px] font-semibold">{staff.full_name}</span>
          <span className="block text-[11px] text-muted">{staff.role}{staff.level === 'Head' ? ' · Head' : ''}</span>
        </span>
        <ChevronDown size={15} className={cx('hidden text-muted transition-transform md:block', open && 'rotate-180')} aria-hidden />
      </button>

      {open && <div className="fixed inset-0 z-40 bg-black/30 sm:hidden" aria-hidden onClick={() => close()} />}
      {open && (
        <div ref={panel} role="menu" aria-label="Account" onKeyDown={onKey}
          className="anim-rise fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border border-line bg-surface p-2 pb-4 shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:mt-2 sm:w-[300px] sm:rounded-2xl sm:pb-2">
          <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-line2 sm:hidden" aria-hidden />
          <div className="flex items-center gap-3 px-2.5 pb-3 pt-1.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">{initials(staff.full_name)}</span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5"><span className="truncate font-semibold">{staff.full_name}</span><span className="shrink-0 rounded-md bg-accentSoft px-1.5 py-0.5 text-[10.5px] font-semibold text-accentText">{staff.role}{staff.level === 'Head' ? ' · Head' : ''}</span></span>
              <span className="block truncate text-[12.5px] text-muted" title={staff.email}>{staff.email}</span>
            </span>
          </div>
          <div className="my-1 h-px bg-line" role="separator" />
          <button type="button" role="menuitem" className={item} onClick={() => go('/p/followups')}><ListTodo size={16} className="text-muted" />My follow-ups</button>
          {canCalendar && <button type="button" role="menuitem" className={item} onClick={() => go('/calendar')}><CalendarDays size={16} className="text-muted" />Calendar</button>}
          <button type="button" role="menuitem" className={item} onClick={() => { close(false); onChangePassword(); }}><KeyRound size={16} className="text-muted" />Change password</button>
          {onTour && <button type="button" role="menuitem" className={item} onClick={() => { close(false); onTour(); }}><Compass size={16} className="text-muted" />Show me around</button>}
          <button type="button" role="menuitem" className={item} onClick={() => go('/help')}><CircleHelp size={16} className="text-muted" />Help</button>
          <button type="button" role="menuitem" className={item} onClick={() => { close(false); openShortcuts(); }}><Keyboard size={16} className="text-muted" />Keyboard shortcuts</button>
          <div className="my-1 h-px bg-line" role="separator" />
          <div className="flex min-h-[44px] items-center gap-3 px-2.5">
            <SunMoon size={16} className="text-muted" aria-hidden />
            <span className="flex-1 text-[13.5px] font-medium">Theme</span>
            <div role="group" aria-label="Theme" className="flex rounded-[10px] bg-surface2 p-0.5">
              {THEMES.map(([v, l, ic]) => (
                <button key={v} type="button" role="menuitemradio" aria-checked={theme === v} aria-label={l} title={l} onClick={() => onTheme(v)}
                  onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const i = THEMES.findIndex(([x]) => x === theme); const n = THEMES[(i + (e.key === 'ArrowRight' ? 1 : -1) + THEMES.length) % THEMES.length][0]; onTheme(n); } }}
                  className={cx('flex h-8 w-9 items-center justify-center rounded-lg', theme === v ? 'bg-surface text-text shadow-sm' : 'text-muted')}>{ic}</button>
              ))}
            </div>
          </div>
          <div className="my-1 h-px bg-line" role="separator" />
          <button type="button" role="menuitem" aria-busy={leaving || undefined} disabled={leaving} onClick={signOut} className={cx(item, 'text-badText hover:bg-badBg focus-visible:bg-badBg')}>
            {leaving ? <LoaderCircle size={16} className="animate-spin" /> : <LogOut size={16} />}{leaving ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}
