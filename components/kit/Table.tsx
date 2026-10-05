'use client';
import { useState, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes, type HTMLAttributes } from 'react';
import { cx } from '../ui';

// Table primitives (docs/design/system.md → Tables). Styling lives in globals.css `.ui-table`.
export type Density = 'comfortable' | 'compact';

export function useDensity(key = 'table-density'): [Density, (d: Density) => void] {
  const [d, setD] = useState<Density>(() => { try { return (localStorage.getItem(key) as Density) || 'comfortable'; } catch { return 'comfortable'; } });
  return [d, (n) => { setD(n); try { localStorage.setItem(key, n); } catch { /* private mode */ } }];
}

export function Table({ density = 'comfortable', label, children, className }: { density?: Density; label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('min-h-0 overflow-auto rounded-card bg-surface shadow-1', className)}>
      <table className="ui-table" aria-label={label} data-density={density}>{children}</table>
    </div>
  );
}
export const THead = ({ children }: { children: ReactNode }) => <thead><tr>{children}</tr></thead>;
export const TBody = ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>;
export function Th({ numeric, className, ...p }: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <th scope="col" {...p} className={cx(numeric && 'num', className)} />;
}
export function Td({ numeric, className, ...p }: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <td {...p} className={cx(numeric && 'num', className)} />;
}
export function Tr({ selected, onOpen, className, ...p }: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean; onOpen?: () => void }) {
  return <tr {...p} aria-selected={selected || undefined} data-clickable={onOpen ? '' : undefined} onClick={onOpen} className={className} />;
}
/** Row actions: hidden until hover on mouse, always visible on touch. */
export const RowActions = ({ children }: { children: ReactNode }) => <div className="ui-row-actions flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>{children}</div>;
