'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarCheck, FileDown, FileStack, GraduationCap, IndianRupee, LogOut, Upload, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Notice, cx } from '@/components/ui';
import { Journey } from '@/components/Journey';
import { journey } from '@/lib/journey';
import { PageSkeleton } from '@/components/Skeletons';

// Student portal: the student's own details, documents, fees and schedule. Everything goes through portal_* functions.
type Me = Record<string, any>;
const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const PROFILE: [string, string, string?][] = [['date_of_birth', 'Date of birth', 'date'], ['marital_status', 'Marital status'], ['identification_marks', 'Identification marks']];
const PRIVATE: Record<string, [string, [string, string][]]> = {
  contact: ['Contact and address', [['mobile', 'Mobile'], ['email', 'Email'], ['city', 'City'], ['address', 'Address']]],
  family: ['Family', [['father', 'Father’s name'], ['father_mobile', 'Father’s mobile'], ['mother', 'Mother’s name']]],
  identity: ['Identity', [['pan', 'PAN'], ['aadhaar', 'Aadhaar'], ['passport', 'Passport']]],
  bank: ['Bank (for stipend / refunds)', [['bank', 'Bank'], ['account', 'Account number'], ['ifsc', 'IFSC'], ['holder', 'Account holder']]],
};
const EDU: [string, string][] = [['level', 'Level'], ['institution', 'Institution'], ['course', 'Course'], ['years', 'Years'], ['marks', 'Marks %']];

export default function Portal() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [tab, setTab] = useState<'Overview' | 'My details' | 'Documents' | 'Fees'>('Overview');
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const load = useCallback(async () => {
    const db = supabase();
    for (let i = 0; i < 8; i++) {   // the login server can be a moment ahead right after sign-in
      const { data, error } = await db.rpc('portal_me');
      if (error && /issued at future/i.test(error.message)) { await new Promise((r) => setTimeout(r, 750)); continue; }
      const j = data ? await db.rpc('portal_journey') : { data: [] };
      setMe(data ? { ...data, journey: j.data || [] } : null); return;
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  const signOut = async () => { await supabase().auth.signOut(); window.location.href = '/login'; };

  if (me === undefined) return <main className="min-h-screen bg-bg"><PageSkeleton /></main>;
  if (me === null) return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="max-w-sm rounded-2xl border border-line bg-surface p-6 text-center">
        <div className="text-lg font-semibold">This login isn’t a student account</div>
        <p className="mt-2 text-text2">Staff use the main CRM. Students: ask the institute to invite you to the portal.</p>
        <div className="mt-4 flex justify-center gap-2"><a href="/" className="flex h-11 items-center rounded-[10px] border border-line2 px-4 font-medium">Open the CRM</a><Button onClick={signOut}>Sign out</Button></div>
      </div>
    </main>
  );
  const c = me.candidate;
  if (me.must_change_password) return <FirstPassword onDone={load} onSignOut={signOut} name={c.full_name} />;

  return (
    <div className="min-h-[100dvh] bg-bg">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[960px] items-center justify-between gap-3 px-4 py-3">
          <span className="flex items-end gap-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/stint-logo.svg" alt="Stint" className="logo-light h-[30px] w-auto" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/stint-logo-dark.svg" alt="" className="logo-dark h-[30px] w-auto" />
            <span className="mb-[11px] rounded-md bg-accentSoft px-1.5 py-0.5 text-[10px] font-semibold text-accentText">Student</span>
          </span>
          <button type="button" onClick={signOut} className="flex h-10 items-center gap-1.5 rounded-[10px] border border-line2 px-3 text-[13px] font-medium"><LogOut size={15} /> Sign out</button>
        </div>
      </header>
      <main className="mx-auto flex max-w-[960px] flex-col gap-4 p-4">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight">Hi {String(c.full_name).split(' ')[0]}</h1>
          <p className="text-text2">{[c.program, c.batch, c.code].filter(Boolean).join(' · ')}</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-b border-line pb-2" role="tablist">
          {(['Overview', 'My details', 'Documents', 'Fees'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setMsg(null); }} className={cx('min-h-[40px] shrink-0 rounded-[10px] px-3.5 text-[13.5px] font-medium', tab === t ? 'bg-ink text-white' : 'text-text2')}>{t}</button>
          ))}
        </nav>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        {tab === 'Overview' && <Overview me={me} go={setTab} />}
        {tab === 'My details' && <Details me={me} onSaved={(t) => { setMsg({ tone: 'good', text: t }); load(); }} onError={(t) => setMsg({ tone: 'bad', text: t })} />}
        {tab === 'Documents' && <Documents me={me} onDone={(t, bad) => { setMsg({ tone: bad ? 'bad' : 'good', text: t }); load(); }} />}
        {tab === 'Fees' && <Fees me={me} />}
      </main>
    </div>
  );
}

