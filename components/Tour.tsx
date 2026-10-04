'use client';
import { useEffect, useLayoutEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { cx } from './ui';

// Five-step guided tour for new staff. Each step points at an element marked data-tour="…".
const STEPS: { target: string; title: string; body: string }[] = [
  { target: 'nav', title: 'Your pages', body: 'Everything your role works on is in this menu. You only see the pages you need.' },
  { target: 'home', title: 'Start every day here', body: 'The dashboard shows today’s numbers, your follow-ups and anything that needs attention.' },
  { target: 'jump', title: 'Find anything fast', body: 'Press Ctrl K (⌘K on a Mac) to jump to a person, a page or a task like “Record a payment”.' },
  { target: 'bell', title: 'Notifications', body: 'When a colleague @mentions you or gives you a follow-up, it shows up here.' },
  { target: 'account', title: 'You and your settings', body: 'Change your password, switch to dark mode, or sign out from here. You can restart this tour here too.' },
];

export function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  useEffect(() => { if (open) setI(0); }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${STEPS[i].target}"]`)).find((e) => e.getBoundingClientRect().width > 0);
      if (el) { el.scrollIntoView({ block: 'nearest' }); setBox(el.getBoundingClientRect()); } else setBox(null);
    };
    place(); window.addEventListener('resize', place); return () => window.removeEventListener('resize', place);
  }, [open, i]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(); if (e.key === 'ArrowRight') setI((x) => Math.min(STEPS.length - 1, x + 1)); if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1)); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });
  if (!open) return null;
  const finish = async () => { await supabase().rpc('tour_done'); onClose(); };
  const s = STEPS[i], last = i === STEPS.length - 1;
  // card goes beside the highlighted area, kept on screen
  const W = 320, vw = typeof window !== 'undefined' ? window.innerWidth : 1200, vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  let left = vw / 2 - W / 2, top = vh / 2 - 90;
  if (box) {
    if (box.right + 16 + W < vw && box.width < vw / 2) { left = box.right + 16; top = Math.min(Math.max(16, box.top), vh - 220); }
    else { left = Math.min(Math.max(16, box.right - W), vw - W - 16); top = box.bottom + 12 + 200 < vh ? box.bottom + 12 : Math.max(16, box.top - 212); }
  }
  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label={`Tour, step ${i + 1} of ${STEPS.length}: ${s.title}`}>
      {box ? <div className="pointer-events-none absolute rounded-xl ring-2 ring-accent transition-all duration-200 motion-reduce:transition-none"
        style={{ left: box.left - 6, top: box.top - 6, width: box.width + 12, height: Math.min(box.height + 12, vh - box.top), boxShadow: '0 0 0 9999px rgba(11,18,32,.55)' }} />
        : <div className="absolute inset-0 bg-[rgba(11,18,32,.55)]" />}
      <div className="anim-rise absolute w-[min(320px,calc(100vw-32px))] rounded-2xl border border-line bg-surface p-4 shadow-2xl" style={{ left, top }}>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-accentText">Step {i + 1} of {STEPS.length}</div>
        <h2 className="mt-1 text-[17px] font-semibold">{s.title}</h2>
        <p className="mt-1 text-[13.5px] leading-relaxed text-text2">{s.body}</p>
        <div className="mt-3 flex items-center gap-2">
          <div className="flex flex-1 gap-1" aria-hidden>{STEPS.map((_, j) => <span key={j} className={cx('h-1.5 w-4 rounded-full', j <= i ? 'bg-accent' : 'bg-line2')} />)}</div>
          {!last && <button type="button" onClick={finish} className="h-10 px-2 text-[13px] text-text2">Skip</button>}
          {i > 0 && <button type="button" onClick={() => setI(i - 1)} className="h-10 rounded-[10px] border border-line2 px-3 text-[13px] font-medium">Back</button>}
          <button type="button" autoFocus onClick={() => (last ? finish() : setI(i + 1))} className="h-10 rounded-[10px] bg-accent px-4 text-[13px] font-semibold text-white">{last ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
