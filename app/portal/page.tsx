'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CalendarCheck, ExternalLink, FileDown, FileStack, FolderOpen, GraduationCap, IndianRupee, LogOut, Mic, PenLine, Upload, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { passwordProblem } from '@/lib/passwords';
import { Button, Notice, Pill, cx } from '@/components/ui';
import { Journey } from '@/components/Journey';
import { journey } from '@/lib/journey';
import { PhoneInput } from '@/components/PhoneInput';
import { PageSkeleton } from '@/components/Skeletons';
import { SignaturePad } from '@/components/kit/SignaturePad';
import { Stepper } from '@/components/kit/Stepper';
import { Section } from '@/components/kit/Accordion';
import { RatingSummary } from '@/components/kit/RatingSummary';
import { PracticeCard, type PracticeAttempt } from '@/components/kit/PracticeCard';
import { ResumeCompareView, type ResumeVersion } from '@/components/kit/ResumeCompare';
import { FileTree } from '@/components/kit/FileTree';
import { FilePreviewProvider, useFilePreview } from '@/components/kit/FilePreview';
import { AlertStack } from '@/components/kit/AlertStack';
import { IdleGuard } from '@/components/kit/IdleGuard';
import { HelpList } from '@/components/kit/HelpList';
import { STUDENT_HELP_FOOTER, STUDENT_TOPICS } from '@/components/kit/studentHelp';
import { CheckIn } from '@/components/portal/CheckIn';
import { PortalPhoto } from '@/components/kit/PhotoUpload';

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
const TABS = ['Overview', 'My details', 'Documents', 'Fees', 'My progress', 'My resumes', 'My files', 'Alerts', 'Help'] as const;
type Tab = (typeof TABS)[number];
const LINK_TAB: Record<string, Tab> = { 'portal:resumes': 'My resumes', 'portal:files': 'My files', 'portal:progress': 'My progress', 'portal:fees': 'Fees' };
const mapLinkToTab = (link: string): Tab => LINK_TAB[link] || 'Alerts';
const pollMs = () => (typeof window !== 'undefined' && (window as unknown as { __stintAlertPollMs?: number }).__stintAlertPollMs) || 30000;
type Note = { id: string; kind: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };
const EDU: [string, string][] = [['level', 'Level'], ['institution', 'Institution'], ['course', 'Course'], ['years', 'Years'], ['marks', 'Marks %']];

export default function PortalPage() {
  return <FilePreviewProvider><Portal /></FilePreviewProvider>;
}

