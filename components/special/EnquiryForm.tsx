'use client';
import Link from 'next/link';
import { RadioCards } from '../kit/RadioCards';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { Button, Notice, Toolbar } from '../ui';
import { PageHeader } from '../kit/PageHeader';
import { PhoneInput, phoneProblem } from '../PhoneInput';
import { VoiceInput, appendText } from '../kit/VoiceInput';

const blank = { full_name: '', mobile: '', email: '', city: '', program_id: '', course_other: '', preferred_mode: '', preferred_start: '', currently: '', source_id: '', referred_by: '', notes: '', consent: false };
const ctl = 'h-11 w-full px-3 text-sm aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-badText';
const Err = ({ id, text }: { id: string; text?: string }) => text ? <span id={id} className="text-[12px] font-medium text-badText">{text}</span> : null;

// A lead with exactly this 10-digit mobile (searched in the database; the number itself is never read back).
async function findByMobile(mobile: string): Promise<Row | null> {
  const { data } = await supabase().rpc('search_people', { p_kind: 'lead', p_term: mobile, p_limit: 1 });
  return ((data as Row[]) || [])[0] || null;
}

export function EnquiryForm() {
  const s = useSession();
  const walkIn = s.refs.lead_source.find((x) => /walk-in/i.test(x.label))?.id || '';
  const [v, setV] = useState<Row>({ ...blank, source_id: walkIn });
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string; id?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [err, setErr] = useState<Record<string, string>>({});
  const saving = useRef(false);
  const formRef = useRef<HTMLDivElement>(null);
  const dirty = !!(String(v.full_name).trim() || String(v.mobile).trim() || v.program_id || String(v.notes).trim());
  // leaving the page half-way asks the browser to confirm
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const mobileProblem = (raw: string) => { const m = raw.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''); return !m ? 'Enter their mobile.' : m.length !== 10 || phoneProblem(m) ? 'Use a 10-digit mobile starting with 6–9.' : ''; };
  const check: Record<string, () => string> = {
    full_name: () => (String(v.full_name).trim() ? '' : 'Enter their name.'),
    mobile: () => mobileProblem(String(v.mobile)),
    program_id: () => (v.program_id ? '' : 'Pick the course they want (or Other).'),
    course_other: () => (v.program_id === '__other' && !String(v.course_other).trim() ? 'Type the course they asked for.' : ''),
  };
  const blur = (k: string) => () => setErr((e) => ({ ...e, [k]: check[k]() }));
  const fail = (keys: string[]) => {
    const found = Object.fromEntries(keys.map((k) => [k, check[k]()]).filter(([, t]) => t));
    setErr((e) => ({ ...e, ...found }));
    const first = keys.find((k) => found[k]);
    if (first) requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(`[data-field="${first}"] input, [data-field="${first}"] select`)?.focus());
    return !!first;
  };
  const a = (k: string) => ({ 'aria-invalid': !!err[k] || undefined, 'aria-describedby': err[k] ? 'enq-err-' + k : undefined });
  const canWrite = s.can('enquiry', 'w');
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => { setV({ ...v, [k]: e.target.value }); if (err[k]) setErr((x) => ({ ...x, [k]: '' })); };

  const save = async () => {
    if (saving.current) return;
    const mobile = String(v.mobile).replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
    const missing = [];
    if (!String(v.full_name).trim()) missing.push('full name');
    if (mobile.length !== 10 || phoneProblem(mobile)) missing.push('a 10-digit mobile starting with 6–9');
    if (!v.program_id && !String(v.course_other).trim()) missing.push('the course they want');
    if (missing.length) { setMsg({ tone: 'bad', text: 'Still needed: ' + missing.join(', ') + '.' }); return; }
    saving.current = true; setBusy(true); setMsg(null);
    const db = supabase();
    const dupe = { data: await findByMobile(mobile) };
    if (dupe.data) { saving.current = false; setBusy(false); setMsg({ tone: 'bad', text: `This mobile is already in the CRM as ${dupe.data.full_name} (${dupe.data.stage}). Nothing new was added.`, id: dupe.data.id }); return; }
    const row = {
      full_name: String(v.full_name).trim(), mobile, email: v.email || null, city: v.city || null, program_id: v.program_id && v.program_id !== '__other' ? v.program_id : null,
      course_other: v.program_id === '__other' ? String(v.course_other).trim() : null, preferred_mode: v.preferred_mode || null, preferred_start: v.preferred_start || null,
      currently: v.currently || null, source_id: v.source_id || null, referred_by: v.referred_by || null, notes: v.notes || null, created_by: s.staff.id,
      marketing_consent: !!v.consent, consent_at: v.consent ? new Date().toISOString() : null,
    };
    const { data, error } = await db.from('lead').insert(row).select('id, owner:owner_id(full_name)').single();
    saving.current = false; setBusy(false);
    if (error) { setMsg({ tone: 'bad', text: (error.code === '23505' ? 'This mobile is already in the CRM.' : error.message) + ' What you typed is kept.' }); return; }
    setMsg({ tone: 'good', text: `${row.full_name} saved as a new lead${data?.owner?.full_name ? ' and assigned to ' + data.owner.full_name : ''}.`, id: data?.id });
    setV({ ...blank, source_id: walkIn });
    setErr({});
    setStep(0);
  };

  const Sel = ({ k, label, list }: { k: string; label: string; list: string }) => (
    <label className="flex flex-col gap-1 text-xs font-medium text-text2">{label}
      <select className={ctl} value={v[k]} onChange={set(k)}><option value="">Select</option>{(s.lists[list] || []).map((o) => <option key={o}>{o}</option>)}</select>
    </label>
  );

  const STEPS = ['Who is enquiring', 'What they want', 'How they found us'];
  const next = async () => {
    setMsg(null);
    if (step === 0) {
      const m = String(v.mobile).replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
      if (fail(['full_name', 'mobile'])) { setMsg({ tone: 'bad', text: 'Add their name and a 10-digit mobile starting with 6–9.' }); return; }
      // catch a repeat enquiry before anyone types the rest
      const dupe = { data: await findByMobile(m) };
      if (dupe.data) { setMsg({ tone: 'bad', text: `This mobile is already in the CRM as ${dupe.data.full_name} (${dupe.data.stage}).`, id: dupe.data.id }); return; }
    }
    if (step === 1 && fail(['program_id', 'course_other'])) return;
    setStep(step + 1);
  };

  return (
    <main className="flex flex-1 flex-col gap-6 overflow-y-auto p-4 md:p-6">
      <PageHeader title="New enquiry" description={'Walk-in or phone enquiry. Takes about a minute.' + (canWrite ? '' : ' View only for ' + s.staff.role + '.')} />
      <div ref={formRef} className="flex max-w-[860px] flex-col gap-4" onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'checkbox' && canWrite) { e.preventDefault(); if (step < 2) next(); else save(); } }}>
        <ol className="grid grid-cols-3 gap-2" aria-label="Steps">
          {STEPS.map((t, i) => (
            <li key={t} aria-current={i === step ? 'step' : undefined}>
              <button type="button" disabled={i > step} onClick={() => setStep(i)} className="flex w-full flex-col gap-1.5 text-left disabled:cursor-default">
                <span className={'h-1 rounded-full transition-colors duration-150 ' + (i <= step ? 'bg-accent' : 'bg-surface2')} />
                <span className={'text-[12px] font-semibold ' + (i === step ? 'text-text' : 'text-muted')}><span className="num">{i + 1}.</span> {t}</span>
              </button>
            </li>
          ))}
        </ol>
        {step === 0 && <section className="anim-fade rounded-[14px] bg-surface p-4 shadow-[var(--shadow-1)]">
          <h2 className="mb-4 text-[15px] font-semibold">Who is enquiring</h2>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
            <label data-field="full_name" className="flex flex-col gap-1 text-xs font-medium text-text2"><span>Full name <span className="text-badText" aria-hidden>*</span></span><input {...a('full_name')} aria-required className={ctl} value={v.full_name} onChange={set('full_name')} onBlur={blur('full_name')} placeholder="As they say it" autoComplete="off" /><Err id="enq-err-full_name" text={err.full_name} /></label>
            <div data-field="mobile" className="flex flex-col gap-1 text-xs font-medium text-text2" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && String(v.mobile).trim()) blur('mobile')(); }}><span>Mobile <span className="text-badText" aria-hidden>*</span></span><PhoneInput label="Mobile" value={v.mobile} onChange={(m) => { setV({ ...v, mobile: m }); if (err.mobile) setErr((x) => ({ ...x, mobile: '' })); }} /><Err id="enq-err-mobile" text={err.mobile} /></div>
            <label className="flex flex-col gap-1 text-xs font-medium text-text2">Email<input className={ctl} type="email" value={v.email} onChange={set('email')} placeholder="Optional" /></label>
            <label className="flex flex-col gap-1 text-xs font-medium text-text2">City<input className={ctl} value={v.city} onChange={set('city')} /></label>
          </div>
        </section>}
        {step === 1 && <section className="anim-fade rounded-[14px] bg-surface p-4 shadow-[var(--shadow-1)]">
          <h2 className="mb-4 text-[15px] font-semibold">What they want</h2>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
            <label data-field="program_id" className="flex flex-col gap-1 text-xs font-medium text-text2"><span>Course interested <span className="text-badText" aria-hidden>*</span></span>
              <select {...a('program_id')} aria-required className={ctl} value={v.program_id} onChange={set('program_id')} onBlur={blur('program_id')}>
                <option value="">Select</option>{s.refs.program.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}<option value="__other">Other (not offered yet)</option>
              </select>
              <Err id="enq-err-program_id" text={err.program_id} />
            </label>
            {v.program_id === '__other' && <label data-field="course_other" className="flex flex-col gap-1 text-xs font-medium text-text2"><span>Which course? <span className="text-badText" aria-hidden>*</span></span><input {...a('course_other')} className={ctl} value={v.course_other} onChange={set('course_other')} onBlur={blur('course_other')} placeholder="Type the course" autoFocus /><Err id="enq-err-course_other" text={err.course_other} /></label>}
            <div className="flex flex-col gap-1 text-xs font-medium text-text2">Preferred mode<RadioCards label="Preferred mode" options={s.lists.preferred_mode || []} value={v.preferred_mode || null} onChange={(x) => setV({ ...v, preferred_mode: x || '' })} /></div>
            <Sel k="preferred_start" label="Preferred start" list="preferred_start" />
            <div className="flex flex-col gap-1 text-xs font-medium text-text2">Currently<RadioCards label="Currently" options={s.lists.currently || []} value={v.currently || null} onChange={(x) => setV({ ...v, currently: x || '' })} /></div>
          </div>
        </section>}
        {step === 2 && <section className="anim-fade rounded-[14px] bg-surface p-4 shadow-[var(--shadow-1)]">
          <h2 className="mb-4 text-[15px] font-semibold">How they found us</h2>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
            <label className="flex flex-col gap-1 text-xs font-medium text-text2">Source
              <select className={ctl} value={v.source_id} onChange={set('source_id')}><option value="">Select</option>{s.refs.lead_source.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-text2">Referred by<input className={ctl} value={v.referred_by} onChange={set('referred_by')} placeholder="Name, if any" /></label>
            <div className="flex flex-col gap-1">
              <label className="flex flex-col gap-1 text-xs font-medium text-text2">Notes<input className={ctl} value={v.notes} onChange={set('notes')} placeholder="Anything they asked about" /></label>
              <VoiceInput context="enquiry" label="Speak the notes" onText={(t) => setV((x) => ({ ...x, notes: appendText(String(x.notes || ''), t) }))} />
            </div>
          </div>
          <label className="mt-3 flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[10px] bg-surface2 px-3 text-sm">
            <input type="checkbox" className="h-5 w-5" checked={!!v.consent} onChange={(e) => setV({ ...v, consent: e.target.checked })} />
            <span>They agree to get course updates and offers on WhatsApp, SMS and email <span className="text-muted">(ask them; leave unticked if not)</span></span>
          </label>
          <p className="mt-3 truncate rounded-lg bg-surface2 px-3 py-2.5 text-[13px] text-text2"><b className="text-text">{v.full_name}</b> · +91 {String(v.mobile).replace(/(\d{5})(\d{5})/, '$1 $2')}{v.email ? ' · ' + v.email : ''} · wants <b className="text-text">{v.program_id === '__other' ? v.course_other : s.refs.program.find((x) => x.id === v.program_id)?.label}</b></p>
        </section>}
        {msg && <Notice tone={msg.tone}>{msg.text} {msg.id && s.can('lead') && <Link className="underline" href={'/p/lead?person=lead:' + msg.id}>Open the lead</Link>}</Notice>}
        <Toolbar
          start={<span className="text-[13px] text-muted">{step === 0 ? 'The mobile is checked for duplicates straight away.' : step === 2 ? 'Saving assigns the lead by the assignment rule.' : ''}</span>}
          primary={step < 2 ? <Button variant="primary" disabled={!canWrite} onClick={next}>Next</Button>
            : <Button variant="primary" loading={busy} disabled={!canWrite} onClick={save}>Save enquiry</Button>}>
          {step > 0 && <Button variant="outline" onClick={() => { setMsg(null); setStep(step - 1); }}>Back</Button>}
        </Toolbar>
      </div>
    </main>
  );
}
