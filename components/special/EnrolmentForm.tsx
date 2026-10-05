'use client';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { Plus, Trash2 } from 'lucide-react';
import { Button, IconButton, Notice, Toolbar, cx } from '../ui';
import { PageHeader } from '../kit/PageHeader';
import { PersonSearch, friendlyError } from '../Fields';
import { PhoneInput } from '../PhoneInput';

const ctl = 'h-11 w-full px-3 text-sm';
const PROFILE: [string, string][] = [['date_of_birth', 'Date of birth (as in SSC)'], ['marital_status', 'Marital status'], ['identification_marks', 'Identification marks'], ['referred_by', 'Referred by']];
const GROUPS: Record<string, { title: string; fields: [string, string][] }> = {
  contact: { title: 'Contact and address', fields: [['email', 'Email'], ['mobile', 'Mobile'], ['alternate_mobile', 'Alternate mobile'], ['city', 'City'], ['address', 'Permanent address'], ['current_address', 'Current address']] },
  family: { title: 'Family', fields: [['father', 'Father’s name'], ['father_mobile', 'Father’s mobile'], ['mother', 'Mother’s name'], ['mother_mobile', 'Mother’s mobile']] },
  identity: { title: 'Identity', fields: [['pan', 'PAN'], ['aadhaar', 'Aadhaar'], ['passport', 'Passport']] },
  bank: { title: 'Bank', fields: [['bank', 'Bank'], ['account', 'Account number'], ['ifsc', 'IFSC'], ['holder', 'Account holder']] },
};
const EDU: [string, string][] = [['level', 'Level'], ['institution', 'Institution'], ['board', 'Board / university'], ['course', 'Course'], ['years', 'Years'], ['marks', 'Marks %']];
const EXP: [string, string][] = [['company', 'Company'], ['role', 'Role'], ['joined', 'Joined'], ['last_day', 'Last day'], ['ctc', 'CTC']];