function Portal() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('Overview');
  const [notes, setNotes] = useState<Note[] | null>(null);
  const loadNotes = useCallback(async () => {
    const { data } = await supabase().rpc('portal_notifications');
    if (Array.isArray(data)) setNotes(data as Note[]);
  }, []);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const load = useCallback(async () => {
    const db = supabase();
    for (let i = 0; i < 8; i++) {   // the login server can be a moment ahead right after sign-in
      const { data, error } = await db.rpc('portal_me');
      if (error && /issued at future/i.test(error.message)) { await new Promise((r) => setTimeout(r, 750)); continue; }
      const [j, sg] = data ? await Promise.all([db.rpc('portal_journey'), db.rpc('portal_signature')]) : [{ data: [] }, { data: null }];
      const [rr, nc] = data ? await Promise.all([db.rpc('portal_document_reasons'), db.rpc('portal_next_class')]) : [{ data: [] }, { data: null }];
      const why = new Map(((rr.data || []) as Me[]).map((x) => [x.id, x.reject_reason]));
      if (data) data.documents = (data.documents || []).map((d: Me) => ({ ...d, reject_reason: why.get(d.id) || null }));
      setMe(data ? { ...data, journey: j.data || [], signed_at: sg.data?.signed_at || null, next_class: nc.data || null } : null); return;
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  const ready = !!me && !me.must_change_password;
  useEffect(() => {
    if (!ready) return;
    loadNotes();
    const t = setInterval(loadNotes, pollMs());
    return () => clearInterval(t);
  }, [ready, loadNotes]);
  const unread = (notes || []).filter((n) => !n.read_at).length;
  const go = (t: Tab) => { setTab(t); setMsg(null); if (t === 'Alerts') loadNotes(); };
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
      <IdleGuard />
      <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-3 px-4">
          <span className="flex items-end gap-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/stint-logo.svg" alt="Stint" className="logo-light h-[26px] w-auto" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/stint-logo-dark.svg" alt="" className="logo-dark h-[26px] w-auto" />
            <span className="mb-[9px] rounded-md bg-accentSoft px-1.5 py-0.5 text-[10px] font-semibold text-accentText">Student</span>
          </span>
          <Button variant="quiet" size="sm" onClick={signOut} leftIcon={<LogOut size={15} />}>Sign out</Button>
        </div>
      </header>
      <main className="mx-auto grid max-w-[1200px] gap-x-8 gap-y-4 px-4 pb-10 pt-4 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
        <aside className="flex flex-col gap-4 lg:sticky lg:top-[72px]" aria-label="You">
          <div className="flex items-center gap-3">
            <PortalPhoto id={String(c.id)} name={String(c.full_name)} />
            <div className="min-w-0">
              <h1 className="text-[18px] font-semibold leading-tight">Hi {String(c.full_name).split(' ')[0]}</h1>
              <p className="truncate text-[12.5px] text-text2">{[c.program, c.batch, c.code].filter(Boolean).join(' · ')}</p>
            </div>
          </div>
          <NextUp me={me} go={go} />
          {c.batch && <CheckIn />}
          <div className="border-t border-line pt-3">
            <Stepper label="Your joining steps" steps={[
              { label: 'My details', done: !!(me.private?.contact?.mobile && c.profile?.date_of_birth), onClick: () => go('My details') },
              { label: 'Documents', done: (me.documents || []).length > 0 && !(me.documents || []).some((d: Me) => d.status !== 'Received' && d.status !== 'Verified'), onClick: () => go('Documents') },
              { label: 'Sign agreement', done: !!me.signed_at, onClick: () => go('Fees') },
              { label: 'Fees paid', done: !!me.fees && Number(me.fees.balance) <= 0, onClick: () => go('Fees') },
            ]} />
          </div>
        </aside>
        <div className="flex min-w-0 flex-col gap-4">
        <nav className="sticky top-14 z-10 -mx-4 flex gap-0.5 overflow-x-auto border-b border-line bg-bg/95 px-4 py-1.5 backdrop-blur [scrollbar-width:none] lg:top-[56px] lg:mx-0 lg:flex-wrap lg:rounded-[10px] lg:border lg:bg-surface lg:p-1" role="tablist">
          {TABS.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => go(t)} className={cx('relative flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium before:absolute before:inset-x-0 before:-inset-y-1 before:content-[""]', tab === t ? 'bg-accentSoft font-semibold text-accentText' : 'text-text2 hover:bg-surface2 hover:text-text')}>
              {t}{t === 'Alerts' && unread > 0 && <span data-testid="unread-badge" aria-label={unread + ' unread'} className="num rounded-full bg-[#FF6B35] px-1.5 text-[11px] font-semibold leading-[18px] text-white">{unread}</span>}
            </button>
          ))}
        </nav>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        {tab === 'Overview' && <Overview me={me} go={go} unread={unread} />}
        {tab === 'My details' && <Details me={me} onSaved={(t) => { setMsg({ tone: 'good', text: t }); load(); }} onError={(t) => setMsg({ tone: 'bad', text: t })} />}
        {tab === 'Documents' && <Documents me={me} onDone={(t, bad) => { setMsg({ tone: bad ? 'bad' : 'good', text: t }); load(); }} />}
        {tab === 'Fees' && <Fees me={me} onSigned={(t, bad) => { setMsg({ tone: bad ? 'bad' : 'good', text: t }); if (!bad) load(); }} />}
        {tab === 'My progress' && <Progress />}
        {tab === 'My resumes' && <Resumes />}
        {tab === 'My files' && <Files me={me} />}
        {tab === 'Alerts' && <Alerts notes={notes} go={go} reload={loadNotes} />}
        {tab === 'Help' && <section aria-label="Help"><h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Help</h2><HelpList topics={STUDENT_TOPICS} footer={STUDENT_HELP_FOOTER} /></section>}
        </div>
      </main>
      <AlertStack source="student" onOpen={(l) => { go(mapLinkToTab(l)); loadNotes(); }} />
    </div>
  );
}

