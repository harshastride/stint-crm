'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Plus, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Field, PageCfg } from '@/lib/pages';
import { Button, cx } from '../ui';

// Advanced filter: rows of [field][operator][value], grouped with AND / OR.
// Turned into one PostgREST `or=(...)` filter so the database does the filtering (and row security still applies).
export type AdvRule = { field: string; op: string; values: string[] };
export type AdvGroup = { join: 'and' | 'or'; rules: AdvRule[] };
export type Adv = { join: 'and' | 'or'; groups: AdvGroup[] } | null;

// Contact and identity details are never filterable (lead mobile/email go through reveal_contact only).
const SECRET = /(mobile|email|phone|whatsapp|aadhaar|aadhar|pan_|_pan|passport|bank|ifsc|account_no|contact_no|alt_)/i;
const KINDS: Field['type'][] = ['text', 'select', 'ref', 'number', 'date', 'datetime'];

type Op = { id: string; label: string; multi?: boolean; none?: boolean };
const OPS: Record<'list' | 'text' | 'num', Op[]> = {
  list: [{ id: 'in', label: 'is any of', multi: true }, { id: 'nin', label: 'is none of', multi: true }, { id: 'empty', label: 'is empty', none: true }, { id: 'set', label: 'is not empty', none: true }],
  text: [{ id: 'has', label: 'contains' }, { id: 'eq', label: 'is exactly' }, { id: 'empty', label: 'is empty', none: true }, { id: 'set', label: 'is not empty', none: true }],
  num: [{ id: 'eq', label: 'is' }, { id: 'gte', label: 'is at least / on or after' }, { id: 'lte', label: 'is at most / on or before' }, { id: 'empty', label: 'is empty', none: true }, { id: 'set', label: 'is not empty', none: true }],
};
const kindOf = (f: Field) => (f.type === 'select' || f.type === 'ref' ? 'list' : f.type === 'text' ? 'text' : 'num');

/** Fields of this page that may be used in the advanced filter. */
export function advFields(cfg: PageCfg): Field[] {
  const colKeys = new Set(cfg.columns.map((c) => c.key));
  const out = (cfg.fields || []).filter((f) => KINDS.includes(f.type) && !SECRET.test(f.key) && !f.key.includes('.')
    && (!cfg.readFrom || cfg.sameRows || colKeys.has(f.key)));
  if (cfg.board && !out.some((f) => f.key === cfg.board!.field)) out.unshift({ key: cfg.board.field, label: 'Stage', type: 'select', list: cfg.board.list });
  return out;
}

const q = (v: string) => '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
function cond(r: AdvRule, f: Field | undefined): string | null {
  if (!f) return null;
  const k = f.key, v = r.values.filter((x) => x !== '');
  switch (r.op) {
    case 'empty': return `${k}.is.null`;
    case 'set': return `${k}.not.is.null`;
    case 'in': return v.length ? `${k}.in.(${v.map(q).join(',')})` : null;
    case 'nin': return v.length ? `${k}.not.in.(${v.map(q).join(',')})` : null;
    case 'has': return v[0] ? `${k}.ilike.${q('*' + v[0].replace(/[*%]/g, '') + '*')}` : null;
    case 'eq': case 'gte': case 'lte': return v[0] ? `${k}.${r.op}.${q(v[0])}` : null;
    default: return null;
  }
}
/** The whole filter as one expression for `query.or(expr)`; null when nothing is complete yet. */
export function advExpr(adv: Adv, fields: Field[]): string | null {
  if (!adv) return null;
  const groups = adv.groups.map((g) => {
    const cs = g.rules.map((r) => cond(r, fields.find((f) => f.key === r.field))).filter(Boolean) as string[];
    return cs.length ? `${g.join}(${cs.join(',')})` : null;
  }).filter(Boolean) as string[];
  return groups.length ? `${adv.join}(${groups.join(',')})` : null;
}
export const advCount = (adv: Adv) => (adv ? adv.groups.reduce((n, g) => n + g.rules.length, 0) : 0);

const blankRule = (fields: Field[]): AdvRule => { const f = fields[0]; return { field: f?.key || '', op: f ? OPS[kindOf(f)][0].id : 'in', values: [] }; };