function Card({ icon: I, title, children }: { icon: React.ComponentType<{ size?: number }>; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="mb-2 flex items-center gap-2 font-semibold"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accentSoft text-accentText"><I size={16} /></span>{title}</h2>
      {children}
    </section>
  );
}

function Overview({ me, go }: { me: Me; go: (t: 'My details' | 'Documents' | 'Fees') => void }) {
  const c = me.candidate, f = me.fees, a = me.attendance || {};
  const missing = (me.documents || []).filter((d: Me) => d.status === 'Missing').length;
  const upcoming = (me.mocks || []).filter((m: Me) => m.scheduled_at && new Date(m.scheduled_at) > new Date());
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-2xl border border-line bg-surface p-4 md:col-span-2" aria-label="Your journey">
        <h2 className="mb-3 font-semibold">Your journey</h2>
        <Journey student steps={journey(me.journey || [], c.stage, c.joined_on)} />
      </section>
      <Card icon={GraduationCap} title="My course">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13.5px]">
          <dt className="text-muted">Program</dt><dd>{c.program || '—'}</dd><dt className="text-muted">Batch</dt><dd>{c.batch || 'Not assigned yet'}{c.starts_on ? ' · starts ' + day(c.starts_on) : ''}</dd>
          <dt className="text-muted">Trainer</dt><dd>{c.trainer || '—'}</dd><dt className="text-muted">Your counsellor</dt><dd>{c.owner || '—'}{c.owner_email ? ' · ' + c.owner_email : ''}</dd>
          <dt className="text-muted">Stage</dt><dd>{c.stage}</dd>
        </dl>
      </Card>
      <Card icon={IndianRupee} title="Fees">
        {f ? <>
          <div className="num text-2xl font-semibold">{inr(f.balance)} <span className="text-[13px] font-normal text-muted">still due of {inr(f.total)}</span></div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface2"><div className="h-full bg-accent" style={{ width: Math.min(100, Math.round((100 * f.paid) / (f.total || 1))) + '%' }} /></div>
          <p className={cx('mt-2 text-[13px]', f.overdue ? 'font-semibold text-badText' : 'text-text2')}>{f.overdue ? 'A payment is overdue.' : f.next_due ? 'Next instalment due ' + day(f.next_due) + '.' : 'Nothing due right now.'}</p>
          <button type="button" onClick={() => go('Fees')} className="mt-2 text-[13px] font-medium text-accentText">See payments and receipts →</button>
        </> : <p className="text-[13px] text-text2">Your fee plan will appear here.</p>}
      </Card>
      <Card icon={FileStack} title="Documents">
        <p className="text-[13.5px]">{missing ? <><b>{missing}</b> document{missing > 1 ? 's' : ''} still to upload.</> : 'Nothing pending. Thank you.'}</p>
        {missing > 0 && <button type="button" onClick={() => go('Documents')} className="mt-2 text-[13px] font-medium text-accentText">Upload now →</button>}
        {me.editable && <button type="button" onClick={() => go('My details')} className="mt-2 block text-[13px] font-medium text-accentText">Check my details →</button>}
      </Card>
      <Card icon={CalendarCheck} title="Schedule">
        <p className="text-[13.5px]">Attendance: <b>{a.total ? Math.round((100 * (a.present + a.late)) / a.total) + '%' : '—'}</b>{a.total ? ` (${a.present} present, ${a.absent} absent, ${a.late} late)` : ''}</p>
        <div className="mt-2 text-[13.5px]">{upcoming.length ? upcoming.map((m: Me, i: number) => <div key={i}>Mock {m.level} · {new Date(m.scheduled_at).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div>) : <span className="text-text2">No mock interviews booked yet.</span>}</div>
      </Card>
    </div>
  );
}