function Card({ icon: I, title, children }: { icon: React.ComponentType<{ size?: number }>; title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="border-t border-line pt-4">
      <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted"><I size={13} />{title}</h2>
      {children}
    </section>
  );
}

function Overview({ me, go, unread }: { me: Me; go: (t: Tab) => void; unread: number }) {
  const c = me.candidate, f = me.fees, a = me.attendance || {};
  const missing = (me.documents || []).filter((d: Me) => d.status !== 'Received' && d.status !== 'Verified').length;
  const upcoming = (me.mocks || []).filter((m: Me) => m.scheduled_at && new Date(m.scheduled_at) > new Date());
  return (
    <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
      <section className="md:col-span-2" aria-label="Your journey">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Your journey</h2>
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
          <button type="button" onClick={() => go('Fees')} className="mt-2 inline-flex min-h-[44px] items-center text-[13px] font-medium text-accentText">See payments and receipts →</button>
        </> : <p className="text-[13px] text-text2">Your fee plan will appear here.</p>}
      </Card>
      <Card icon={FileStack} title="Documents">
        <p className="text-[13.5px]">{missing ? <><b>{missing}</b> document{missing > 1 ? 's' : ''} still to upload or fix.</> : 'Nothing pending. Thank you.'}</p>
        {missing > 0 && <button type="button" onClick={() => go('Documents')} className="mt-2 inline-flex min-h-[44px] items-center text-[13px] font-medium text-accentText">Upload now →</button>}
        {me.editable && <button type="button" onClick={() => go('My details')} className="flex min-h-[44px] items-center text-[13px] font-medium text-accentText">Check my details →</button>}
      </Card>
      <Card icon={CalendarCheck} title="Schedule">
        <p className="text-[13.5px]">Attendance: <b>{a.total ? Math.round((100 * (a.present + a.late)) / a.total) + '%' : '—'}</b>{a.total ? ` (${a.present} present, ${a.absent} absent, ${a.late} late)` : ''}</p>
        <div className="mt-2 text-[13.5px]">{upcoming.length ? upcoming.map((m: Me, i: number) => <div key={i}>Mock {m.level} · {new Date(m.scheduled_at).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div>) : <span className="text-text2">No mock interviews booked yet.</span>}</div>
      </Card>
      <Card icon={Mic} title="Practise and alerts">
        <p className="text-[13.5px] text-text2">Practise answering interview questions and get a score.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <CoachLink />
          {unread > 0 && <button type="button" onClick={() => go('Alerts')} className="flex min-h-[44px] items-center gap-1.5 rounded-[10px] bg-surface2 px-3.5 text-[13px] font-semibold hover:bg-accentSoft hover:text-accentText"><Bell size={15} /> {unread} unread alert{unread > 1 ? 's' : ''}</button>}
        </div>
      </Card>
    </div>
  );
}

