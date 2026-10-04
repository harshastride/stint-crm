'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Field, Row } from '@/lib/pages';

const inputCls = 'h-[42px] w-full px-3 text-sm';

/** Search-as-you-type picker for a lead or a candidate. */
export function PersonSearch({ kind, value, onChange, disabled, label }: { kind: 'lead' | 'candidate'; value: string | null; onChange: (id: string | null, row?: Row) => void; disabled?: boolean; label?: string }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Row[]>([]);
  const [picked, setPicked] = useState<Row | null>(null);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!value) { setPicked(null); return; }
    if (picked?.id === value) return;
    supabase().from(kind).select(kind === 'lead' ? 'id,full_name,mobile,stage' : 'id,full_name,code,stage').eq('id', value).maybeSingle().then(({ data }: { data: Row | null }) => setPicked(data));
  }, [value, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); return; }
    const my = ++seq.current;
    const t = setTimeout(async () => {
      const cols = kind === 'lead' ? 'id,full_name,mobile,stage' : 'id,full_name,code,stage';
      const digits = term.replace(/\D/g, '');
      let query = supabase().from(kind).select(cols).limit(8);
      query = kind === 'lead' && digits.length >= 3 ? query.or(`full_name.ilike.%${term}%,mobile.ilike.%${digits}%`) : query.ilike('full_name', `%${term}%`);
      const { data } = await query;
      if (my === seq.current) setHits((data as Row[]) || []);
    }, 180);
    return () => clearTimeout(t);
  }, [q, kind]);

  if (picked) {
    return (
      <div className="flex min-h-[42px] items-center justify-between gap-2 rounded-[10px] bg-surface2 px-3 py-1.5 text-sm">
        <span><span className="font-medium">{picked.full_name}</span> <span className="text-muted">· {picked.mobile || picked.code || ''} · {picked.stage}</span></span>
        {!disabled && <button type="button" className="rounded-md border border-line2 bg-surface px-2 py-1 text-xs" onClick={() => { setPicked(null); onChange(null); setQ(''); }}>Change</button>}
      </div>
    );
  }
  return (
    <div className="relative">
      <input aria-label={label || 'Find ' + kind} className={inputCls} placeholder={kind === 'lead' ? 'Type a name or mobile' : 'Type a name'} value={q} disabled={disabled}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {open && q.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-[10px] border border-line2 bg-surface shadow-lg">
          {hits.length === 0 && <div className="px-3 py-2.5 text-[13px] text-muted">No {kind} found.</div>}
          {hits.map((h) => (
            <button key={h.id} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-surface2" onClick={() => { setPicked(h); onChange(h.id, h); setOpen(false); }}>
              <span className="font-medium">{h.full_name}</span> <span className="text-muted">· {h.mobile || h.code || ''} · {h.stage}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Reference tables that can take a new row from a form: table and its name column.
const ADDABLE: Record<string, { table: string; col: string; noun: string }> = { company: { table: 'company', col: 'name', noun: 'company' } };

/** Type to find an existing entry, or add a new one if it is not there yet. */
function RefPicker({ field, value, onChange, disabled }: { field: Field; value: string | null; onChange: (v: unknown) => void; disabled?: boolean }) {
  const s = useSession();
  const meta = ADDABLE[field.ref!];
  const opts = s.refs[field.ref!] || [];
  const picked = opts.find((o) => o.id === value);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (picked) {
    return (
      <div className="flex min-h-[42px] items-center justify-between gap-2 rounded-[10px] bg-surface2 px-3 py-1.5 text-sm">
        <span className="font-medium">{picked.label}</span>
        {!disabled && <button type="button" className="rounded-md border border-line2 bg-surface px-2 py-1 text-xs" onClick={() => { onChange(null); setQ(''); }}>Change</button>}
      </div>
    );
  }
  const term = q.trim();
  const hits = opts.filter((o) => o.label.toLowerCase().includes(term.toLowerCase())).slice(0, 8);
  const exact = opts.find((o) => o.label.toLowerCase() === term.toLowerCase());

  const add = async () => {
    if (!meta || !term) return;
    setBusy(true); setErr(null);
    const db = supabase();
    let { data, error } = await db.from(meta.table).insert({ [meta.col]: term } as Row).select('id').single();
    if (error?.code === '23505') ({ data, error } = await db.from(meta.table).select('id').ilike(meta.col, term).single());
    if (error || !data) { setBusy(false); setErr(friendlyError(error, 'the ' + meta.noun + ' list')); return; }
    await s.reload();
    setBusy(false); setOpen(false); setQ('');
    onChange(data.id);
  };

  return (
    <div className="relative">
      <input aria-label={field.label} className={inputCls} placeholder={'Type a ' + (meta?.noun || 'name') + ' name'} value={q} disabled={disabled || busy}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setErr(null); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (exact) onChange(exact.id); else if (term) add(); } }} />
      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-[10px] border border-line2 bg-surface shadow-lg">
          {hits.map((h) => (
            <button key={h.id} type="button" className="block min-h-[44px] w-full px-3 py-2 text-left text-sm hover:bg-surface2" onClick={() => { onChange(h.id); setOpen(false); }}>{h.label}</button>
          ))}
          {term && !exact && meta && (
            <button type="button" disabled={busy} className="block min-h-[44px] w-full border-t border-line px-3 py-2 text-left text-sm font-medium text-accent hover:bg-surface2" onClick={add}>
              {busy ? 'Adding…' : `+ Add “${term}” as a new ${meta.noun}`}
            </button>
          )}
          {!term && hits.length === 0 && <div className="px-3 py-2.5 text-[13px] text-muted">Type a name to add the first one.</div>}
        </div>
      )}
      {err && <div role="alert" className="mt-1 text-[13px] font-medium text-badText">{err}</div>}
    </div>
  );
}