function Details({ me, onSaved, onError }: { me: Me; onSaved: (t: string) => void; onError: (t: string) => void }) {
  const c = me.candidate;
  const [profile, setProfile] = useState<Me>(c.profile || {});
  const [edu, setEdu] = useState<Me[]>(c.education?.length ? c.education : [{}]);
  const [priv, setPriv] = useState<Me>(me.private || {});
  const [busy, setBusy] = useState(false);
  const ro = !me.editable;
  const input = 'h-11 w-full px-3 text-sm';
  const save = async () => {
    setBusy(true);
    const { error } = await supabase().rpc('portal_save', { p_profile: profile, p_education: edu.filter((e) => Object.values(e).some(Boolean)), p_experience: c.experience || [], p_private: priv });
    setBusy(false);
    if (error) onError(error.message); else onSaved('Saved. The institute can see your updated details.');
  };
  return (
    <div className="flex flex-col gap-4">
      {ro && <Notice tone="warn">Your details are locked now. Ask your counsellor if something needs changing.</Notice>}
      <Card icon={UserRound} title="About you">
        <div className="grid gap-3 sm:grid-cols-2">
          {PROFILE.map(([k, l, t]) => <label key={k} className="flex flex-col gap-1 text-xs font-medium text-text2">{l}<input className={input} type={t || 'text'} disabled={ro} value={profile[k] || ''} onChange={(e) => setProfile({ ...profile, [k]: e.target.value })} /></label>)}
        </div>
      </Card>
      {Object.entries(PRIVATE).map(([g, [title, fields]]) => (
        <Card key={g} icon={UserRound} title={title}>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map(([k, l]) => <label key={k} className="flex flex-col gap-1 text-xs font-medium text-text2">{l}<input className={input} disabled={ro} value={priv[g]?.[k] || ''} onChange={(e) => setPriv({ ...priv, [g]: { ...(priv[g] || {}), [k]: e.target.value } })} /></label>)}
          </div>
        </Card>
      ))}
      <Card icon={GraduationCap} title="Education">
        {edu.map((e, i) => (
          <div key={i} className="mb-3 grid gap-2 border-b border-line pb-3 sm:grid-cols-5">
            {EDU.map(([k, l]) => <input key={k} aria-label={l + ' ' + (i + 1)} placeholder={l} className={input} disabled={ro} value={e[k] || ''} onChange={(ev) => setEdu(edu.map((x, j) => (j === i ? { ...x, [k]: ev.target.value } : x)))} />)}
          </div>
        ))}
        {!ro && <button type="button" onClick={() => setEdu([...edu, {}])} className="text-[13px] font-medium text-accentText">+ Add another</button>}
      </Card>
      {!ro && <Button variant="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save my details'}</Button>}
    </div>
  );
}