// The one or two things the student must do now, most urgent first. Built only from portal_me data.
type Todo = { key: string; title: string; when?: string; urgent?: boolean; tab: Tab; cta: string };
function nextUp(me: Me): Todo[] {
  const out: Todo[] = [];
  const f = me.fees, pays: Me[] = me.payments || [], docs: Me[] = me.documents || [];
  const overdue = pays.filter((p) => p.status === 'Overdue').sort((a, b) => String(a.due_on).localeCompare(String(b.due_on)));
  if (overdue.length) out.push({ key: 'fee-overdue', title: `Pay ${inr(overdue.reduce((s, p) => s + Number(p.amount || 0), 0))} overdue fee`, when: 'Was due ' + day(overdue[0].due_on), urgent: true, tab: 'Fees', cta: 'See fees' });
  const fixDocs = docs.filter((d) => d.status !== 'Missing' && d.status !== 'Received' && d.status !== 'Verified');
  if (fixDocs.length) out.push({ key: 'doc-fix', title: `Re-upload ${fixDocs.map((d) => d.doc_type).join(', ')}`, when: fixDocs[0].reject_reason ? 'Reason: ' + fixDocs[0].reject_reason : 'The institute could not accept it', urgent: true, tab: 'Documents', cta: 'Fix now' });
  const missing = docs.filter((d) => d.status === 'Missing');
  if (missing.length) out.push({ key: 'doc-missing', title: `Upload ${missing.length === 1 ? missing[0].doc_type : missing.length + ' documents'}`, when: missing.length > 1 ? missing.map((d) => d.doc_type).join(', ') : undefined, tab: 'Documents', cta: 'Upload' });
  const mock = (me.mocks || []).filter((m: Me) => m.scheduled_at && new Date(m.scheduled_at) > new Date()).sort((a: Me, b: Me) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)))[0];
  const nc = me.next_class;
  if (nc?.starts_at) out.push({ key: 'class', title: 'Next class · ' + nc.batch, when: new Date(nc.starts_at).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + ' – ' + new Date(nc.ends_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }), tab: 'Overview', cta: 'OK' });
  if (mock) out.push({ key: 'mock', title: `Mock interview ${mock.level || ''}`.trim(), when: new Date(mock.scheduled_at).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }), tab: 'My progress', cta: 'Practise first' });
  if (!me.signed_at && f) out.push({ key: 'sign', title: 'Sign your fee agreement', tab: 'Fees', cta: 'Sign' });
  if (!overdue.length && f && f.next_due && Number(f.balance) > 0) out.push({ key: 'fee-next', title: 'Next fee instalment', when: 'Due ' + day(f.next_due), tab: 'Fees', cta: 'See fees' });
  return out;
}

function NextUp({ me, go }: { me: Me; go: (t: Tab) => void }) {
  const all = nextUp(me), top = all.slice(0, 3);
  return (
    <section aria-label="Next up">
      <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Next up</h2>
      {top.length === 0 ? <p className="text-[13.5px] text-goodText">You’re all caught up. Nothing to do right now.</p> : (
        <ul>
          {top.map((t) => (
            <li key={t.key} data-testid={'next-' + t.key} className="flex items-center justify-between gap-3 border-t border-line py-2 first:border-0">
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-medium">{t.title}</div>
                {t.when && <div className={cx('text-[12.5px]', t.urgent ? 'font-semibold text-badText' : 'text-text2')}>{t.when}</div>}
              </div>
              {t.tab !== 'Overview' && <Button variant={t.urgent ? 'primary' : 'secondary'} size="sm" onClick={() => go(t.tab)}>{t.cta}</Button>}
            </li>
          ))}
        </ul>
      )}
      {all.length > 3 && <p className="mt-1 text-[12.5px] text-muted">+{all.length - 3} more to do later</p>}
    </section>
  );
}

function CoachLink() {
  return <a href="/api/portal/coach" target="_blank" rel="noopener" className="flex min-h-[44px] items-center gap-1.5 rounded-[10px] bg-accent px-4 text-[13.5px] font-semibold text-white"><Mic size={15} /> Practise interview</a>;
}

// Loads one portal_* function the first time a tab opens.
function useRpc<T>(fn: string, empty: T) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const run = useCallback(async () => {
    setErr(null);
    const { data: d, error } = await supabase().rpc(fn);
    if (error) setErr(error.message); else setData((d ?? empty) as T);
  }, [fn]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, [run]);
  return { data, err, retry: run };
}

function Loading({ err, retry }: { err: string | null; retry: () => void }) {
  return err ? <Notice tone="bad">Could not load this. <button type="button" onClick={retry} className="ml-1 min-h-[44px] font-semibold underline">Try again</button></Notice>
    : <p className="text-[13px] text-muted">Loading…</p>;
}