/** One form control, chosen from the field's type. */
export function FieldInput({ field, value, onChange, disabled }: { field: Field; value: unknown; onChange: (v: unknown) => void; disabled?: boolean }) {
  const s = useSession();
  const v = value == null ? '' : String(value);
  if (field.type === 'person') return <PersonSearch kind={field.person!} value={(value as string) || null} onChange={(id) => onChange(id)} disabled={disabled} label={field.label} />;
  if (field.type === 'textarea') return <textarea className="min-h-[84px] w-full px-3 py-2 text-sm" value={v} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
  if (field.type === 'ref' && field.addable) return <RefPicker field={field} value={(value as string) || null} onChange={onChange} disabled={disabled} />;
  if (field.type === 'ref') {
    const opts = s.refs[field.ref!] || [];
    return (
      <select className={inputCls} value={v} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Select</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    );
  }
  if (field.type === 'select') {
    const base = field.options || (field.list === '__roles' ? s.roles : s.lists[field.list || ''] || []);
    const isOther = field.other && v !== '' && !base.includes(v);
    return (
      <div className="flex flex-col gap-2">
        <select className={inputCls} value={isOther ? '__other' : v} disabled={disabled} onChange={(e) => onChange(e.target.value === '__other' ? ' ' : e.target.value || null)}>
          <option value="">Select</option>
          {base.map((o) => <option key={o} value={o}>{o}</option>)}
          {field.other && <option value="__other">Other</option>}
        </select>
        {isOther && <input aria-label={field.label + ' (other)'} className={inputCls} placeholder="Type it here" value={v.trim()} autoFocus onChange={(e) => onChange(e.target.value || ' ')} />}
      </div>
    );
  }
  if (field.type === 'datetime') {
    const local = v ? new Date(new Date(v).getTime() - new Date(v).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    return <input type="datetime-local" className={inputCls} value={local} disabled={disabled} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)} />;
  }
  return <input type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} className={inputCls} value={field.type === 'date' ? v.slice(0, 10) : v} disabled={disabled}
    onChange={(e) => onChange(field.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value || null)} />;
}

/** Turns a database error into words a person can act on. */
export function friendlyError(e: { code?: string; message?: string } | null, what = 'this'): string {
  if (!e) return '';
  if (e.code === '23505') return /mobile/.test(e.message || '') ? 'A lead with this mobile number already exists.' : 'That already exists.';
  if (e.code === '42501' || /row-level security/.test(e.message || '')) return 'Your role can’t change ' + what + '.';
  if (e.code === '23503') return 'This is still used by other records, so it can’t be removed.';
  if (e.code === '23514') return 'One of the values is not allowed. Check the dates and numbers.';
  return e.message || 'Something went wrong.';
}
