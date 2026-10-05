'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { mayReassign, statusLockedBy, type PageCfg, type Row } from '@/lib/pages';
import { Button, Notice, SidePanel, Toolbar } from './ui';
import { FieldInput, friendlyError } from './Fields';
import { JobPapers } from './JobPapers';
import { FileField } from './FileField';
import { FileDown } from 'lucide-react';
import { RecordingExtras } from './RecordingExtras';
import { Confirm } from './kit/Confirm';
import { ResumeCompare } from './kit/ResumeCompare';
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
    v.custom = (row?.custom as Row) || {};
    return cfg.derive ? cfg.derive(v, s.refs) : v;
  });
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [missingKeys, setMissingKeys] = useState<string[]>([]);
  const [askClose, setAskClose] = useState(false);
  const saving = useRef(false); // blocks a second click before the first save returns
  const formRef = useRef<HTMLDivElement>(null);
  const initial = useRef<string>('');
  if (!initial.current) initial.current = JSON.stringify(values);
  const dirty = JSON.stringify(values) !== initial.current;
  // leaving the page with unsaved changes asks the browser to confirm
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const close = () => { if (dirty && !readOnlyAll()) setAskClose(true); else onClose(); };
  const readOnlyAll = () => !canWrite || !!cfg.readOnly;
  const isEmpty = (key: string) => values[key] == null || String(values[key]).trim() === '';
  // checked when the person leaves a required field
  const blurCheck = (key: string, required?: boolean) => (e: React.FocusEvent<HTMLElement>) => {
    if (!required || contactLocked(key) || e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    if (isEmpty(key) && !missingKeys.includes(key)) setMissingKeys((m) => [...m, key]);
  };
  const focusFirst = (keys: string[]) => requestAnimationFrame(() => {
    const el = keys.map((k) => formRef.current?.querySelector<HTMLElement>(`[data-field="${k}"]`)).find(Boolean);
    const ctl = el?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])');
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    ctl?.focus({ preventScroll: true });
  });
  const readOnly = !canWrite || !!cfg.readOnly;
  // the status is decided only by the assigned person (or their team head); reassigning has its own rule
  const lockedBy = cfg.assignee ? statusLockedBy(cfg, values, s.staff, s.refs.staff || []) : null;
  const assigneeLocked = !!cfg.assignee && !isNew && !mayReassign(cfg, row!, s.staff, s.refs.staff || []);
  const locked = (key: string) => (cfg.assignee?.status === key && !!lockedBy) || (cfg.assignee?.field === key && assigneeLocked);
  // a saved lead's mobile/email are never read back to the screen (only masked); they are shown, not edited, here
  const contactLocked = (key: string) => cfg.table === 'lead' && !isNew && (key === 'mobile' || key === 'email');
  const customFields = s.custom.filter((f) => f.page_id === cfg.id && (!cfg.readFrom || !!cfg.sameRows));
  const planTotal = cfg.id === 'quote' ? quoteAmount(values) : Number(values.total || 0);

  const set = (key: string, val: unknown) => { if (missingKeys.includes(key)) setMissingKeys((m) => m.filter((k) => k !== key)); setValues((old) => { const next = { ...old, [key]: val }; return cfg.derive ? cfg.derive(next, s.refs) : next; }); };

  const save = async () => {
    if (saving.current) return;
    const empty = fields.filter((f) => f.required && !contactLocked(f.key) && (values[f.key] == null || String(values[f.key]).trim() === ''));
    setMissingKeys(empty.map((f) => f.key));
    const missing = empty.map((f) => f.label);
    if (cfg.id === 'followups' && isNew && !values.lead_id && !values.candidate_id) missing.push('a lead or a candidate');
    if (missing.length) {
      setMsg({ tone: 'bad', text: 'Still needed: ' + missing.join(', ') + '.' });
      focusFirst(empty.length ? empty.map((f) => f.key) : ['lead_id']);
      return;
    }
    if (fields.some((f) => f.type === 'instalments')) {
      const inst = (values.instalments || []) as Instalment[];
      const sum = inst.reduce((a, i) => a + Number(i.amount || 0), 0);
      if (inst.length && (sum !== planTotal || inst.some((i) => !(Number(i.amount) > 0)))) { setMsg({ tone: 'bad', text: 'The instalments must each be above zero and add up to the final amount.' }); return; }
    }
    saving.current = true; setBusy(true); setMsg(null);
    const done = () => { saving.current = false; setBusy(false); };
    const payload: Row = {};
    fields.forEach((f) => { if (contactLocked(f.key)) return; if (!f.readOnly || cfg.derive) { const v = values[f.key]; payload[f.key] = typeof v === 'string' ? v.trim() || null : v; } });
    const db = supabase();
    if (cfg.id === 'users' && isNew) {
      const res = await fetch('/api/admin/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const out = await res.json();
      done();
      if (!res.ok) { setMsg({ tone: 'bad', text: out.error || 'Could not invite.' }); return; }
      onSaved(`${payload.full_name} invited. Temporary password: ${out.password} — share it privately and ask them to change it.`);
      return;
    }
    if (cfg.id === 'branding' && row) {
      const { error } = await db.from('setting').update({ value: payload.value, updated_by: s.staff.id, updated_at: new Date().toISOString() }).eq('key', row.key);
      done();
      if (error) { setMsg({ tone: 'bad', text: friendlyError(error) }); return; }
      onSaved('Saved.');
      return;
    }
    if (customFields.length) payload.custom = values.custom || {};
    // on a new record, leave out what was not filled so the database defaults apply
    const fresh = Object.fromEntries(Object.entries(payload).filter(([, v]) => v != null));
    const { error } = isNew ? await db.from(cfg.table).insert(fresh) : await db.from(cfg.table).update(payload).eq('id', row!.id);
    done();
    if (error) { setMsg({ tone: 'bad', text: friendlyError(error, 'this ' + cfg.kind.toLowerCase()) + ' Your entries are kept; fix it and save again.' }); return; }
    initial.current = JSON.stringify(values);
    onSaved(isNew ? cfg.kind + ' added.' : 'Saved.');
  };

  const remove = async () => {
    setBusy(true);
    const { error } = await supabase().from(cfg.table).delete().eq('id', row!.id);
    setBusy(false);
    if (error) { setMsg({ tone: 'bad', text: friendlyError(error) }); return; }
    onSaved(cfg.kind + ' deleted.');
  };

  return (
    <SidePanel kind={isNew ? 'New ' + cfg.kind.toLowerCase() : cfg.kind} title={isNew ? cfg.cta || 'New' : cfg.rowTitle(row!)} onClose={close}>
      <div ref={formRef} className="flex flex-col gap-4" onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !readOnly) { e.preventDefault(); save(); } }}>
        {fields.map((f) => (
          <FieldWrap key={f.key} field={f.key} invalid={missingKeys.includes(f.key)} onBlur={blurCheck(f.key, f.required)} asLabel={f.type !== 'person' && f.type !== 'instalments' && f.type !== 'file' && f.type !== 'tags' && !f.cards && !f.slider && !f.addable}>
            <span>{f.label}{f.required && <span className="text-badText" aria-hidden> *</span>}</span>
            {f.type === 'file'
              ? <FileField page={cfg.id} candidateId={values.candidate_id || null} value={values[f.key]} onChange={(v) => set(f.key, v)} disabled={readOnly} />
              : f.type === 'instalments'
              ? <InstalmentsEditor total={planTotal} value={values[f.key]} onChange={(v) => set(f.key, v)} disabled={readOnly} />
              : contactLocked(f.key)
              ? <div className="flex flex-col gap-1">
                  <div className="flex min-h-10 items-center rounded-[10px] bg-surface2 px-3 text-[13.5px] font-normal text-text">{String(row?.[f.key + '_masked'] || '—')}</div>
                  <span className="text-[12px] font-normal text-muted">Use Show in the quick panel to see it.</span>
                </div>
              : (readOnly || f.readOnly || locked(f.key)) && f.type !== 'person'
              ? <div className="flex flex-col gap-1">
                  <div className="flex min-h-10 items-center rounded-[10px] bg-surface2 px-3 text-[13.5px] font-normal text-text">{displayValue(values[f.key], f, s.refs)}</div>
                  {!readOnly && locked(f.key) && <span className="text-[12px] font-normal text-muted">{cfg.assignee!.status === f.key ? `Only ${lockedBy} (the ${cfg.assignee!.label}) or their team head can change this.` : 'Only Admin, the person assigned or their team head can reassign this.'}</span>}
                </div>
              : <FieldInput field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} disabled={readOnly} invalid={missingKeys.includes(f.key)} errorId={'err-' + cfg.id + '-' + f.key} />}
            {missingKeys.includes(f.key) && <span id={'err-' + cfg.id + '-' + f.key} className="text-[12px] font-medium text-badText">Please fill this in.</span>}
          </FieldWrap>
        ))}
      </div>
      {customFields.length > 0 && (
        <section aria-label="More details" className="flex flex-col gap-4 pt-2">
          <div className="text-[12px] font-medium text-muted">More details</div>
          {customFields.map((f) => {
            const v = (values.custom || {})[f.key];
            const setC = (x: unknown) => set('custom', { ...(values.custom || {}), [f.key]: x === '' ? null : x });
            const cls = 'h-10 w-full rounded-[10px] px-3 text-[13.5px] font-normal';
            return (
              <label key={f.id} className="flex flex-col gap-1.5 text-[12px] font-medium text-text2">{f.label}
                {readOnly ? <div className="flex min-h-10 items-center rounded-[10px] bg-surface2 px-3 text-[13.5px] font-normal text-text">{v === true ? 'Yes' : v === false ? 'No' : v ?? '—'}</div>
                  : f.type === 'Yes / No' ? <select className={cls} value={v === true ? 'Yes' : v === false ? 'No' : ''} onChange={(e) => setC(e.target.value === '' ? null : e.target.value === 'Yes')}><option value="">—</option><option>Yes</option><option>No</option></select>
                  : f.type === 'Choice' ? <select className={cls} value={v ?? ''} onChange={(e) => setC(e.target.value)}><option value="">—</option>{(f.options || '').split(',').map((o) => o.trim()).filter(Boolean).map((o) => <option key={o}>{o}</option>)}</select>
                  : <input className={cls} type={f.type === 'Number' ? 'number' : f.type === 'Date' ? 'date' : 'text'} value={v ?? ''} onChange={(e) => setC(f.type === 'Number' && e.target.value !== '' ? Number(e.target.value) : e.target.value)} />}
              </label>
            );
          })}
        </section>
      )}
      {cfg.id === 'resume' && row?.id && row.candidate_id && <ResumeCompare candidateId={String(row.candidate_id)} currentId={String(row.id)} />}
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
      {cfg.id === 'quote' && row?.id && (
        <a href={'/api/pdf/quote/' + row.id} target="_blank" rel="noopener" className="btn inline-flex h-10 items-center justify-center gap-2 rounded-[10px] border border-line2 bg-surface px-4 text-[13.5px] font-medium hover:bg-surface2">
          <FileDown size={16} aria-hidden /> Fee quote PDF
        </a>
      )}
      {cfg.id === 'payment' && row?.id && row.status === 'Received' && (
        <a href={'/api/pdf/receipt/' + row.id} target="_blank" rel="noopener" className="btn inline-flex h-10 items-center justify-center gap-2 rounded-[10px] border border-line2 bg-surface px-4 text-[13.5px] font-medium hover:bg-surface2">
          <FileDown size={16} aria-hidden /> Receipt PDF
        </a>
      )}
      {cfg.id === 'recordings' && row?.id && <RecordingExtras row={row} values={values} setValue={set} onDone={onSaved} />}
      {cfg.id === 'deliveries' && row?.id && (
        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-medium text-muted">What was sent</div>
          <pre className="max-h-72 overflow-auto rounded-[10px] bg-surface2 p-3 text-[11.5px] leading-relaxed">{JSON.stringify(row.payload, null, 2)}</pre>
          {s.can('deliveries', 'w') && row.status !== 'Sent' && (
            <Button variant="primary" disabled={busy} onClick={async () => {
              setBusy(true); const { error } = await supabase().rpc('retry_event', { eid: row.id }); setBusy(false);
              if (error) setMsg({ tone: 'bad', text: friendlyError(error) }); else onSaved('Queued to send again within a minute.');
            }}>Retry now</Button>
          )}
        </div>
      )}
      {cfg.id === 'users' && row?.id && !readOnly && row.id !== s.staff.id && (
        <Button variant="outline" disabled={busy} onClick={async () => {
          setBusy(true);
          const res = await fetch('/api/admin/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staff_id: row.id }) });
          const out = await res.json(); setBusy(false);
          setMsg(res.ok ? { tone: 'good', text: `New temporary password: ${out.password} — share it privately. They must change it when they sign in.` } : { tone: 'bad', text: out.error || 'Could not reset.' });
        }}>Reset password</Button>
      )}
      {readOnly && !cfg.readOnly && <div className="text-[13px] text-text2">View only for {s.staff.role}. Ask an admin if this needs changing.</div>}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {askClose && (
        <div role="alertdialog" aria-label="Unsaved changes" className="flex flex-col gap-2 rounded-[10px] bg-warnBg p-3 text-[13px] text-warnText">
          <div className="font-medium">You have changes that are not saved. Close and lose them?</div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" autoFocus onClick={() => setAskClose(false)}>Keep editing</Button>
            <Button variant="outline" onClick={onClose}>Discard changes</Button>
          </div>
        </div>
      )}
      {!readOnly && (
        <Toolbar className="mt-auto pt-2"
          start={!isNew && s.staff.role === 'Admin' && !['users', 'branding'].includes(cfg.id) ? (
            <Confirm disabled={busy} align="left" onYes={remove} title={'Delete this ' + cfg.kind.toLowerCase() + '?'} body={cfg.rowTitle(row!) + ' will be removed for good. This cannot be undone.'} yes="Delete for good"
              className="btn inline-flex h-10 items-center rounded-[10px] border border-transparent px-3 text-[13.5px] font-medium text-badText hover:bg-badBg disabled:opacity-50">Delete</Confirm>
          ) : undefined}
          primary={<Button variant="primary" loading={busy} onClick={save}>{isNew ? cfg.id === 'users' ? 'Send invite' : 'Save' : 'Save changes'}</Button>}>
          <Button variant="outline" onClick={close}>Cancel</Button>
        </Toolbar>
      )}
    </SidePanel>
  );
}

// A person picker swaps its own buttons in and out, so it must not sit inside a <label> (the label would click them).
function FieldWrap({ asLabel, field, invalid, onBlur, children }: { asLabel: boolean; field: string; invalid?: boolean; onBlur?: (e: React.FocusEvent<HTMLElement>) => void; children: React.ReactNode }) {
  const cls = 'flex flex-col gap-1.5 text-[12px] font-medium text-text2';
  return asLabel ? <label className={cls} data-field={field} data-invalid={invalid || undefined} onBlur={onBlur}>{children}</label> : <div className={cls} data-field={field} data-invalid={invalid || undefined} onBlur={onBlur}>{children}</div>;
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