function Progress() {
  const fb = useRpc<{ reviews: Me[]; mocks: Me[] } | null>('portal_feedback', null);
  const pr = useRpc<PracticeAttempt[]>('portal_practice', []);
  return (
    <div className="flex flex-col gap-4">
      <Card icon={Mic} title="Practise interview">
        <p className="mb-3 text-[13.5px] text-text2">Opens the Interview Coach in a new tab. Answer out loud and your score shows up here.</p>
        <div className="flex"><CoachLink /></div>
      </Card>
      <section className="border-t border-line pt-4" aria-label="Mock interview feedback">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Mock interview feedback</h2>
        {fb.data === undefined ? <Loading err={fb.err} retry={fb.retry} />
          : !fb.data?.reviews?.length ? <p className="text-[13px] text-text2">No mock feedback yet</p>
          : <RatingSummary reviews={fb.data.reviews} mocks={fb.data.mocks} />}
      </section>
      {pr.data === undefined ? <Loading err={pr.err} retry={pr.retry} />
        : !pr.data.length ? <section className="border-t border-line pt-4"><h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Interview practice</h2><p className="text-[13px] text-text2">No practice yet — tap Practise interview to start</p></section>
        : <PracticeCard attempts={pr.data} />}
    </div>
  );
}

async function signed(path: string) {
  const { data, error } = await supabase().storage.from('candidate-files').createSignedUrl(path, 60);
  if (error || !data) throw new Error('sign');
  return data.signedUrl;
}

function Resumes() {
  const preview = useFilePreview();
  const rs = useRpc<ResumeVersion[]>('portal_resumes', []);
  const [err, setErr] = useState<string | null>(null);
  const list = rs.data || [];
  const withFiles = list.filter((v) => v.file_path);
  return (
    <Card icon={FileStack} title="My resumes">
      <p className="mb-2 text-[13px] text-text2">Your reviewer decides. Ask your counsellor if something needs changing.</p>
      {rs.data === undefined ? <Loading err={rs.err} retry={rs.retry} /> : list.length === 0 ? <p className="text-[13px] text-text2">No resume versions yet.</p> : <>
        <ul aria-label="Resume versions">
          {list.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-3 first:border-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium">{v.version} <Pill>{v.status}</Pill></div>
                <div className="text-[12.5px] text-text2">{[v.reviewer ? 'Reviewer: ' + v.reviewer : '', day(v.created_at)].filter(Boolean).join(' · ')}</div>
                {v.reason && /reject|change/i.test(v.status) && <div className="text-[12.5px] text-badText">Reason: {v.reason}</div>}
              </div>
              {v.file_path && <button type="button" onClick={() => { setErr(null); preview.open({ title: 'Resume ' + v.version, fileName: v.file_path!.split('/').pop()!.replace(/^[0-9a-f-]{36}-/, ''), getUrl: () => signed(v.file_path!) }); }} className="flex min-h-[44px] items-center gap-1.5 rounded-[10px] bg-surface2 px-3.5 text-[13px] font-semibold hover:bg-accentSoft hover:text-accentText"><ExternalLink size={15} /> Preview</button>}
            </li>
          ))}
        </ul>
        {err && <p role="alert" className="text-[13px] font-medium text-badText">{err}</p>}
        {withFiles.length >= 2 && <div className="mt-2"><ResumeCompareView versions={withFiles} currentId={withFiles[0].id} label="Compare two versions" /></div>}
      </>}
    </Card>
  );
}

function Files({ me }: { me: Me }) {
  const rs = useRpc<ResumeVersion[]>('portal_resumes', []);
  const dp = useRpc<{ id: string; file_path: string }[]>('portal_document_paths', []);
  const docs: Me[] = me.documents || [];
  const pathOf = (id: string) => (dp.data || []).find((x) => x.id === id)?.file_path || null;
  const missing = docs.some((d) => d.status === 'Missing');
  return (
    <Card icon={FolderOpen} title="My files">
      {missing && <p className="mb-2 text-[13px] text-text2">Some documents are not uploaded yet. Use the Documents tab to upload them.</p>}
      {rs.data === undefined ? <Loading err={rs.err} retry={rs.retry} /> : (
        <FileTree label="My files" folders={[
          { id: 'docs', name: 'My documents', files: docs.map((d) => ({ id: 'd' + d.id, name: d.doc_type, path: pathOf(d.id), status: d.status === 'Missing' ? null : d.status === 'Received' ? 'Waiting for check' : d.status })) },
          { id: 'resumes', name: 'My resumes', files: rs.data.filter((v) => v.file_path).map((v) => ({ id: 'r' + v.id, name: v.version, path: v.file_path, status: v.status })) },
        ]} />
      )}
    </Card>
  );
}

