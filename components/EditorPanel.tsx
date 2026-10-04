'use client';
import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { PageCfg, Row } from '@/lib/pages';
import { Button, Notice, SidePanel } from './ui';
import { FieldInput, friendlyError } from './Fields';
import { JobPapers } from './JobPapers';
import { FileField } from './FileField';
import { InstalmentsEditor, quoteAmount, type Instalment } from './InstalmentsEditor';

/** Create form and record editor in one: `row` null (or a summary row with no id yet) means a new record, prefilled from the row. */
export function EditorPanel({ cfg, row, canWrite, onClose, onSaved }: { cfg: PageCfg; row: Row | null; canWrite: boolean; onClose: () => void; onSaved: (msg: string) => void }) {
  const s = useSession();
  const isNew = !row?.id;
  const fields = useMemo(() => (cfg.fields || []).filter((f) => isNew || !f.createOnly), [cfg, isNew]);
  const [values, setValues] = useState<Row>(() => {
    const v: Row = {};
    const AUTO = ['status', 'stage', 'plan', 'pf_status', 'level', 'direction', 'discount_pct', 'method', 'connection'];
    (cfg.fields || []).forEach((f) => {
      if (row?.id) { v[f.key] = row[f.key] ?? null; return; }
      if (row && row[f.key] != null) { v[f.key] = row[f.key]; return; }
      const first = f.type === 'select' && AUTO.includes(f.key) ? (f.options || s.lists[f.list || ''] || [])[0] ?? null : null;
      v[f.key] = f.def ? f.def({ me: s.staff.id }) : first;
    });
    return cfg.derive ? cfg.derive(v, s.refs) : v;
  });
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const readOnly = !canWrite || !!cfg.readOnly;
  const planTotal = cfg.id === 'quote' ? quoteAmount(values) : Number(values.total || 0);

  const set = (key: string, val: unknown) => setValues((old) => { const next = { ...old, [key]: val }; return cfg.derive ? cfg.derive(next, s.refs) : next; });

  const save = async () => {
    const missing = fields.filter((f) => f.required && (values[f.key] == null || String(values[f.key]).trim() === '')).map((f) => f.label);
    if (cfg.id === 'followups' && isNew && !values.lead_id && !values.candidate_id) missing.push('a lead or a candidate');
    if (missing.length) { setMsg({ tone: 'bad', text: 'Still needed: ' + missing.join(', ') + '.' }); return; }
    if (fields.some((f) => f.type === 'instalments')) {
      const inst = (values.instalments || []) as Instalment[];
      const sum = inst.reduce((a, i) => a + Number(i.amount || 0), 0);
      if (inst.length && (sum !== planTotal || inst.some((i) => !(Number(i.amount) > 0)))) { setMsg({ tone: 'bad', text: 'The instalments must each be above zero and add up to the final amount.' }); return; }
    }
    setBusy(true); setMsg(null);
    const payload: Row = {};
    fields.forEach((f) => { if (!f.readOnly || cfg.derive) { const v = values[f.key]; payload[f.key] = typeof v === 'string' ? v.trim() || null : v; } });
    const db = supabase();
    if (cfg.id === 'users' && isNew) {
      const res = await fetch('/api/admin/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const out = await res.json();
      setBusy(false);
      if (!res.ok) { setMsg({ tone: 'bad', text: out.error || 'Could not invite.' }); return; }
      onSaved(`${payload.full_name} invited. Temporary password: ${out.password} — share it privately and ask them to change it.`);
      return;
    }
    if (cfg.id === 'branding' && row) {
      const { error } = await db.from('setting').update({ value: payload.value, updated_by: s.staff.id, updated_at: new Date().toISOString() }).eq('key', row.key);
      setBusy(false);
      if (error) { setMsg({ tone: 'bad', text: friendlyError(error) }); return; }
      onSaved('Saved.');
      return;
    }
    // on a new record, leave out what was not filled so the database defaults apply
    const fresh = Object.fromEntries(Object.entries(payload).filter(([, v]) => v != null));
    const { error } = isNew ? await db.from(cfg.table).insert(fresh) : await db.from(cfg.table).update(payload).eq('id', row!.id);
    setBusy(false);
    if (error) { setMsg({ tone: 'bad', text: friendlyError(error, 'this ' + cfg.kind.toLowerCase()) }); return; }
    onSaved(isNew ? cfg.kind + ' added.' : 'Saved.');
  };

  const remove = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setBusy(true);
    const { error } = await supabase().from(cfg.table).delete().eq('id', row!.id);
    setBusy(false);
    if (error) { setMsg({ tone: 'bad', text: friendlyError(error) }); setConfirmDelete(false); return; }
    onSaved(cfg.kind + ' deleted.');
  };

  return (
    <SidePanel kind={isNew ? 'New ' + cfg.kind.toLowerCase() : cfg.kind} title={isNew ? cfg.cta || 'New' : cfg.rowTitle(row!)} onClose={onClose}>
      <div className="flex flex-col gap-2.5">
        {fields.map((f) => (
          <FieldWrap key={f.key} asLabel={f.type !== 'person' && f.type !== 'instalments' && f.type !== 'file' && !f.addable}>
            <span>{f.label}{f.required && <span className="text-badText"> *</span>}</span>
            {f.type === 'file'
              ? <FileField page={cfg.id} candidateId={values.candidate_id || null} value={values[f.key]} onChange={(v) => set(f.key, v)} disabled={readOnly} />
              : f.type === 'instalments'
              ? <InstalmentsEditor total={planTotal} value={values[f.key]} onChange={(v) => set(f.key, v)} disabled={readOnly} />
              : (readOnly || f.readOnly) && f.type !== 'person'
              ? <div className="flex min-h-[42px] items-center rounded-[10px] bg-surface2 px-3 text-sm font-normal text-text">{displayValue(values[f.key], f, s.refs)}</div>
              : <FieldInput field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} disabled={readOnly} />}
          </FieldWrap>
        ))}
      </div>
      {cfg.id === 'jobdocs' && row && <JobPapers job={{ ...row, ...values }} canWrite={!readOnly} />}
      {cfg.id === 'quote' && <QuoteMath values={values} />}
      {cfg.id === 'quote' && row?.id && row.needs_approval && (
        <div className="flex flex-col gap-2 rounded-[10px] bg-warnBg p-3 text-[13px] text-warnText">
          <div className="font-medium">Waiting for the Sales head’s approval. It can’t be marked Accepted until then.</div>
          {(s.staff.role === 'Admin' || (s.staff.role === 'Sales' && s.staff.level === 'Head')) && (
            <Button variant="primary" disabled={busy} onClick={async () => {
              setBusy(true);
              const { error } = await supabase().rpc('approve_quote', { qid: row.id });
              setBusy(false);
              if (error) setMsg({ tone: 'bad', text: friendlyError(error) }); else onSaved('Quote approved.');
            }}>Approve this discount</Button>
          )}
        </div>
      )}
      {cfg.id === 'users' && row?.id && !readOnly && row.id !== s.staff.id && (
        <Button disabled={busy} onClick={async () => {
          setBusy(true);
          const res = await fetch('/api/admin/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staff_id: row.id }) });
          const out = await res.json(); setBusy(false);
          setMsg(res.ok ? { tone: 'good', text: `New temporary password: ${out.password} — share it privately. They must change it when they sign in.` } : { tone: 'bad', text: out.error || 'Could not reset.' });
        }}>Reset password</Button>
      )}
      {readOnly && <div className="text-[13px] text-text2">View only for {s.staff.role}. Ask an admin if this needs changing.</div>}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {!readOnly && (
        <div className="flex flex-col gap-2">
          <Button variant="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : isNew ? cfg.id === 'users' ? 'Send invite' : 'Save' : 'Save changes'}</Button>
          {!isNew && s.staff.role === 'Admin' && !['users', 'branding'].includes(cfg.id) && (
            <Button variant="danger" disabled={busy} onClick={remove}>{confirmDelete ? 'Tap again to delete for good' : 'Delete'}</Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
        </div>
      )}
    </SidePanel>
  );
}

// A person picker swaps its own buttons in and out, so it must not sit inside a <label> (the label would click them).
function FieldWrap({ asLabel, children }: { asLabel: boolean; children: React.ReactNode }) {
  const cls = 'flex flex-col gap-1 text-xs font-medium text-text2';
  return asLabel ? <label className={cls}>{children}</label> : <div className={cls}>{children}</div>;
}

function displayValue(v: unknown, f: { type: string; ref?: string }, refs: Record<string, { id: string; label: string }[]>) {
  if (v == null || v === '') return '—';
  if (f.type === 'ref') return refs[f.ref || '']?.find((r) => r.id === v)?.label || '—';
  if (f.type === 'number') return Number(v).toLocaleString('en-IN');
  return String(v);
}

function QuoteMath({ values }: { values: Row }) {
  const list = Number(values.list_price || 0), d = Number(values.discount_pct || 0);
  if (!list) return null;
  const amount = quoteAmount(values);
  const inr = (n: number) => '₹' + n.toLocaleString('en-IN');
  return (
    <div className="rounded-[10px] bg-surface2 p-3 text-[13px] leading-relaxed">
      <div><span className="text-muted">Final amount</span> <span className="num font-semibold">{inr(amount)}</span>{d > 0 && <span className="text-muted"> · saves {inr(list - amount)}</span>}</div>
      {d > 10 && <div className="mt-1 font-medium text-warnText">Above the discount limit: it will be marked for the Sales head to approve.</div>}
    </div>
  );
}
