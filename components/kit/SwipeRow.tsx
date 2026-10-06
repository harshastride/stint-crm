'use client';
// Swipe a card sideways on a phone: right = the main action, left = shows more actions.
// Swipe is only a shortcut. Every action is also in the card's visible "⋯" menu.
import { MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '../ui';

export type SwipeAction = { key: string; label: string; icon?: ReactNode; tone?: 'accent' | 'good' | 'warn'; run: () => void };

const TONE = { accent: 'bg-accent text-white', good: 'bg-goodText text-white', warn: 'bg-coral text-white' } as const;
const SLOP = 8;          // px before we decide the finger's direction
const ARM = 88;          // px to the right that fires the main action
const BTN = 76;          // width of each revealed action
const rubber = (over: number) => 24 * Math.log1p(over / 24); // resists past the edge, never stops dead

export function SwipeRow({ label, primary, actions, open, onOpenChange, onTap, children }: {
  label: string; primary?: SwipeAction; actions: SwipeAction[]; open: boolean; onOpenChange: (open: boolean) => void; onTap?: () => void; children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const g = useRef<{ x: number; y: number; id: number; mode: 'wait' | 'h' | 'v'; base: number } | null>(null);
  const moved = useRef(false);
  const [dx, setDx] = useState(0);
  const [drag, setDrag] = useState(false);
  const [menu, setMenu] = useState(false);
  const width = actions.length * BTN;
  const x = drag ? dx : open ? -width : 0;
  const armed = drag && primary && dx >= ARM;

  // one tap anywhere else closes this row (and its menu)
  useEffect(() => {
    if (!open && !menu) return;
    const off = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) { onOpenChange(false); setMenu(false); } };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { onOpenChange(false); setMenu(false); } };
    document.addEventListener('pointerdown', off); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', esc); };
  }, [open, menu, onOpenChange]);

  // a small buzz when the main action is armed, where the phone supports it
  useEffect(() => { if (armed) try { navigator.vibrate?.(8); } catch { /* not supported */ } }, [armed]);

  const down = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-swipe-ignore]')) return;
    g.current = { x: e.clientX, y: e.clientY, id: e.pointerId, mode: 'wait', base: open ? -width : 0 };
    moved.current = false;
  };
  const move = (e: React.PointerEvent) => {
    const s = g.current; if (!s || s.id !== e.pointerId) return;
    const mx = e.clientX - s.x, my = e.clientY - s.y;
    if (s.mode === 'wait') {
      if (Math.abs(my) > SLOP && Math.abs(my) >= Math.abs(mx)) { s.mode = 'v'; return; }   // a scroll: leave it to the page
      if (Math.abs(mx) > SLOP && Math.abs(mx) > Math.abs(my) * 1.2) {
        s.mode = 'h'; moved.current = true; setDrag(true); setMenu(false);
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
      } else return;
    }
    if (s.mode !== 'h') return;
    let v = s.base + mx;
    const max = primary ? ARM + 24 : 0;
    if (v > max) v = max + rubber(v - max);
    if (v < -width) v = -width - rubber(-width - v);
    setDx(v);
  };
  const up = (e: React.PointerEvent) => {
    const s = g.current; g.current = null;
    if (!s || s.mode !== 'h') return;
    setDrag(false);
    if (primary && dx >= ARM) { onOpenChange(false); primary.run(); }
    else onOpenChange(width > 0 && dx < -width / 2);
    setDx(0);
    void e;
  };

  const all = [...(primary ? [primary] : []), ...actions];
  return (
    <div ref={box} className={cx('relative overflow-x-clip rounded-card bg-surface2', menu && 'z-20')} data-testid="swipe-row" data-open={open || undefined}>
      {/* under the card: main action on the left, revealed actions on the right */}
      {primary && (
        <div aria-hidden className={cx('absolute inset-y-0 left-0 flex items-center gap-2 pl-5 text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none',
          armed ? TONE[primary.tone || 'good'] : 'bg-surface2 text-text2')} style={{ width: Math.max(0, x) }}>
          <span className={cx('flex items-center gap-2 transition-transform duration-150 motion-reduce:transition-none', armed && 'scale-110')}>{primary.icon}{x > 48 && primary.label}</span>
        </div>
      )}
      {actions.length > 0 && x < 0 && (
        <div className="absolute inset-y-0 right-0 flex" style={{ width }} aria-hidden={!open}>
          {actions.map((a) => (
            <button key={a.key} type="button" tabIndex={open ? 0 : -1} data-swipe-ignore onClick={() => { onOpenChange(false); a.run(); }}
              className={cx('flex h-full flex-col items-center justify-center gap-1 text-[11.5px] font-semibold', TONE[a.tone || 'accent'])} style={{ width: BTN }}>
              {a.icon}{a.label}
            </button>
          ))}
        </div>
      )}
      <div
        className={cx('relative flex touch-pan-y select-none items-stretch rounded-card border border-line bg-surface shadow-1', !drag && 'transition-transform duration-200 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none')}
        style={{ transform: `translate3d(${x}px,0,0)` }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onClickCapture={(e) => { if (moved.current) { e.stopPropagation(); e.preventDefault(); moved.current = false; } }}>
        <button type="button" className="min-h-[56px] min-w-0 flex-1 px-3 py-2.5 text-left" onClick={() => { if (open) onOpenChange(false); else onTap?.(); }}>{children}</button>
        {all.length > 0 && (
          <div className="relative flex items-start p-1.5" data-swipe-ignore>
            <button type="button" aria-label={'Actions for ' + label} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-text2 hover:bg-surface2"><MoreHorizontal size={18} /></button>
            {menu && (
              <div role="menu" aria-label={'Actions for ' + label} className="absolute right-1 top-12 z-30 w-48 rounded-card bg-surface p-1 shadow-3">
                {all.map((a) => (
                  <button key={a.key} type="button" role="menuitem" onClick={() => { setMenu(false); onOpenChange(false); a.run(); }}
                    className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-surface2">{a.icon}{a.label}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