export function FilterBuilder({ cfg, value, onChange }: { cfg: PageCfg; value: Adv; onChange: (a: Adv) => void }) {
  const s = useSession();
  const fields = useMemo(() => advFields(cfg), [cfg]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Adv>(value);
  const [count, setCount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) setDraft(value); }, [value, open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away); return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const expr = advExpr(draft, fields);
  // live result count, worked out by the database
  useEffect(() => {
    if (!open) return;
    let off = false;
    const t = setTimeout(async () => {
      let query = supabase().from(cfg.readFrom || cfg.table).select('*', { count: 'exact', head: true });
      if (expr) query = query.or(expr);
      const { count: n, error } = await query;
      if (off) return;
      setErr(error ? 'This filter cannot be used here.' : null); setCount(error ? null : n ?? 0);
    }, 300);
    return () => { off = true; clearTimeout(t); };
  }, [open, expr, cfg]);

  if (!fields.length) return null;
  const d = draft || { join: 'and' as const, groups: [] };
  const set = (n: NonNullable<Adv>) => setDraft(n.groups.length ? n : null);
  const setGroup = (gi: number, g: AdvGroup | null) => set({ ...d, groups: g ? d.groups.map((x, i) => (i === gi ? g : x)) : d.groups.filter((_, i) => i !== gi) });
  const setRule = (gi: number, ri: number, r: AdvRule | null) => {
    const g = d.groups[gi]; const rules = r ? g.rules.map((x, i) => (i === ri ? r : x)) : g.rules.filter((_, i) => i !== ri);
    setGroup(gi, rules.length ? { ...g, rules } : null);
  };
  const options = (f: Field): [string, string][] => f.type === 'ref' ? (s.refs[f.ref || ''] || []).map((x) => [x.id, x.label])
    : (f.options || (f.list === '__roles' ? s.roles : s.lists[f.list || ''] || [])).map((v) => [v, v]);
  const on = advCount(value);
  const Join = ({ v, set: setJ, label }: { v: 'and' | 'or'; set: (j: 'and' | 'or') => void; label: string }) => (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg bg-surface2 p-0.5">
      {(['and', 'or'] as const).map((j) => (
        <button key={j} type="button" role="radio" aria-checked={v === j} onClick={() => setJ(j)} className={cx('min-h-[32px] rounded-md px-2.5 text-[11.5px] font-semibold', v === j ? 'bg-surface shadow-sm' : 'text-text2')}>
          {j === 'and' ? 'All match (AND)' : 'Any match (OR)'}
        </button>
      ))}
    </div>
  );

  return (
    <div ref={box} className="relative">
      <Button variant="quiet" size="sm" aria-expanded={open} active={on > 0} aria-pressed={undefined} onClick={() => setOpen(!open)} leftIcon={<SlidersHorizontal size={14} />}>
        Advanced{on ? ` · ${on}` : ''}
      </Button>
      {open && (
        <div role="dialog" aria-label="Advanced filter" className="fixed left-1/2 top-24 z-50 max-h-[75vh] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-y-auto rounded-card bg-surface p-4 shadow-3">
          <div className="mb-2 flex items-center gap-2">
            <div className="text-[13px] font-semibold">Advanced filter</div>
            {d.groups.length > 1 && <Join label="Join groups" v={d.join} set={(j) => set({ ...d, join: j })} />}
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface2"><X size={15} /></button>
          </div>
          {d.groups.length === 0 && <p className="px-1 py-3 text-[13px] text-text2">No conditions yet. Add one to narrow this list.</p>}
          {d.groups.map((g, gi) => (
            <div key={gi} className="mb-2 rounded-control bg-surface2 p-2" aria-label={'Group ' + (gi + 1)}>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Group {gi + 1}</span>
                {g.rules.length > 1 && <Join label={'Join in group ' + (gi + 1)} v={g.join} set={(j) => setGroup(gi, { ...g, join: j })} />}
                <button type="button" aria-label={'Remove group ' + (gi + 1)} onClick={() => setGroup(gi, null)} className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:text-badText"><Trash2 size={14} /></button>
              </div>
              {g.rules.map((r, ri) => {
                const f = fields.find((x) => x.key === r.field) || fields[0];
                const ops = OPS[kindOf(f)]; const op = ops.find((o) => o.id === r.op) || ops[0];
                const opts = kindOf(f) === 'list' ? options(f) : [];
                return (
                  <div key={ri} className="mb-1.5 flex flex-wrap items-start gap-1.5">
                    <select aria-label="Field" value={f.key} onChange={(e) => { const nf = fields.find((x) => x.key === e.target.value)!; setRule(gi, ri, { field: nf.key, op: OPS[kindOf(nf)][0].id, values: [] }); }} className="h-[44px] min-w-[130px] flex-1 px-2 text-[13px] md:h-[38px]">
                      {fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                    </select>
                    <select aria-label="Operator" value={op.id} onChange={(e) => setRule(gi, ri, { ...r, field: f.key, op: e.target.value, values: OPS[kindOf(f)].find((o) => o.id === e.target.value)?.multi === op.multi ? r.values : [] })} className="h-[44px] min-w-[120px] px-2 text-[13px] md:h-[38px]">
                      {ops.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                    {op.none ? <span className="flex-1" /> : op.multi ? (
                      <div role="group" aria-label="Values" className="flex max-h-40 min-w-[180px] flex-1 flex-col overflow-y-auto rounded-lg border border-line2">
                        {opts.length === 0 && <span className="px-2 py-2 text-[12px] text-muted">No choices set up.</span>}
                        {opts.map(([v, l]) => { const has = r.values.includes(v); return (
                          <button key={v} type="button" role="checkbox" aria-checked={has} onClick={() => setRule(gi, ri, { ...r, field: f.key, op: op.id, values: has ? r.values.filter((x) => x !== v) : [...r.values, v] })}
                            className="flex min-h-[36px] items-center gap-2 px-2 text-left text-[13px] hover:bg-surface2">
                            <span className={cx('flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border', has ? 'border-accent bg-accent text-white' : 'border-line2')}>{has && <Check size={11} strokeWidth={3} />}</span>{l}
                          </button>); })}
                      </div>
                    ) : kindOf(f) === 'list' ? (
                      <select aria-label="Value" value={r.values[0] || ''} onChange={(e) => setRule(gi, ri, { ...r, field: f.key, op: op.id, values: [e.target.value] })} className="h-[44px] min-w-[150px] flex-1 px-2 text-[13px] md:h-[38px]">
                        <option value="">Pick…</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    ) : (
                      <input aria-label="Value" type={f.type === 'number' ? 'number' : f.type === 'date' || f.type === 'datetime' ? 'date' : 'text'} value={r.values[0] || ''}
                        onChange={(e) => setRule(gi, ri, { ...r, field: f.key, op: op.id, values: [e.target.value] })} className="h-[44px] min-w-[150px] flex-1 px-2 text-[13px] md:h-[38px]" />
                    )}
                    <button type="button" aria-label="Remove condition" onClick={() => setRule(gi, ri, null)} className="flex h-[44px] w-9 items-center justify-center rounded-lg text-muted hover:text-badText md:h-[38px]"><X size={14} /></button>
                  </div>
                );
              })}
              <button type="button" onClick={() => setGroup(gi, { ...g, rules: [...g.rules, blankRule(fields)] })} className="flex min-h-[36px] items-center gap-1 px-1 text-[12.5px] font-medium text-accentText"><Plus size={13} /> Add condition</button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
            <button type="button" onClick={() => set({ ...d, groups: [...d.groups, { join: 'and', rules: [blankRule(fields)] }] })} className="flex min-h-[44px] items-center gap-1 rounded-lg border border-dashed border-line2 px-3 text-[12.5px] font-medium text-text2 hover:text-accentText"><Plus size={13} /> {d.groups.length ? 'Add group' : 'Add condition'}</button>
            <span className="text-[12.5px] text-text2" aria-live="polite" data-testid="adv-count">{err || (count == null ? 'Counting…' : `${count.toLocaleString('en-IN')} match${count === 1 ? '' : 'es'}`)}</span>
            <div className="ml-auto flex gap-1.5">
              {(draft || value) && <Button variant="quiet" size="lg" onClick={() => { setDraft(null); onChange(null); setOpen(false); }}>Clear</Button>}
              <Button variant="primary" size="lg" disabled={!!err} onClick={() => { onChange(draft); setOpen(false); }}>Apply</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