export function EnrolmentForm() {
  const s = useSession();
  const canWrite = s.can('enrolform', 'w');
  // ?candidate=<id> opens that student's data sheet directly (quick panel "Open data sheet")
  const params = useSearchParams();
  const [id, setId] = useState<string | null>(params.get('candidate'));
  const [c, setC] = useState<Row | null>(null);
  const [priv, setPriv] = useState<Row | null>(null);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const loaded = useRef('');
  const [nameErr, setNameErr] = useState(false);
  const snap = () => JSON.stringify([c?.full_name, c?.profile, c?.education, c?.experience, priv]);
  const dirty = !!c && !!priv && !!loaded.current && snap() !== loaded.current;
  useEffect(() => { if (c && priv && !loaded.current) loaded.current = snap(); }); // eslint-disable-line react-hooks/exhaustive-deps
  // leaving the page with unsaved changes asks the browser to confirm
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const pick = (next: string | null) => {
    if (dirty && !window.confirm('The data sheet has changes that are not saved. Open another candidate and lose them?')) return;
    setId(next);
  };

  useEffect(() => {
    setC(null); setPriv(null); setMsg(null); loaded.current = ''; setNameErr(false);
    if (!id) return;
    const db = supabase();
    Promise.all([db.from('candidate').select('*, program:program_id(name), batch:batch_id(code)').eq('id', id).single(), db.rpc('candidate_private_get', { cid: id })]).then(([one, p]) => {
      setC(one.data); setPriv(p.data);
    });
  }, [id]);

  const setProfile = (k: string, v: string) => setC((old) => old && ({ ...old, profile: { ...old.profile, [k]: v } }));
  const setGroup = (g: string, k: string, v: string) => setPriv((old) => old && ({ ...old, [g]: { ...(old[g] || {}), [k]: v } }));
  const setList = (key: 'education' | 'experience', i: number, k: string, v: string) => setC((old) => { if (!old) return old; const list = [...(old[key] || [])]; list[i] = { ...list[i], [k]: v }; return { ...old, [key]: list }; });
  const addRow = (key: 'education' | 'experience') => setC((old) => old && ({ ...old, [key]: [...(old[key] || []), {}] }));
  const dropRow = (key: 'education' | 'experience', i: number) => setC((old) => old && ({ ...old, [key]: (old[key] || []).filter((_: Row, j: number) => j !== i) }));

  const filled = () => {
    if (!c || !priv) return 0;
    const all: unknown[] = [c.full_name, ...PROFILE.map(([k]) => c.profile?.[k]), (c.education || []).length ? 'x' : ''];
    Object.entries(GROUPS).forEach(([g, def]) => { if (priv.modes[g] === 'f') def.fields.forEach(([k]) => all.push(priv[g]?.[k])); });
    return Math.round((100 * all.filter((x) => x != null && String(x).trim() !== '').length) / all.length);
  };

  const save = async () => {
    if (!c || !priv || saving.current) return;
    if (!String(c.full_name || '').trim()) { setNameErr(true); setMsg({ tone: 'bad', text: 'Still needed: full name.' }); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-field="full_name"] input')?.focus()); return; }
    saving.current = true; setBusy(true); setMsg(null);
    const stop = () => { saving.current = false; setBusy(false); };
    const db = supabase();
    const up = await db.from('candidate').update({ full_name: c.full_name, profile: c.profile, education: c.education, experience: c.experience }).eq('id', c.id);
    if (up.error) { stop(); setMsg({ tone: 'bad', text: friendlyError(up.error, 'this data sheet') + ' Nothing was lost on screen; try saving again.' }); return; }
    for (const g of Object.keys(GROUPS)) {
      if (priv.modes[g] !== 'f') continue;
      const { error } = await db.rpc('candidate_private_set', { cid: c.id, grp: g, data: priv[g] || {} });
      if (error) { stop(); setMsg({ tone: 'bad', text: GROUPS[g].title + ': ' + friendlyError(error) + ' The other parts were saved; your entries are still here.' }); return; }
    }
    stop();
    loaded.current = snap();
    setMsg({ tone: 'good', text: `Data sheet saved for ${c.full_name}. Profile is ${filled()}% complete.` });
  };

  return (
    <main className="flex flex-1 flex-col gap-6 overflow-y-auto p-4 md:p-6">
      <PageHeader title="Enrolment form" description={'The full data sheet, filled with the student after they enrol.' + (canWrite ? '' : ' View only for ' + s.staff.role + '.')} />
      <div className="flex max-w-[980px] flex-col gap-4">
        <section className="rounded-[14px] bg-surface p-4 shadow-[var(--shadow-1)]">
          <h2 className="mb-4 text-[15px] font-semibold">Candidate</h2>
          <div className="grid items-end gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            <div className="flex flex-col gap-1 text-xs font-medium text-text2">Enrolled candidate<PersonSearch kind="candidate" value={id} onChange={pick} /></div>
            {c && <div className="truncate rounded-lg bg-surface2 px-3 py-2.5 text-[13.5px] text-text2">{c.program?.name || 'No program'} · {c.batch?.code || 'No batch yet'} · {c.code}</div>}
            {c && <div className="num rounded-lg bg-accentSoft px-3 py-2.5 text-[13.5px] font-semibold text-accentText">Profile {filled()}% complete</div>}
          </div>
        </section>

        {!id && <div className="rounded-[14px] bg-surface2 p-6 text-[13.5px] text-text2">Find the candidate above to open their data sheet. Candidates appear here once their lead is marked Converted.</div>}

        {c && priv && (
          <>
            <Section title="Personal" tag="Everyone">
              <div data-field="full_name" className="flex flex-col gap-1">
                <Text label="Full name" required value={c.full_name} onChange={(v) => { setC({ ...c, full_name: v }); if (v.trim()) setNameErr(false); }} disabled={!canWrite} invalid={nameErr} onBlur={() => setNameErr(!String(c.full_name || '').trim())} />
                {nameErr && <span id="enr-err-full_name" className="text-[12px] font-medium text-badText">Enter the full name.</span>}
              </div>
              {PROFILE.map(([k, l]) => k === 'marital_status'
                ? <Choice key={k} label={l} value={c.profile?.[k] || ''} options={s.lists.marital_status || []} onChange={(v) => setProfile(k, v)} disabled={!canWrite} />
                : <Text key={k} label={l} value={c.profile?.[k] || ''} onChange={(v) => setProfile(k, v)} disabled={!canWrite} type={k === 'date_of_birth' ? 'date' : 'text'} />)}
            </Section>
            {Object.entries(GROUPS).map(([g, def]) => {
              const mode = priv.modes[g];
              return (
                <Section key={g} title={def.title} tag={mode === 'f' ? 'You can edit' : mode === 'm' ? 'Masked for ' + s.staff.role : 'Hidden for ' + s.staff.role} tone={mode === 'f' ? 'good' : 'warn'}>
                  {mode === 'h' ? <div className="col-span-full text-[13px] text-text2">Your role can’t see or fill this part. Another team completes it.</div>
                    : def.fields.map(([k, l]) => <Text key={k} label={l} value={priv[g]?.[k] || ''} onChange={(v) => setGroup(g, k, v)} disabled={!canWrite || mode !== 'f'} />)}
                </Section>
              );
            })}
            <Repeat title="Education" cols={EDU} choices={{ level: s.lists.education_level || [] }} rows={c.education || []} onChange={(i, k, v) => setList('education', i, k, v)} onAdd={() => addRow('education')} onDrop={(i) => dropRow('education', i)} disabled={!canWrite} addLabel="Add education" />
            <Repeat title="Work experience" cols={EXP} rows={c.experience || []} onChange={(i, k, v) => setList('experience', i, k, v)} onAdd={() => addRow('experience')} onDrop={(i) => dropRow('experience', i)} disabled={!canWrite} addLabel="Add a company" empty="No work experience. Leave empty for a fresher." />
            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
            <Toolbar start={dirty ? <span className="text-[13px] text-warnText">Unsaved changes</span> : undefined} primary={<Button variant="primary" loading={busy} disabled={!canWrite} onClick={save}>Save data sheet</Button>} />
          </>
        )}
      </div>
    </main>
  );
}

