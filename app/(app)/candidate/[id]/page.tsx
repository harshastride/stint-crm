'use client';
import { Journey } from '@/components/Journey';
import { Meter } from '@/components/kit/Meter';
import { RatingSummary } from '@/components/kit/RatingSummary';
import { PracticeCard, type PracticeAttempt } from '@/components/kit/PracticeCard';
import { Tracker } from '@/components/kit/Tracker';
import { FileTree } from '@/components/kit/FileTree';
import { TagChips } from '@/components/kit/Tags';
import { journey, type StageChange } from '@/lib/journey';
import Link from 'next/link';
import { use, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { Pill, cx, fmtDate, fmtDateTime, money } from '@/components/ui';
import { PageSkeleton } from '@/components/Skeletons';
import { StageControl } from '@/components/profile/StageControl';
import { NextSteps } from '@/components/profile/NextSteps';
import { DetailGroup, PrivateDetails } from '@/components/profile/PrivateDetails';
import { Timeline } from '@/components/Timeline';
import { stepsForStage } from '@/lib/nextSteps';
import { useRouter } from 'next/navigation';
import { AvatarStack, type StackPerson } from '@/components/kit/AvatarStack';
import { PhotoUpload } from '@/components/kit/PhotoUpload';
import { JobPapers } from '@/components/JobPapers';
import { Threads } from '@/components/kit/Threads';

export default function Candidate360({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const s = useSession();
  const [c, setC] = useState<Row | null>(null);
  const [priv, setPriv] = useState<Row | null>(null);
  const [data, setData] = useState<Record<string, Row[]>>({});
  const [inView, setInView] = useState('');
  const scroller = useRef<HTMLElement>(null);
  const [missing, setMissing] = useState(false);
  const [timeline, setTimeline] = useState<Row[] | null>(null);
  const [reload, setReload] = useState(0);
  const router = useRouter();

  useEffect(() => {
    const db = supabase();
    const opt = (page: string, q: PromiseLike<{ data: Row[] | null }>) => (s.can(page) ? q : Promise.resolve({ data: [] as Row[] }));
    (async () => {
      const one = await db.from('candidate').select('*, program:program_id(name), batch:batch_id(code, trainer:trainer_id(id,full_name)), poc:poc_id(id,full_name)').eq('id', id).maybeSingle();
      if (!one.data) { setMissing(true); return; }
      setC(one.data);
      const ids = [id, one.data.lead_id].filter(Boolean);
      const [p, att, notes, mocks, fb, res, docs, plan, pays, hist, sig, plc, jobs, prac] = await Promise.all([
        db.rpc('candidate_private_get', { cid: id }),
        opt('attendance', db.from('attendance').select('day,mark').eq('candidate_id', id).order('day', { ascending: false }).limit(60)),
        opt('note', db.from('training_note').select('*, trainer:trainer_id(full_name)').eq('candidate_id', id).order('created_at', { ascending: false })),
        opt('mock', db.from('mock_session').select('*, trainer:trainer_id(full_name)').eq('candidate_id', id).order('scheduled_at', { ascending: false })),
        opt('sme', db.from('sme_feedback').select('*, sme:sme_id(full_name)').eq('candidate_id', id).order('created_at', { ascending: false })),
        opt('resume', db.from('resume_version').select('*, reviewer:reviewer_id(full_name)').eq('candidate_id', id).order('created_at', { ascending: false })),
        opt('doc', db.from('candidate_document').select('*').eq('candidate_id', id)),
        opt('plan', db.from('fee_plan_summary').select('*').eq('candidate_id', id)),
        opt('payment', db.from('fee_payment').select('*').eq('candidate_id', id).order('due_on')),
        db.from('status_history').select('to_value, at, by:by_id(full_name)').in('entity_id', ids).order('at'),
        db.from('candidate_signature').select('png, signed_at').eq('candidate_id', id),
        opt('placement', db.from('placement').select('*, company:company_id(name)').eq('candidate_id', id).order('created_at', { ascending: false }).limit(1)),
        opt('placement', db.from('job_record').select('id, company, joined_on, last_working_day').eq('candidate_id', id)),
        opt('practice', db.from('interview_practice').select('topic, question, overall, accuracy, fluency, completeness, wpm, filler_count, created_at').eq('candidate_id', id).order('created_at', { ascending: false }).limit(50)),
      ]);
      setPriv(p.data);
      setData({ hist: (hist.data || []).map((h: Row) => ({ ...h, by_name: h.by?.full_name })), att: att.data || [], notes: notes.data || [], mocks: mocks.data || [], fb: fb.data || [], res: res.data || [], docs: docs.data || [], plan: plan.data || [], pays: pays.data || [], sig: sig.data || [], plc: plc.data || [], jobs: jobs.data || [], prac: prac.data || [] });
    })();
  }, [id, s, reload]);
  useEffect(() => { supabase().rpc('person_timeline', { p_lead: null, p_candidate: id }).then(({ data }) => setTimeline(data || [])); }, [id, reload]);
  // highlight the chip of the section nearest the top of the scroll area
  useEffect(() => {
    const root = scroller.current; if (!root || !c) return;
    const io = new IntersectionObserver((es) => {
      const top = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setInView((top.target as HTMLElement).dataset.section || '');
    }, { root, rootMargin: '-56px 0px -60% 0px' });
    root.querySelectorAll('[data-section]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  });
  const go = (key: string) => { const el = document.getElementById('sec-' + key.replace(/\s/g, '-')); if (!el) return; el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); setInView(key); };

  if (missing) return <main className="flex-1 p-8 text-text2">This candidate does not exist, or your role can’t open it.</main>;
  if (!c) return <PageSkeleton />;

  const plan = data.plan?.[0];
  const pl = (data.plc || [])[0], job = (data.jobs || [])[0];
  const docsIn = (data.docs || []).filter((d) => d.status !== 'Missing').length;
  const present = data.att?.length ? Math.round((100 * data.att.filter((a) => a.mark === 'P').length) / data.att.length) + '%' : '—';
  const nextSteps = stepsForStage(c.stage).filter((st) => !st.inline && s.can(st.page, 'w'));
  const label = 'mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted';
  const Lines = ({ rows }: { rows: [string, React.ReactNode, React.ReactNode?][] }) => <>{rows.map(([a, b, cc], i) => (
    <div key={i} className="flex min-h-[40px] items-center justify-between gap-3 border-t border-line py-1.5 first:border-0"><div className="min-w-0"><div className="break-words text-[13.5px] font-medium">{a}</div>{cc && <div className="break-words text-xs text-muted">{cc}</div>}</div><div className="shrink-0 text-[13px]">{b}</div></div>
  ))}</>;
  const Sub = ({ title, children }: { title: string; children: React.ReactNode }) => <div className="border-t border-line pt-3 first:border-0 first:pt-0"><h3 className={label}>{title}</h3>{children}</div>;
  const KV = ({ rows }: { rows: [string, React.ReactNode][] }) => (
    <dl className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-x-3 text-[13px]">
      {rows.map(([k, v]) => <div key={k} className="contents"><dt className="border-t border-line py-1.5 text-muted [&:nth-child(1)]:border-0">{k}</dt><dd className="num break-words border-t border-line py-1.5 font-medium [&:nth-child(2)]:border-0">{v}</dd></div>)}
    </dl>
  );

  const docFolders = [
    { id: 'f-doc', name: 'Identity & education', files: (data.docs || []).map((d) => ({ id: 'd-' + d.id, name: d.doc_type, path: d.file_path || null, status: d.status, note: d.verified_at ? 'Verified ' + fmtDate(d.verified_at) : '' })) },
    ...(s.can('resume') ? [{ id: 'f-res', name: 'Resumes', files: (data.res || []).filter((r) => r.file_path).map((r) => ({ id: 'r-' + r.id, name: r.version, path: r.file_path, status: r.status })) }] : []),
  ];
  const sig = (data.sig || [])[0];
  const showRatings = (s.can('sme') || s.can('mock')) && ((data.fb || []).length > 0 || (data.mocks || []).some((m) => m.status === 'Passed' || m.status === 'Failed'));
  const fb = s.can('sme') ? data.fb || [] : [];

  // Every section, in reading order. `show: false` = the role can't see it; `empty` = folded into the "Not yet" line.
  const sections: { key: string; title: string; show: boolean; empty?: string; count?: number; body: () => React.ReactNode }[] = [
    { key: 'Discussions', title: 'Discussions', show: true, body: () => <Threads kind="candidate" id={id} /> },
    { key: 'Fees', title: 'Fees', show: s.can('plan'), empty: !plan && !(data.pays || []).length && !sig ? 'fee plan' : undefined, count: (data.pays || []).length, body: () => <>
      {plan ? <>
        <KV rows={[['Total', money(plan.total)], ['Paid', money(plan.paid)], ['Balance', money(plan.balance)], ['Plan', plan.plan || '—']]} />
      </> : <p className="text-[13px] text-text2">No fee plan yet.</p>}
      {s.can('payment') && (data.pays || []).length > 0 && <div className="mt-3"><Sub title="Payments"><Lines rows={(data.pays || []).map((p) => [money(p.amount) + (p.mode ? ' · ' + p.mode : ''), <Pill key={p.id}>{p.status}</Pill>, p.paid_on ? 'Paid ' + fmtDate(p.paid_on) : 'Due ' + fmtDate(p.due_on)])} /></Sub></div>}
      <div className="mt-3 border-t border-line pt-3">
        <h3 className={label}>Fee agreement signature</h3>
        {sig ? <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sig.png} alt={'Signature of ' + c.full_name} className="h-14 w-auto rounded-lg border border-line bg-white p-1" />
          <p className="text-[12.5px] text-text2">Signed in the portal on {fmtDate(sig.signed_at)}.</p>
        </div> : <p className="text-[13px] text-text2">Not signed yet. The student signs in the portal.</p>}
      </div>
    </> },
    { key: 'Documents', title: 'Documents', show: s.can('doc'), empty: docFolders.every((f) => !f.files.length) ? 'documents' : undefined, count: (data.docs || []).length, body: () => <>
      {(data.docs || []).length > 0 && <div className="mb-2"><Meter label="Documents in" value={docsIn} max={(data.docs || []).length} /></div>}
      <FileTree label="Candidate files" folders={docFolders} />
    </> },
    { key: 'Training', title: `Training · ${present} present`, show: s.can('attendance') || s.can('note'), empty: !(data.att || []).length && !(data.notes || []).length ? 'attendance or trainer notes' : undefined, body: () => <>
      {(data.att || []).length > 0 && <Sub title="Attendance (latest 12)"><div className="flex flex-wrap gap-1">{(data.att || []).slice(0, 12).map((a) => <span key={a.day} title={a.mark === 'P' ? 'Present' : a.mark === 'A' ? 'Absent' : 'Late'} className={cx('num rounded-chip px-1.5 py-0.5 text-[11.5px] font-medium', a.mark === 'P' ? 'bg-goodBg text-goodText' : a.mark === 'A' ? 'bg-badBg text-badText' : 'bg-surface2 text-text2')}>{fmtDate(a.day)} · {a.mark === 'P' ? 'Present' : a.mark === 'A' ? 'Absent' : 'Late'}</span>)}</div></Sub>}
      {(data.notes || []).length > 0 && <div className="mt-3"><Sub title="Trainer notes"><Lines rows={(data.notes || []).map((n) => [n.note, n.flag ? <Pill key={n.id}>{n.flag}</Pill> : '', (n.trainer?.full_name || '') + ' · ' + fmtDate(n.created_at)])} /></Sub></div>}
    </> },
    { key: 'Mocks', title: 'Mocks & feedback', show: s.can('mock') || s.can('sme'), empty: !(data.mocks || []).length && !fb.length ? 'mocks' : undefined, count: (data.mocks || []).length, body: () => <>
      {showRatings && <div className="mb-3"><RatingSummary reviews={fb} mocks={data.mocks || []} /></div>}
      {(data.mocks || []).length > 0 && <Sub title="Mock sessions"><Lines rows={(data.mocks || []).map((m) => [m.level + ' · ' + (m.trainer?.full_name || ''), <Pill key={m.id}>{m.status}</Pill>, fmtDateTime(m.scheduled_at)])} /></Sub>}
      {fb.length > 0 && <div className="mt-3"><Sub title="SME feedback"><Lines rows={fb.map((f) => [(f.rating || '—') + ' / 5 · ' + (f.comments || ''), <Pill key={f.id}>{f.verdict}</Pill>, (f.sme?.full_name || '') + ' · ' + fmtDate(f.created_at)])} /></Sub></div>}
    </> },
    { key: 'Practice', title: 'Interview practice', show: s.can('practice'), empty: !(data.prac || []).length ? 'interview practice' : undefined, body: () => <PracticeCard attempts={(data.prac || []) as unknown as PracticeAttempt[]} /> },
    { key: 'Resume', title: 'Resume', show: s.can('resume'), empty: !(data.res || []).length ? 'resume' : undefined, count: (data.res || []).length, body: () => <Lines rows={(data.res || []).map((r) => ['Resume ' + r.version + (r.reason ? ' · ' + r.reason : ''), <Pill key={r.id}>{r.status}</Pill>, (r.reviewer?.full_name || '') + ' · ' + fmtDate(r.created_at)])} /> },
    { key: 'Placement', title: 'Placement' + (pl ? ' · ' + (pl.company?.name || 'Company') : ''), show: s.can('placement'), empty: !pl ? 'placement' : undefined, body: () => <>
      <KV rows={[['Role', pl.role || '—'], ['Package', pl.ctc_lpa ? pl.ctc_lpa + ' LPA' : '—'], ['Status', pl.status || '—'], ['Joining date', pl.joining_on ? fmtDate(pl.joining_on) : 'Not fixed yet']]} />
      <div className="mt-3" aria-label="Placement tracker" role="region"><PlacementSteps pl={pl} job={job} /></div>
    </> },
    { key: 'Job papers', title: 'Job papers', show: s.can('placement') && (data.jobs || []).length > 0, count: (data.jobs || []).length, body: () => <>{(data.jobs || []).map((j) => (
      <Sub key={j.id} title={(j.company || 'Company') + (j.joined_on ? ' · joined ' + fmtDate(j.joined_on) : '')}><JobPapers job={j} canWrite={s.can('jobdocs', 'w')} /></Sub>
    ))}</> },
    { key: 'Activity', title: 'Activity', show: true, body: () => timeline === null ? <p className="text-[13px] text-text2">Loading…</p> : <Timeline items={timeline} pageSize={10} /> },
    { key: 'Details', title: 'Personal & education', show: true, body: () => <div className="flex flex-col gap-2.5">
      <DetailGroup title="Personal" rows={[['Full name', c.full_name], ...Object.entries(c.profile || {}).filter(([, v]) => v).map(([k, v]) => [k.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase()), String(v)] as [string, string]), ['Joined', c.joined_on ? fmtDate(c.joined_on) : '']]} />
      <PrivateDetails id={id} priv={priv} />
      {(c.education || []).length > 0 && <Sub title="Education"><Lines rows={(c.education || []).map((e: Row) => [e.level || 'Education', [e.years, e.marks && e.marks + '%'].filter(Boolean).join(' · ') || '—', [e.institution, e.board, e.course].filter(Boolean).join(' · ')])} /></Sub>}
      {(c.experience || []).length > 0 && <Sub title="Work experience"><Lines rows={(c.experience || []).map((e: Row) => [e.company || 'Company', [e.joined, e.last_day].filter(Boolean).join(' → ') || '—', [e.role, e.ctc].filter(Boolean).join(' · ')])} /></Sub>}
    </div> },
  ];
  const visible = sections.filter((x) => x.show && !x.empty);
  const notYet = [...sections.filter((x) => x.show && x.empty).map((x) => x.empty!), ...((c.education || []).length ? [] : ['education']), ...((c.experience || []).length ? [] : ['work experience'])];
  const facts: [string, React.ReactNode][] = [['Owner', c.poc?.full_name || 'Not set'], ['Attendance', present], ['Fee due', plan ? money(plan.balance) : 'No plan'], ...(c.joined_on ? [['Joined', fmtDate(c.joined_on)] as [string, string]] : [])];

  return (
    <main className="flex-1 overflow-y-auto p-page-sm md:px-page md:py-4" ref={scroller}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
        <Link href={'/p/candidate?person=candidate:' + id} className="-ml-2 flex min-h-[44px] items-center rounded-row px-2 font-medium text-text2 transition-colors duration-150 hover:bg-surface2 hover:text-text">← Candidates</Link>
        <span className="text-muted">/ {c.code}</span>
        <span className="ml-auto text-muted" title={s.staff.role === 'Admin' ? 'Admin sees everything' : 'Some parts are masked or hidden for your role'}>Viewing as {s.staff.role}{s.staff.role === 'Admin' ? '' : ' · some parts masked'}</span>
      </div>

      <section className="flex flex-col gap-3 border-b border-line pb-3" aria-label="Candidate summary" role="region">
        <div className="grid gap-x-6 gap-y-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
          <div className="flex min-w-0 items-start gap-3">
            <PhotoUpload kind="candidate" id={c.id as string} name={c.full_name as string} photo={(c.photo_path as string | null) ?? null} canEdit={s.can('candidate', 'w')} onChange={(p) => setC({ ...c, photo_path: p })} />
            <div className="min-w-0 flex-1">
              <h1 className="break-words text-[20px] font-semibold leading-tight">{c.full_name}</h1>
              <div className="mt-0.5 break-words text-[12.5px] text-text2">{(c.program?.name || 'No program') + (c.batch?.code ? ' · ' + c.batch.code : ' · No batch yet') + ' · ' + c.code}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <CandidateTeam c={c} />
                {(c.tags || []).length > 0 && <div className="flex flex-wrap gap-1"><TagChips tags={c.tags} max={6} /></div>}
              </div>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <StageControl kind="candidate" id={id} stage={c.stage} changedAt={c.stage_changed_at} onMoved={() => setReload((n) => n + 1)} trackHiddenFrom="md" />
            <NextSteps inline stage={c.stage} steps={nextSteps} onRun={(st) => st.href && router.push(st.href({ kind: 'candidate', id }))} />
          </div>
        </div>
        <div aria-label="Student journey" role="region" className="hidden md:block"><Journey steps={journey((data.hist || []) as StageChange[], c.stage, c.created_at)} /></div>
        <dl aria-label="Key facts" className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
          {facts.map(([k, v]) => <div key={k} className="flex items-baseline gap-1.5"><dt className="text-muted">{k}</dt><dd className="num font-semibold">{v}</dd></div>)}
          {plan && Number(plan.total) > 0 && <div className="min-w-[200px] flex-1 sm:max-w-[320px]"><Meter label="Fees paid" value={Number(plan.paid)} max={Number(plan.total)} text={`${money(plan.paid)} of ${money(plan.total)}`} /></div>}
        </dl>
      </section>

      <nav className="sticky top-0 z-[2] -mx-1 mb-3 flex gap-1 overflow-x-auto border-b border-line bg-bg px-1 py-1.5" role="group" aria-label="Candidate sections">
        {visible.map((x) => <button key={x.key} type="button" aria-label={x.key} aria-pressed={inView === x.key} onClick={() => go(x.key)}
          className={cx('flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors duration-150', inView === x.key ? 'bg-accent/10 font-semibold text-accentText' : 'font-medium text-text2 hover:bg-surface2 hover:text-text')}>
          {x.key === 'Details' ? 'Details' : x.key}{x.count ? <span className="num rounded-full bg-surface2 px-1.5 text-[11px] text-muted">{x.count}</span> : null}
        </button>)}
      </nav>

      <div className="columns-1 gap-4 min-[1280px]:columns-2 min-[1600px]:columns-3 [column-width:auto]">
        {visible.map((x) => (
          <section key={x.key} id={'sec-' + x.key.replace(/\s/g, '-')} data-section={x.key} aria-label={x.key} role="region"
            className="mb-4 break-inside-avoid scroll-mt-14 rounded-card border border-line bg-surface p-4">
            {x.key !== 'Discussions' && <h2 className={label}>{x.title}</h2>}
            {x.body()}
          </section>
        ))}
      </div>
      {notYet.length > 0 && <p className="mt-1 text-[13px] text-text2" data-testid="not-yet"><span className="font-semibold text-text">Not yet:</span> {notYet.join(', ')}</p>}
    </main>
  );
}

function PlacementSteps({ pl, job }: { pl: Row; job?: Row }) {
  const dropped = pl.status === 'Dropped', joined = pl.status === 'Joined' || !!job;
  return <Tracker label="Placement steps" steps={[
    { label: 'Offer accepted', note: [pl.company?.name, pl.ctc_lpa ? pl.ctc_lpa + ' LPA' : '', 'recorded ' + fmtDate(pl.created_at)].filter(Boolean).join(' · '), done: true },
    { label: 'Joining date fixed', note: pl.joining_on ? fmtDate(pl.joining_on) : 'Not fixed yet', done: !!pl.joining_on },
    { label: dropped ? 'Dropped' : 'Joined', note: dropped ? 'The candidate did not join.' : joined ? 'Joined' + (job?.joined_on ? ' on ' + fmtDate(job.joined_on) : '') : pl.joining_on && new Date(pl.joining_on) < new Date() ? 'Joining date passed: please confirm' : 'Waiting for joining day', done: joined, bad: dropped },
    { label: 'Job papers tracked', note: job ? 'Papers are tracked under Job papers.' : 'Starts once they join.', done: !!job },
  ]} />;
}

/** Faces of the staff who worked on this candidate: owner, trainer (from the batch) and counsellor (from the lead's counselling). */
function CandidateTeam({ c }: { c: Row }) {
  const s = useSession();
  const [counsellor, setCounsellor] = useState<StackPerson | null>(null);
  useEffect(() => {
    if (!c.lead_id || !s.can('counsel')) return;
    supabase().from('counselling_session').select('counsellor:counsellor_id(id,full_name)').eq('lead_id', c.lead_id).not('counsellor_id', 'is', null).order('scheduled_at', { ascending: false }).limit(1)
      .then(({ data }) => { const p = (data?.[0] as Row | undefined)?.counsellor; if (p) setCounsellor({ id: p.id, name: p.full_name, role: 'Counsellor' }); });
  }, [c.lead_id, s]);
  const people: StackPerson[] = [];
  if (c.poc) people.push({ id: c.poc.id, name: c.poc.full_name, role: 'Owner' });
  if (c.batch?.trainer) people.push({ id: c.batch.trainer.id, name: c.batch.trainer.full_name, role: 'Trainer' });
  if (counsellor) people.push(counsellor);
  if (!people.length) return null;
  return <div className="flex items-center gap-2.5"><div className="text-[12px] font-medium text-muted">Worked with</div><AvatarStack people={people} label="Staff who worked with this candidate" /></div>;
}
