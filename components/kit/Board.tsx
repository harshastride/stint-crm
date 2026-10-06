'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cx } from '../ui';


// Board view: columns of cards. Drag with mouse, finger or trackpad (pointer events),
// or with the keyboard: focus a card, Space to pick up, Left/Right to choose a column,
// Space to drop, Esc to cancel. The database decides if a move is allowed; `allowedFrom` (stage rules)
// dims the columns a card cannot go to and refuses those drops up front with the reason.
export function Board<T extends Record<string, any>>({ stages, items, stageOf, canMove, onMove, onOpen, renderCard, selectedId, storageKey, totals, allowedFrom, onRefused }: {
  stages: string[];
  items: T[];
  stageOf: (r: T) => string;
  canMove: (r: T) => boolean;
  onMove: (r: T, to: string) => void;
  onOpen: (r: T) => void;
  renderCard: (r: T, next: string | undefined) => React.ReactNode;
  selectedId?: string | null;
  storageKey?: string;
  /** true number of records per column when `items` is only the first part (big lists) */
  totals?: Record<string, number>;
  /** stages a card in `from` may move to; null = rules not loaded (no dimming) */
  allowedFrom?: (from: string) => string[] | null;
  /** a drop on a column the rules do not allow */
  onRefused?: (r: T, to: string, allowed: string[]) => void;
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
      if (b && x >= b.left && x <= b.right && y >= b.top) return st;
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
    if (r && to && to !== stageOf(r)) { setShut((p) => { const n = new Set(p); n.delete(to); return n; }); tryMove(r, to); }
  };
  const cancelP = () => { setDrag(null); setOver(null); };

  const key = (e: React.KeyboardEvent, r: T) => {
    if (e.key === 'Enter' && !kb) { e.preventDefault(); onOpen(r); return; }
    if (!canMove(r)) return;
    const from = stages.indexOf(stageOf(r));
    if (e.key === ' ') {
      e.preventDefault();
      if (!kb) { setKb({ id: r.id, col: from }); setSay(`Picked up. In ${stages[from]}. Use Left and Right to choose a column, Space to drop, Esc to cancel.`); }
      else { const to = stages[kb.col]; setKb(null); if (to !== stageOf(r)) { if (okTo(r, to)) setSay('Dropped in ' + to + '.'); tryMove(r, to); } else setSay('Dropped. No change.'); }
    } else if (kb && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      const col = Math.max(0, Math.min(stages.length - 1, kb.col + (e.key === 'ArrowRight' ? 1 : -1)));
      setKb({ ...kb, col }); setSay(stages[col] + (col === from ? ' (where it is now)' : okTo(r, stages[col]) ? '' : ' (not an allowed move)'));
    } else if (kb && e.key === 'Escape') { e.preventDefault(); setKb(null); setSay('Move cancelled.'); }
  };

  const okTo = (r: T, to: string) => { const a = allowedFrom?.(stageOf(r)); return !a || a.includes(to); };
  const tryMove = (r: T, to: string) => {
    const a = allowedFrom?.(stageOf(r));
    if (a && !a.includes(to)) { setSay(`Can't move to ${to}.`); onRefused?.(r, to, a); return; }
    onMove(r, to);
  };
  const dragged = drag?.on ? items.find((x) => x.id === drag.id) : null;
  const target = kb ? stages[kb.col] : over;
  const moving = kb ? items.find((x) => x.id === kb.id) : drag?.on ? items.find((x) => x.id === drag.id) : null;
  const shutOut = (st: string) => !!moving && st !== stageOf(moving) && !okTo(moving, st);

  return (
    <div className="flex min-w-0 items-start gap-3 overflow-x-auto pb-2" data-testid="board">
      <div aria-live="assertive" className="sr-only">{say}</div>
      {stages.map((st, i) => {
        const cards = items.filter((r) => stageOf(r) === st);
        const next = stages[i + 1];
        const closed = shut.has(st);
        return (
          <section key={st} aria-label={st} ref={(el) => { cols.current[st] = el; }} data-stage={st}
            className={cx('ui-col flex shrink-0 flex-col gap-2 transition-[background-color,box-shadow] duration-150', closed ? 'w-[56px]' : 'w-[264px]', target === st && !shutOut(st) && '!bg-accentSoft ring-2 ring-inset ring-accent', shutOut(st) && 'opacity-45', target === st && shutOut(st) && 'ring-2 ring-inset ring-badText')}
            data-blocked={shutOut(st) ? '' : undefined}>
            <button type="button" onClick={() => toggle(st)} aria-expanded={!closed} aria-label={(closed ? 'Open ' : 'Fold ') + st + ' column'}
              className={cx('ui-col-head group min-h-[44px] rounded-lg text-left transition-colors hover:bg-surface hover:text-text', closed && 'flex-col !px-0 py-2')}>
              {closed && <ChevronRight size={14} aria-hidden />}
              <span className={cx('truncate', closed ? '[writing-mode:vertical-rl]' : 'flex-1')}>{st}</span>
              <span className="ui-count" data-testid="col-count">{(totals?.[st] ?? cards.length).toLocaleString('en-IN')}</span>
              {!closed && <ChevronLeft size={14} aria-hidden className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />}
            </button>
            {!closed && cards.length === 0 && <p className="px-2 pb-2 text-[12px] text-muted">No cards</p>}
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
                  className={cx('ui-card anim-fade cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-accent', movable && 'cursor-grab active:cursor-grabbing',
                    drag?.on && drag.id === r.id && 'opacity-40', kb?.id === r.id && 'ring-2 ring-coral', selectedId === r.id && 'ring-2 ring-accent')}>
                  {renderCard(r, next)}
                </div>
              );
            })}
            {!closed && totals && (totals[st] ?? 0) > cards.length && (
              <p className="px-2 pb-2 text-[12px] text-muted">{((totals[st] ?? 0) - cards.length).toLocaleString('en-IN')} more not shown. Narrow with a filter or use the table.</p>
            )}
          </section>
        );
      })}
      {dragged && drag && (
        <div aria-hidden className="pointer-events-none fixed z-50 ui-card rotate-2 !shadow-3 ring-1 ring-accent"
          style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }}>
          {renderCard(dragged, undefined)}
        </div>
      )}
    </div>
  );
}