function Documents({ me, onDone }: { me: Me; onDone: (t: string, bad?: boolean) => void }) {
  const docs: Me[] = me.documents || [];
  const pick = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<Me | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const upload = async (file: File) => {
    if (!target) return;
    if (file.size > 20 * 1024 * 1024) { onDone('That file is over 20 MB.', true); return; }
    setBusy(target.id);
    const path = `${me.candidate.id}/doc/${crypto.randomUUID()}-${file.name.replace(/[^\w.\- ]+/g, '_')}`;
    const db = supabase();
    const up = await db.storage.from('candidate-files').upload(path, file, { contentType: file.type || undefined });
    if (up.error) { setBusy(null); onDone('Upload failed: ' + up.error.message, true); return; }
    const { error } = await db.rpc('portal_document_uploaded', { p_doc: target.id, p_path: path });
    setBusy(null);
    if (error) onDone(error.message, true); else onDone(target.doc_type + ' uploaded. The institute will verify it.');
  };
  return (
    <Card icon={FileStack} title="Documents the institute asked for">
      {docs.length === 0 && <p className="text-[13px] text-text2">Nothing requested yet.</p>}
      {docs.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-3 first:border-0">
          <div><div className="font-medium">{d.doc_type}</div><div className={cx('text-[12.5px]', d.status === 'Missing' ? 'text-badText' : d.status === 'Verified' ? 'text-goodText' : 'text-text2')}>{d.status === 'Missing' ? 'Not uploaded yet' : d.status === 'Received' ? 'Uploaded · waiting for verification' : 'Verified'}</div></div>
          {d.status !== 'Verified' && (
            <button type="button" disabled={busy === d.id} onClick={() => { setTarget(d); pick.current?.click(); }} className="flex min-h-[44px] items-center gap-1.5 rounded-[10px] border border-line2 bg-surface px-3 text-[13px] font-semibold">
              <Upload size={15} />{busy === d.id ? 'Uploading…' : d.status === 'Missing' ? 'Upload' : 'Replace'}
            </button>
          )}
        </div>
      ))}
      <input ref={pick} type="file" hidden accept=".pdf,image/*" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
      <p className="mt-2 text-[12px] text-muted">PDF or photo, up to 20 MB. Only you and the institute can see these files.</p>
    </Card>
  );
}

function Fees({ me }: { me: Me }) {
  const pays: Me[] = me.payments || [];
  return (
    <Card icon={IndianRupee} title="Payments">
      {pays.length === 0 && <p className="text-[13px] text-text2">No payments yet.</p>}
      {pays.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-3 first:border-0">
          <div><div className="num font-semibold">{inr(p.amount)} <span className="font-normal text-text2">· {p.label || 'Course fee'}</span></div>
            <div className={cx('text-[12.5px]', p.status === 'Overdue' ? 'font-semibold text-badText' : 'text-text2')}>{p.status === 'Received' ? 'Paid ' + day(p.paid_on) + (p.receipt_no ? ' · ' + p.receipt_no : '') : (p.status === 'Overdue' ? 'Overdue · was due ' : 'Due ') + day(p.due_on)}</div></div>
          {p.status === 'Received' && <a href={'/api/portal/receipt/' + p.id} target="_blank" rel="noopener" className="flex min-h-[44px] items-center gap-1.5 rounded-[10px] border border-line2 bg-surface px-3 text-[13px] font-semibold"><FileDown size={15} /> Receipt</a>}
        </div>
      ))}
    </Card>
  );
}

function FirstPassword({ onDone, onSignOut, name }: { onDone: () => void; onSignOut: () => void; name: string }) {
  const [pw, setPw] = useState(''), [again, setAgain] = useState(''), [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const save = async () => {
    if (pw.length < 10) return setMsg('Use at least 10 characters.');
    if (pw !== again) return setMsg('The two passwords don’t match.');
    setBusy(true);
    const db = supabase();
    const { error } = await db.auth.updateUser({ password: pw });
    if (error) { setBusy(false); return setMsg(error.message); }
    await db.rpc('portal_password_changed'); setBusy(false); onDone();
  };
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-[380px] rounded-2xl border border-line bg-surface p-7">
        <h1 className="text-[22px] font-semibold">Welcome, {name.split(' ')[0]}</h1>
        <p className="mt-1 text-text2">Choose your own password to open your student portal.</p>
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-text2">New password<input type="password" autoComplete="new-password" className="h-11 px-3 text-sm" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-xs font-medium text-text2">Type it again<input type="password" autoComplete="new-password" className="h-11 px-3 text-sm" value={again} onChange={(e) => setAgain(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} /></label>
          {msg && <Notice tone="bad">{msg}</Notice>}
          <Button variant="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save and continue'}</Button>
          <button type="button" onClick={onSignOut} className="h-10 text-sm text-text2">Sign out</button>
        </div>
      </div>
    </main>
  );
}