function Section({ title, tag, tone, children }: { title: string; tag: string; tone?: 'good' | 'warn'; children: React.ReactNode }) {
  return (
    <section className="rounded-[14px] bg-surface p-4 shadow-[var(--shadow-1)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <span className={cx('shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold', tone === 'warn' ? 'bg-warnBg text-warnText' : tone === 'good' ? 'bg-goodBg text-goodText' : 'bg-surface2 text-text2')}>{tag}</span>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>{children}</div>
    </section>
  );
}

function Text({ label, value, onChange, disabled, type = 'text', required, invalid, onBlur }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean; type?: string; required?: boolean; invalid?: boolean; onBlur?: () => void }) {
  if (/mobile/i.test(label) && !disabled) return <div className="flex flex-col gap-1 text-xs font-medium text-text2">{label}<PhoneInput label={label} value={value} onChange={onChange} /></div>;
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-text2">
      <span>{label}{required && <span className="text-badText" aria-hidden> *</span>}</span>
      <input type={type} className={cx(ctl, invalid && 'ring-2 ring-badText')} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} onBlur={onBlur}
        aria-required={required || undefined} aria-invalid={invalid || undefined} aria-describedby={invalid ? 'enr-err-full_name' : undefined} max={type === 'date' ? new Date().toLocaleDateString('en-CA') : undefined} />
    </label>
  );
}

/** A staff-editable list (Dropdowns page) instead of free typing; keeps an old typed value visible. */
function Choice({ label, value, options, onChange, disabled }: { label: string; value: string; options: string[]; onChange: (v: string) => void; disabled?: boolean }) {
  const opts = value && !options.includes(value) ? [...options, value] : options;
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-text2">{label}
      <select className={ctl} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}><option value="">Select</option>{opts.map((o) => <option key={o}>{o}</option>)}</select>
    </label>
  );
}

function Repeat({ title, cols, rows, onChange, onAdd, onDrop, disabled, addLabel, empty, choices = {} }: { choices?: Record<string, string[]>; title: string; cols: [string, string][]; rows: Row[]; onChange: (i: number, k: string, v: string) => void; onAdd: () => void; onDrop: (i: number) => void; disabled?: boolean; addLabel: string; empty?: string }) {
  return (
    <section className="rounded-[14px] bg-surface p-4 shadow-[var(--shadow-1)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {!disabled && <Button variant="quiet" size="sm" leftIcon={<Plus size={15} />} onClick={onAdd}>{addLabel}</Button>}
      </div>
      {rows.length === 0 && <div className="text-[13px] text-text2">{empty || 'Nothing added yet.'}</div>}
      {rows.map((r, i) => (
        <div key={i} className="mb-2 grid items-end gap-2 rounded-[10px] bg-surface2 p-3" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(130px, 1fr))` }}>
          {cols.map(([k, l]) => {
            const list = choices[k];
            const opts = list && r[k] && !list.includes(r[k]) ? [...list, r[k]] : list;
            return (
              <label key={k} className="flex flex-col gap-1 text-[11px] font-medium text-text2">{l}
                {opts?.length
                  ? <select className="h-10 w-full px-2.5 text-[13px]" value={r[k] || ''} disabled={disabled} onChange={(e) => onChange(i, k, e.target.value)}><option value="">Select</option>{opts.map((o) => <option key={o}>{o}</option>)}</select>
                  : <input className="h-10 w-full px-2.5 text-[13px]" value={r[k] || ''} disabled={disabled} inputMode={k === 'marks' || k === 'ctc' ? 'decimal' : undefined} onChange={(e) => onChange(i, k, e.target.value)} />}
              </label>
            );
          })}
          {!disabled && <div className="flex justify-end"><IconButton aria-label={`Remove ${title.toLowerCase()} row ${i + 1}`} icon={<Trash2 size={16} />} variant="danger" onClick={() => onDrop(i)} /></div>}
        </div>
      ))}
    </section>
  );
}
