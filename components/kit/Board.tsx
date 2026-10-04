'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cx } from '../ui';


// Board view: columns of cards. Drag with mouse, finger or trackpad (pointer events),
// or with the keyboard: focus a card, Space to pick up, Left/Right to choose a column,
// Space to drop, Esc to cancel. The database decides if a move is allowed.
export function Board<T extends Record<string, any>>({ stages, items, stageOf, canMove, onMove, onOpen, renderCard, selectedId, storageKey }: {
  stages: string[];
  items: T[];
  stageOf: (r: T) => string;
  canMove: (r: T) => boolean;
  onMove: (r: T, to: string) => void;
  onOpen: (r: T) => void;
  renderCard: (r: T, next: string | undefined) => React.ReactNode;
  selectedId?: string | null;
  storageKey?: string;
}) {
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; dx: number; dy: number; w: number; on: boolean } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [kb, setKb] = useState<{ id: string; col: number } | null>(null);
  const [say, setSay] = useState('');
  const [shut, setShut] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('board-shut:' + storageKey) || '[]')); } catch { return new Set(); }
  });
  const start = useRef<{ x: number; y: number } | null>(null);
  const cols = useRef<Record<string, HTMLElement | null>>({});
  const justDragged = useRef(false);

  useEffect(() => { try { localStorage.setItem('board-shut:' + storageKey, JSON.stringify([...shut])); } catch { /* private window */ } }, [shut, storageKey]);
  const toggle = (st: string) => setShut((p) => { const n = new Set(p); if (n.has(st)) n.delete(st); else n.add(st); return n; });

  const colAt = (x: number, y: number) => {
    for (const st of stages) {
      const b = cols.current[st]?.getBoundingClientRect();
      if (b && x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return st;
    }
    return null;
  };

  const down = (e: React.PointerEvent<HTMLDivElement>, r: T) => {
    if (!canMove(r) || e.button !== 0 || (e.target as HTMLElement).closest('button,a,input')) return;
    const b = e.currentTarget.getBoundingClientRect();
    start.current = { x: e.clientX, y: e.clientY };
    setDrag({ id: r.id, x: e.clientX, y: e.clientY, dx: e.clientX - b.left, dy: e.clientY - b.top, w: b.width, on: false });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveP = (e: React.PointerEvent) => {
    if (!drag) return;
    const s = start.current!;
    const on = drag.on || Math.hypot(e.clientX - s.x, e.clientY - s.y) > 6;
    if (on) e.preventDefault();
    setDrag({ ...drag, x: e.clientX, y: e.clientY, on });
    if (on) setOver(colAt(e.clientX, e.clientY));
  };
  const up = (e: React.PointerEvent) => {
    if (!drag) return;
    const r = items.find((x) => x.id === drag.id);
    const to = drag.on ? colAt(e.clientX, e.clientY) : null;
    if (drag.on) { justDragged.current = true; setTimeout(() => { justDragged.current = false; }, 0); }
    setDrag(null); setOver(null);
    if (r && to && to !== stageOf(r)) { setShut((p) => { const n = new Set(p); n.delete(to); return n; }); onMove(r, to); }
  };
  const cancelP = () => { setDrag(null); setOver(null); };

  const key = (e: React.KeyboardEvent, r: T) => {
    if (e.key === 'Enter' && !kb) { e.preventDefault(); onOpen(r); return; }
    if (!canMove(r)) return;
    const from = stages.indexOf(stageOf(r));
    if (e.key === ' ') {
      e.preventDefault();
      if (!kb) { setKb({ id: r.id, col: from }); setSay(`Picked up. In ${stages[from]}. Use Left and Right to choose a column, Space to drop, Esc to cancel.`); }
      else { const to = stages[kb.col]; setKb(null); if (to !== stageOf(r)) { setSay('Dropped in ' + to + '.'); onMove(r, to); } else setSay('Dropped. No change.'); }
    } else if (kb && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      const col = Math.max(0, Math.min(stages.length - 1, kb.col + (e.key === 'ArrowRight' ? 1 : -1)));
      setKb({ ...kb, col }); setSay(stages[col] + (col === from ? ' (where it is now)' : ''));
    } else if (kb && e.key === 'Escape') { e.preventDefault(); setKb(null); setSay('Move cancelled.'); }
  };

  const dragged = drag?.on ? items.find((x) => x.id === drag.id) : null;
  const target = kb ? stages[kb.col] : over;

  return (
    <div className="flex min-w-0 gap-3 overflow-x-auto pb-2" data-testid="board">
      <div aria-live="assertive" className="sr-only">{say}</div>
      {stages.map((st, i) => {
        const cards = items.filter((r) => stageOf(r) === st);
        const next = stages[i + 1];
        const closed = shut.has(st);
        return (
          <section key={st} aria-label={st} ref={(el) => { cols.current[st] = el; }} data-stage={st}
            className={cx('flex shrink-0 flex-col gap-2 rounded-xl p-2.5 transition-colors', closed ? 'w-[56px]' : 'w-[240px]', target === st ? 'bg-accentSoft ring-2 ring-accent' : 'bg-surface2')}>
            <button type="button" onClick={() => toggle(st)} aria-expanded={!closed} aria-label={(closed ? 'Open ' : 'Fold ') + st + ' column'}
              className={cx('flex min-h-[44px] items-center gap-1 rounded-lg px-1 text-left text-[13px] font-semibold hover:bg-surface', closed ? 'flex-col' : 'justify-between')}>
              {closed ? <ChevronRight size={14} /> : null}
              <span className={cx(closed && '[writing-mode:vertical-rl]')}>{st}</span>
              <span className="flex items-center gap-1"><span className="num rounded-full bg-surface px-2 py-0.5 text-xs" data-testid="col-count">{cards.length}</span>{!closed && <ChevronLeft size={14} className="text-muted" />}</span>
            </button>
            {!closed && cards.map((r) => {
              const movable = canMove(r);
              return (
                <div key={r.id} tabIndex={0} role="button" data-card={r.id}
                  aria-roledescription={movable ? 'Draggable card' : undefined}
                  aria-pressed={kb?.id === r.id ? true : undefined}
                  onPointerDown={(e) => down(e, r)} onPointerMove={moveP} onPointerUp={up} onPointerCancel={cancelP}
                  onKeyDown={(e) => key(e, r)} onBlur={() => { if (kb?.id === r.id) { setKb(null); setSay('Move cancelled.'); } }}
                  onClick={() => { if (!justDragged.current) onOpen(r); }}
                  style={movable ? { touchAction: 'none' } : undefined}
                  className={cx('anim-fade cursor-pointer select-none rounded-[10px] border bg-surface p-2.5 outline-none focus-visible:ring-2 focus-visible:ring-accent', movable && 'cursor-grab',
                    drag?.on && drag.id === r.id && 'opacity-40', kb?.id === r.id && 'ring-2 ring-coral', selectedId === r.id ? 'border-accent ring-1 ring-accent' : 'border-line')}>
                  {renderCard(r, next)}
                </div>
              );
            })}
          </section>
        );
      })}
      {dragged && drag && (
        <div aria-hidden className="pointer-events-none fixed z-50 rotate-2 rounded-[10px] border border-accent bg-surface p-2.5 shadow-xl"
          style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }}>
          {renderCard(dragged, undefined)}
        </div>
      )}
    </div>
  );
}