function Alerts({ notes, go, reload }: { notes: Note[] | null; go: (t: Tab) => void; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const unread = (notes || []).filter((n) => !n.read_at).length;
  const readAll = async () => { setBusy(true); await supabase().rpc('portal_notifications_read', { p_ids: null }); await reload(); setBusy(false); };
  const open = async (n: Note) => {
    if (!n.read_at) { await supabase().rpc('portal_notifications_read', { p_ids: [n.id] }); reload(); }
    if (n.link && LINK_TAB[n.link]) go(LINK_TAB[n.link]);
  };
  return (
    <Card icon={Bell} title="Alerts">
      {notes === null ? <p className="text-[13px] text-muted">Loading…</p> : notes.length === 0 ? <p className="text-[13px] text-text2">No alerts yet.</p> : <>
        <div className="mb-1 flex justify-end"><Button disabled={busy || !unread} onClick={readAll}>Mark all as read</Button></div>
        <ul aria-label="Alerts list">
          {notes.map((n) => (
            <li key={n.id} className="border-t border-line first:border-0">
              <button type="button" onClick={() => open(n)} className="flex min-h-[44px] w-full items-start gap-2.5 py-3 text-left">
                <span aria-hidden className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-[#FF6B35]')} />
                <span className="min-w-0 flex-1">
                  <span className={cx('block text-[13.5px]', !n.read_at && 'font-semibold')}>{n.title}{!n.read_at && <span className="sr-only"> (unread)</span>}</span>
                  {n.body && <span className="block text-[12.5px] text-text2">{n.body}</span>}
                  <span className="block text-[12px] text-muted">{day(n.created_at)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </>}
    </Card>
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
      {Object.entries(PRIVATE).map(([g, [title, fields]], gi) => {
        const filled = fields.filter(([k]) => String(priv[g]?.[k] || '').trim()).length;
        return (
        <Section key={g} title={title} status={`${filled} of ${fields.length} filled`} done={filled === fields.length} defaultOpen={gi === 0}>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map(([k, l]) => /mobile/i.test(k) && !ro
              ? <div key={k} className="flex flex-col gap-1 text-xs font-medium text-text2">{l}<PhoneInput label={l} value={priv[g]?.[k] || ''} onChange={(m) => setPriv({ ...priv, [g]: { ...(priv[g] || {}), [k]: m } })} /></div>
              : <label key={k} className="flex flex-col gap-1 text-xs font-medium text-text2">{l}<input className={input} disabled={ro} value={priv[g]?.[k] || ''} onChange={(e) => setPriv({ ...priv, [g]: { ...(priv[g] || {}), [k]: e.target.value } })} /></label>)}
          </div>
        </Section>
        );
      })}
      <Section title="Education" status={`${edu.filter((e) => e.institution).length} added`} done={edu.some((e) => e.institution)}>
        {edu.map((e, i) => (
          <div key={i} className="mb-3 grid gap-2 border-b border-line pb-3 sm:grid-cols-5">
            {EDU.map(([k, l]) => <input key={k} aria-label={l + ' ' + (i + 1)} placeholder={l} className={input} disabled={ro} value={e[k] || ''} onChange={(ev) => setEdu(edu.map((x, j) => (j === i ? { ...x, [k]: ev.target.value } : x)))} />)}
          </div>
        ))}
        {!ro && <button type="button" onClick={() => setEdu([...edu, {}])} className="text-[13px] font-medium text-accentText">+ Add another</button>}
      </Section>
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
          <div><div className="font-medium">{d.doc_type}</div><div className={cx('text-[12.5px]', d.status !== 'Received' && d.status !== 'Verified' ? 'text-badText' : d.status === 'Verified' ? 'text-goodText' : 'text-text2')}>{d.status === 'Missing' ? 'Not uploaded yet' : d.status === 'Received' ? 'Uploaded · waiting for verification' : d.status === 'Verified' ? 'Verified' : 'Not accepted · ' + (d.reject_reason ? 'Reason: ' + d.reject_reason + '. ' : '') + 'Please upload a corrected copy. Ask your counsellor if unsure.'}</div></div>
          {d.status !== 'Verified' && (
            <button type="button" disabled={busy === d.id} onClick={() => { setTarget(d); pick.current?.click(); }} className="flex min-h-[44px] items-center gap-1.5 rounded-[10px] bg-surface2 px-3.5 text-[13px] font-semibold hover:bg-accentSoft hover:text-accentText">
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

function Fees({ me, onSigned }: { me: Me; onSigned: (text: string, bad?: boolean) => void }) {
  const preview = useFilePreview();
  const pays: Me[] = me.payments || [];
  const [png, setPng] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const sign = async () => {
    setBusy(true);
    const { error } = await supabase().rpc('portal_sign', { p_png: png });
    setBusy(false);
    onSigned(error ? error.message : 'Thank you. Your signature is saved.', !!error);
  };
  return (<>
    <Card icon={PenLine} title="Fee agreement">
      {me.signed_at ? <p className="text-[13.5px] text-goodText">Signed on {day(me.signed_at)}. Thank you.</p> : <>
        <p className="mb-3 text-[13.5px] text-text2">
          I agree to pay the course fee of <b className="text-text">{me.fees ? inr(me.fees.total) : 'the agreed amount'}</b> as per the instalments shown below, and to follow the institute’s rules.
        </p>
        <SignaturePad onChange={setPng} />
        <label className="mt-2 flex min-h-[44px] items-center gap-2 text-[13.5px]"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="h-5 w-5" /> I have read and agree</label>
        <Button variant="primary" disabled={!png || !agree || busy} onClick={sign} className="mt-1">{busy ? 'Saving…' : 'Sign and submit'}</Button>
      </>}
    </Card>
    <Card icon={IndianRupee} title="Payments">
      {me.fees && <dl data-testid="fee-summary" className="mb-3 grid grid-cols-3 gap-2 text-center">
        <div><dt className="text-[12px] text-muted">Paid</dt><dd className="num font-semibold text-goodText">{inr(me.fees.paid)}</dd></div>
        <div><dt className="text-[12px] text-muted">Total fee</dt><dd className="num font-semibold">{inr(me.fees.total)}</dd></div>
        <div><dt className="text-[12px] text-muted">Next due</dt><dd className={cx('font-semibold', me.fees.overdue && 'text-badText')}>{Number(me.fees.balance) <= 0 ? 'All paid' : me.fees.overdue ? 'Overdue' : day(me.fees.next_due)}</dd></div>
      </dl>}
      {pays.length === 0 && <p className="text-[13px] text-text2">No payments yet.</p>}
      {pays.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-3 first:border-0">
          <div><div className="num font-semibold">{inr(p.amount)} <span className="font-normal text-text2">· {p.label || 'Course fee'}</span></div>
            <div className={cx('text-[12.5px]', p.status === 'Overdue' ? 'font-semibold text-badText' : 'text-text2')}>{p.status === 'Received' ? 'Paid ' + day(p.paid_on) + (p.receipt_no ? ' · ' + p.receipt_no : '') : (p.status === 'Overdue' ? 'Overdue · was due ' : 'Due ') + day(p.due_on)}</div></div>
          {p.status === 'Received' && <button type="button" onClick={() => preview.open({ title: 'Receipt' + (p.receipt_no ? ' ' + p.receipt_no : ''), fileName: 'receipt-' + (p.receipt_no || p.id) + '.pdf', kind: 'pdf', src: '/api/portal/receipt/' + p.id })} className="flex min-h-[44px] items-center gap-1.5 rounded-[10px] bg-surface2 px-3.5 text-[13px] font-semibold hover:bg-accentSoft hover:text-accentText"><FileDown size={15} /> Receipt</button>}
        </div>
      ))}
    </Card>
  </>);
}

function FirstPassword({ onDone, onSignOut, name }: { onDone: () => void; onSignOut: () => void; name: string }) {
  const [pw, setPw] = useState(''), [again, setAgain] = useState(''), [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const save = async () => {
    const problem = passwordProblem(pw); if (problem) return setMsg(problem);
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
