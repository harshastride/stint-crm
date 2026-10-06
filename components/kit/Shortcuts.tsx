'use client';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../ui';

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Opens the shortcuts sheet from anywhere (e.g. the account menu). */
export const openShortcuts = () => window.dispatchEvent(new Event('stint:shortcuts'));

/** "?" opens a sheet listing every keyboard shortcut. Esc closes it. */
export function Shortcuts() {
  const [open, setOpen] = useState(false);
  const [mac, setMac] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMac(isMac());
    const show = () => { back.current = document.activeElement as HTMLElement; setOpen(true); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
      e.preventDefault(); show();
    };
    window.addEventListener('keydown', onKey); window.addEventListener('stint:shortcuts', show);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('stint:shortcuts', show); };
  }, []);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => box.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'Tab') {
        const f = Array.from(box.current?.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])') || []);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!box.current?.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true); return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  const close = () => { setOpen(false); back.current?.focus?.(); };
  if (!open) return null;
  const mod = mac ? '⌘' : 'Ctrl';
  const groups: [string, [string[], string][]][] = [
    ['Anywhere', [[[mod, 'K'], 'Open the command menu (search pages and people)'], [[mod, 'B'], 'Fold or unfold the side menu'], [['?'], 'Show this list'], [['Esc'], 'Close a panel, menu or window']]],
    ['Person panel (when open)', [[['J'], 'Next person in the list'], [['K'], 'Previous person in the list'], [['↓'], 'Next person'], [['↑'], 'Previous person']]],
    ['Menus and lists', [[['↑', '↓'], 'Move between choices'], [['Enter'], 'Pick the highlighted choice']]],
  ];
  const kbd = 'inline-flex min-w-[26px] items-center justify-center rounded-chip bg-surface2 px-1.5 py-0.5 font-sans text-[12px] font-semibold';
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center" onClick={close}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="sc-title" tabIndex={-1} onClick={(e) => e.stopPropagation()}
        className="anim-rise max-h-[85vh] w-full overflow-auto rounded-t-card bg-surface p-5 shadow-3 sm:w-[460px] sm:rounded-card outline-none">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="sc-title" className="text-[16px] font-semibold">Keyboard shortcuts</h2>
          <IconButton aria-label="Close" onClick={close} icon={<X size={18} />} />
        </div>
        {groups.map(([g, rows]) => (
          <section key={g} className="mt-4">
            <h3 className="mb-1 text-[12px] font-medium text-muted">{g}</h3>
            <ul>{rows.map(([keys, what]) => (
              <li key={what} className="flex min-h-[40px] items-center justify-between gap-3 py-1.5 text-[13.5px] text-text">
                <span>{what}</span>
                <span className="flex shrink-0 gap-1">{keys.map((k) => <kbd key={k} className={kbd}>{k}</kbd>)}</span>
              </li>))}</ul>
          </section>
        ))}
        <p className="mt-4 text-[12.5px] text-muted">Shortcuts do not work while you are typing in a box.</p>
      </div>
    </div>
  );
}
