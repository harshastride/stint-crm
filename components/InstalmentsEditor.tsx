'use client';
import { useEffect, useRef } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button, IconButton } from './ui';

export type Instalment = { label: string; amount: number };

/** Same rule as the database (quote_rules): discount applied, rounded to the nearest ₹100. */
export const quoteAmount = (v: Record<string, unknown>) => Math.round((Number(v.list_price || 0) * (100 - Number(v.discount_pct || 0))) / 100 / 100) * 100;

/** Same as split_instalments() in the database: equal parts in hundreds, the first takes the rounding difference. */
export function splitEvenly(total: number, parts: number, old: Instalment[] = []): Instalment[] {
  const each = Math.round(total / parts / 100) * 100;
  return Array.from({ length: parts }, (_, i) => ({
    label: old[i]?.label || (i === 0 ? 'On joining' : 'Instalment ' + (i + 1)),
    amount: i === 0 ? total - each * (parts - 1) : each,
  }));
}

const inr = (n: number) => '₹' + n.toLocaleString('en-IN');
const MAX = 24;

export function InstalmentsEditor({ total, value, onChange, disabled }: { total: number; value: unknown; onChange: (v: Instalment[]) => void; disabled?: boolean }) {
  const list = Array.isArray(value) ? (value as Instalment[]) : [];
  const lastTotal = useRef<number | null>(null);

  // New record, or the final amount changed: start again from an even split.
  useEffect(() => {
    if (disabled || !total) return;
    const changed = lastTotal.current !== null && lastTotal.current !== total;
    lastTotal.current = total;
    if (!list.length || changed) onChange(splitEvenly(total, list.length || 3, list));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, disabled]);

  const sum = list.reduce((a, i) => a + Number(i.amount || 0), 0);
  const diff = total - sum;
  const setCount = (n: number) => onChange(splitEvenly(total, Math.min(MAX, Math.max(1, n)), list));
  const setRow = (i: number, patch: Partial<Instalment>) => onChange(list.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  if (disabled) {
    return (
      <div className="flex flex-col gap-1 rounded-[10px] bg-surface2 px-3 py-2.5 text-sm font-normal text-text">
        {list.length ? list.map((r, i) => <div key={i} className="flex justify-between"><span>{r.label}</span><span className="num">{inr(Number(r.amount))}</span></div>) : '—'}
      </div>
    );
  }

  if (!total && !list.length) return <div className="rounded-[10px] bg-surface2 px-3 py-2 text-[13px] font-normal text-muted">Choose a program first; the plan splits its price.</div>;
  return (
    <div className="flex flex-col gap-2 font-normal">
      <div className="flex items-center gap-2">
        <IconButton aria-label="One fewer instalment" variant="outline" disabled={list.length <= 1} onClick={() => setCount(list.length - 1)} icon={<Minus size={16} />} />
        <div className="min-w-[112px] text-center text-[13.5px] font-semibold text-text">{list.length === 1 ? 'Full payment' : list.length + ' instalments'}</div>
        <IconButton aria-label="One more instalment" variant="outline" disabled={list.length >= MAX} onClick={() => setCount(list.length + 1)} icon={<Plus size={16} />} />
        <Button variant="quiet" size="sm" className="ml-auto" onClick={() => setCount(list.length)}>Split evenly</Button>
      </div>
      {list.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <input aria-label={`Instalment ${i + 1} name`} value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} className="h-10 min-w-0 flex-1 rounded-[10px] px-3 text-[13.5px]" />
          <div className="relative w-[132px] shrink-0">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13.5px] text-muted">₹</span>
            <input aria-label={`Instalment ${i + 1} amount`} type="number" min={0} step={100} value={r.amount ?? ''} onChange={(e) => setRow(i, { amount: e.target.value === '' ? 0 : Number(e.target.value) })} className="num h-10 w-full rounded-[10px] pl-7 pr-3 text-right text-[13.5px]" />
          </div>
        </div>
      ))}
      <div className={'rounded-[10px] px-3 py-2 text-[13px] font-medium ' + (diff === 0 ? 'bg-surface2 text-text2' : 'bg-badBg text-badText')}>
        {diff === 0 ? `Adds up to ${inr(total)} ✓` : diff > 0 ? `${inr(diff)} still to assign (total ${inr(total)})` : `${inr(-diff)} over the total of ${inr(total)}`}
      </div>
    </div>
  );
}
