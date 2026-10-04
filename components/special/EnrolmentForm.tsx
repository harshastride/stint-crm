'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { Button, Notice, cx } from '../ui';
import { PageHeader } from '../ListPage';
import { PersonSearch } from '../Fields';

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
  const [id, setId] = useState<string | null>(null);
  const [c, setC] = useState<Row | null>(null);
  const [priv, setPriv] = useState<Row | null>(null);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setC(null); setPriv(null); setMsg(null);
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
    if (!c || !priv) return;
    setBusy(true); setMsg(null);
    const db = supabase();
    const up = await db.from('candidate').update({ full_name: c.full_name, profile: c.profile, education: c.education, experience: c.experience }).eq('id', c.id);
    if (up.error) { setBusy(false); setMsg({ tone: 'bad', text: up.error.message }); return; }
    for (const g of Object.keys(GROUPS)) {
      if (priv.modes[g] !== 'f') continue;
      const { error } = await db.rpc('candidate_private_set', { cid: c.id, grp: g, data: priv[g] || {} });
      if (error) { setBusy(false); setMsg({ tone: 'bad', text: GROUPS[g].title + ': ' + error.message }); return; }
    }
    setBusy(false);
    setMsg({ tone: 'good', text: `Data sheet saved for ${c.full_name}. Profile is ${filled()}% complete.` });
  };

  return (
    <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
      <PageHeader group="Front desk" title="Enrolment form" purpose="The full data sheet, filled with the student after they enrol." scope={s.staff.role + (canWrite ? ' · can edit' : ' · view only')} />
      <div className="flex max-w-[980px] flex-col gap-3">
        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-3 text-base font-semibold">Candidate</h2>
          <div className="grid items-end gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            <div className="flex flex-col gap-1 text-xs font-medium text-text2">Enrolled candidate<PersonSearch kind="candidate" value={id} onChange={setId} /></div>
            {c && <div className="rounded-[10px] bg-surface2 px-3 py-2.5 text-sm">{c.program?.name || 'No program'} · {c.batch?.code || 'No batch yet'} · {c.code}</div>}
            {c && <div className="num rounded-[10px] bg-accentSoft px-3 py-2.5 text-sm font-semibold text-accentText">Profile {filled()}% complete</div>}
          </div>
        </section>

        {!id && <div className="rounded-xl border border-line bg-surface p-6 text-text2">Find the candidate above to open their data sheet. Candidates appear here once their lead is marked Converted.</div>}

        {c && priv && (
          <>
            <Section title="Personal" tag="Everyone">
              <Text label="Full name" value={c.full_name} onChange={(v) => setC({ ...c, full_name: v })} disabled={!canWrite} />
              {PROFILE.map(([k, l]) => <Text key={k} label={l} value={c.profile?.[k] || ''} onChange={(v) => setProfile(k, v)} disabled={!canWrite} type={k === 'date_of_birth' ? 'date' : 'text'} />)}
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
            <Repeat title="Education" cols={EDU} rows={c.education || []} onChange={(i, k, v) => setList('education', i, k, v)} onAdd={() => addRow('education')} onDrop={(i) => dropRow('education', i)} disabled={!canWrite} addLabel="Add education" />
            <Repeat title="Work experience" cols={EXP} rows={c.experience || []} onChange={(i, k, v) => setList('experience', i, k, v)} onAdd={() => addRow('experience')} onDrop={(i) => dropRow('experience', i)} disabled={!canWrite} addLabel="Add a company" empty="No work experience. Leave empty for a fresher." />
            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
            <div><Button variant="primary" disabled={busy || !canWrite} onClick={save}>{busy ? 'Saving…' : 'Save data sheet'}</Button></div>
          </>
        )}
      </div>
    </main>
  );
}

function Section({ title, tag, tone, children }: { title: string; tag: string; tone?: 'good' | 'warn'; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className={cx('rounded-full px-2.5 py-1 text-[11px] font-semibold', tone === 'warn' ? 'bg-warnBg text-warnText' : tone === 'good' ? 'bg-goodBg text-goodText' : 'bg-surface2 text-text2')}>{tag}</span>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>{children}</div>
    </section>
  );
}

function Text({ label, value, onChange, disabled, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean; type?: string }) {
  return <label className="flex flex-col gap-1 text-xs font-medium text-text2">{label}<input type={type} className={ctl} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} /></label>;
}

function Repeat({ title, cols, rows, onChange, onAdd, onDrop, disabled, addLabel, empty }: { title: string; cols: [string, string][]; rows: Row[]; onChange: (i: number, k: string, v: string) => void; onAdd: () => void; onDrop: (i: number) => void; disabled?: boolean; addLabel: string; empty?: string }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">{title}</h2>
        {!disabled && <button type="button" onClick={onAdd} className="min-h-[36px] rounded-lg border border-line2 bg-surface px-3 text-[13px] font-medium">+ {addLabel}</button>}
      </div>
      {rows.length === 0 && <div className="text-[13px] text-text2">{empty || 'Nothing added yet.'}</div>}
      {rows.map((r, i) => (
        <div key={i} className="mb-2 grid items-end gap-2 rounded-[10px] bg-surface2 p-2.5" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(130px, 1fr))` }}>
          {cols.map(([k, l]) => <label key={k} className="flex flex-col gap-1 text-[11px] font-medium text-text2">{l}<input className="h-10 w-full px-2.5 text-[13px]" value={r[k] || ''} disabled={disabled} onChange={(e) => onChange(i, k, e.target.value)} /></label>)}
          {!disabled && <button type="button" onClick={() => onDrop(i)} className="h-10 rounded-lg border border-line2 bg-surface text-[13px] font-medium text-badText">Remove</button>}
        </div>
      ))}
    </section>
  );
}
