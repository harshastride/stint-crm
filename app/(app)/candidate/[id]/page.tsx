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
import { use, useEffect, useState } from 'react';
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

export default function Candidate360({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const s = useSession();
  const [c, setC] = useState<Row | null>(null);
  const [priv, setPriv] = useState<Row | null>(null);
  const [data, setData] = useState<Record<string, Row[]>>({});
  const [tab, setTab] = useState('Profile');
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
  useEffect(() => { if (tab === 'Activity') supabase().rpc('person_timeline', { p_lead: null, p_candidate: id }).then(({ data }) => setTimeline(data || [])); }, [tab, id, reload]);

  if (missing) return <main className="flex-1 p-8 text-text2">This candidate does not exist, or your role can’t open it.</main>;
  if (!c) return <PageSkeleton />;

  const plan = data.plan?.[0];
  const pl = (data.plc || [])[0], job = (data.jobs || [])[0];
  const docsIn = (data.docs || []).filter((d) => d.status !== 'Missing').length;
  const tabs: [string, number | null][] = ([
    ['Profile', null],
    ['Activity', null],
    s.can('attendance') || s.can('note') ? ['Training', (data.notes || []).length || null] : null,
    s.can('mock') ? ['Mocks', (data.mocks || []).length || null] : null,
    s.can('resume') ? ['Resume', (data.res || []).length || null] : null,
    s.can('doc') ? ['Documents', (data.docs || []).length || null] : null,
    s.can('plan') ? ['Fees', (data.pays || []).length || null] : null,
    s.can('placement') ? ['Placement', null] : null,
    s.can('placement') && (data.jobs || []).length ? ['Job papers', (data.jobs || []).length] : null,
  ] as ([string, number | null] | null)[]).filter(Boolean) as [string, number | null][];
  const present = data.att?.length ? Math.round((100 * data.att.filter((a) => a.mark === 'P').length) / data.att.length) + '%' : '—';
  const nextSteps = stepsForStage(c.stage).filter((st) => !st.inline && s.can(st.page, 'w'));
  const label = 'mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted';
  const block = 'border-t border-line pt-4 first:border-0 first:pt-0';
  const Lines = ({ rows, empty }: { rows: [string, React.ReactNode, React.ReactNode?][]; empty: string }) => (
    rows.length === 0 ? <p className="py-2 text-[13.5px] text-text2">{empty}</p> : <>{rows.map(([a, b, cc], i) => (
      <div key={i} className="flex min-h-[44px] items-center justify-between gap-3 border-t border-line py-2 first:border-0"><div className="min-w-0"><div className="break-words text-[13.5px] font-medium">{a}</div>{cc && <div className="break-words text-xs text-muted">{cc}</div>}</div><div className="shrink-0 text-[13px]">{b}</div></div>
    ))}</>
  );
  const Sec = ({ title, children, aria }: { title: string; children: React.ReactNode; aria?: string }) => <section className={block} aria-label={aria}><h2 className={label}>{title}</h2>{children}</section>;
  const KV = ({ rows }: { rows: [string, React.ReactNode][] }) => (
    <dl className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-x-3 text-[13px]">
      {rows.map(([k, v]) => <div key={k} className="contents"><dt className="border-t border-line py-1.5 text-muted [&:nth-child(1)]:border-0">{k}</dt><dd className="num break-words border-t border-line py-1.5 font-medium [&:nth-child(2)]:border-0">{v}</dd></div>)}
    </dl>
  );

  return (
    <main className="flex-1 overflow-y-auto p-page-sm md:px-page md:py-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
        <Link href={'/p/candidate?person=candidate:' + id} className="-ml-2 flex min-h-[44px] items-center rounded-row px-2 font-medium text-text2 transition-colors duration-150 hover:bg-surface2 hover:text-text">← Candidates</Link>
        <span className="text-muted">/ {c.code}</span>
        <span className="ml-auto text-muted" title={s.staff.role === 'Admin' ? 'Admin sees everything' : 'Some parts are masked or hidden for your role'}>Viewing as {s.staff.role}{s.staff.role === 'Admin' ? '' : ' · some parts masked'}</span>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:items-start">
        <aside className="flex flex-col gap-4 xl:sticky xl:top-0 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto xl:border-r xl:border-line xl:pr-5" aria-label="Candidate summary" role="region">
          <div className="flex items-start gap-3">
            <PhotoUpload kind="candidate" id={c.id as string} name={c.full_name as string} photo={(c.photo_path as string | null) ?? null} canEdit={s.can('candidate', 'w')} onChange={(p) => setC({ ...c, photo_path: p })} />
            <div className="min-w-0 flex-1">
              <h1 className="break-words text-[20px] font-semibold leading-tight">{c.full_name}</h1>
              <div className="mt-0.5 break-words text-[12.5px] text-text2">{(c.program?.name || 'No program') + (c.batch?.code ? ' · ' + c.batch.code : ' · No batch yet')}</div>
              {(c.tags || []).length > 0 && <div className="mt-1.5 flex flex-wrap gap-1"><TagChips tags={c.tags} max={6} /></div>}
            </div>
          </div>
          <CandidateTeam c={c} />
          <StageControl kind="candidate" id={id} stage={c.stage} changedAt={c.stage_changed_at} onMoved={() => setReload((n) => n + 1)} />
          <NextSteps inline stage={c.stage} steps={nextSteps} onRun={(st) => st.href && router.push(st.href({ kind: 'candidate', id }))} />
          <section className="border-t border-line pt-3" aria-label="Key facts">
            <h2 className={label}>Key facts</h2>
            <KV rows={[['Owner', c.poc?.full_name || 'Not set'], ['Attendance', present], ['Fee due', plan ? money(plan.balance) : 'No plan'], ...(c.joined_on ? [['Joined', fmtDate(c.joined_on)] as [string, string]] : [])]} />
            {((plan && Number(plan.total) > 0) || (data.docs || []).length > 0) && <div className="mt-3 flex flex-col gap-3">
              {plan && Number(plan.total) > 0 && <Meter label="Fees paid" value={Number(plan.paid)} max={Number(plan.total)} text={`${money(plan.paid)} of ${money(plan.total)}`} />}
              {(data.docs || []).length > 0 && <Meter label="Documents in" value={docsIn} max={(data.docs || []).length} />}
            </div>}
          </section>
          {pl && <section className="border-t border-line pt-3" aria-label="Placement tracker">
            <h2 className={label}>Placement · {pl.company?.name || 'Company'}{pl.role ? ' · ' + pl.role : ''}</h2>
            <PlacementSteps pl={pl} job={job} />
          </section>}
        </aside>

        <div className="flex min-w-0 flex-col gap-4">
          <section aria-label="Student journey" className="overflow-x-auto pb-1"><Journey steps={journey((data.hist || []) as StageChange[], c.stage, c.created_at)} /></section>
          <div className="sticky top-0 z-[2] -mx-1 flex gap-0.5 overflow-x-auto border-b border-line bg-bg px-1" role="group" aria-label="Candidate sections">
            {tabs.map(([t, n]) => <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)} aria-label={t} className={cx('relative flex min-h-[44px] shrink-0 items-center gap-1.5 px-3 text-[13.5px] transition-colors duration-150', tab === t ? 'font-semibold text-accentText after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent' : 'font-medium text-text2 hover:text-text')}>{t}{n !== null && <span className="num rounded-full bg-surface2 px-1.5 text-[11px] text-muted">{n}</span>}</button>)}
          </div>

          {tab === 'Profile' && (
            <div className="grid gap-x-8 gap-y-5 2xl:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-4">
                {(s.can('sme') || s.can('mock')) && ((data.fb || []).length > 0 || (data.mocks || []).some((m) => m.status === 'Passed' || m.status === 'Failed')) && <RatingSummary reviews={s.can('sme') ? data.fb || [] : []} mocks={data.mocks || []} />}
                {s.can('practice') && <PracticeCard attempts={(data.prac || []) as unknown as PracticeAttempt[]} />}
                <Sec title="Education"><Lines empty="No education added. Fill it from the Enrolment form." rows={(c.education || []).map((e: Row) => [e.level || 'Education', [e.years, e.marks && e.marks + '%'].filter(Boolean).join(' · ') || '—', [e.institution, e.board, e.course].filter(Boolean).join(' · ')])} /></Sec>
                <Sec title="Work experience"><Lines empty="No work experience on record." rows={(c.experience || []).map((e: Row) => [e.company || 'Company', [e.joined, e.last_day].filter(Boolean).join(' → ') || '—', [e.role, e.ctc].filter(Boolean).join(' · ')])} /></Sec>
              </div>
              <section className="flex min-w-0 flex-col gap-2.5" aria-label="Details">
                <h2 className={label}>Details</h2>
                <DetailGroup title="Personal" rows={[['Full name', c.full_name], ...Object.entries(c.profile || {}).filter(([, v]) => v).map(([k, v]) => [k.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase()), String(v)] as [string, string]), ['Joined', c.joined_on ? fmtDate(c.joined_on) : '']]} />
                <PrivateDetails id={id} priv={priv} />
              </section>
            </div>
          )}
          {tab === 'Activity' && <section aria-label="Activity">{timeline === null ? <p className="text-text2">Loading…</p> : <Timeline items={timeline} />}</section>}
          {tab === 'Training' && (
            <div className="grid gap-x-8 gap-y-5 2xl:grid-cols-2">
              <Sec title={`Attendance · ${present} present`}><Lines empty="Not marked yet." rows={(data.att || []).slice(0, 12).map((a) => [fmtDate(a.day), <Pill key={a.day}>{a.mark === 'P' ? 'Present' : a.mark === 'A' ? 'Absent · missed' : 'Late · pending'}</Pill>])} /></Sec>
              <Sec title="Trainer notes"><Lines empty="No notes yet." rows={(data.notes || []).map((n) => [n.note, n.flag ? <Pill key={n.id}>{n.flag}</Pill> : '', (n.trainer?.full_name || '') + ' · ' + fmtDate(n.created_at)])} /></Sec>
            </div>
          )}
          {tab === 'Mocks' && (
            <div className="grid gap-x-8 gap-y-5 2xl:grid-cols-2">
              <Sec title="Mock sessions"><Lines empty="No mocks booked." rows={(data.mocks || []).map((m) => [m.level + ' · ' + (m.trainer?.full_name || ''), <Pill key={m.id}>{m.status}</Pill>, fmtDateTime(m.scheduled_at)])} /></Sec>
              {s.can('sme') && <Sec title="SME feedback"><Lines empty="No feedback yet." rows={(data.fb || []).map((f) => [(f.rating || '—') + ' / 5 · ' + (f.comments || ''), <Pill key={f.id}>{f.verdict}</Pill>, (f.sme?.full_name || '') + ' · ' + fmtDate(f.created_at)])} /></Sec>}
            </div>
          )}
          {tab === 'Resume' && <Sec title="Resume versions"><Lines empty="No resume versions yet." rows={(data.res || []).map((r) => ['Resume ' + r.version + (r.reason ? ' · ' + r.reason : ''), <Pill key={r.id}>{r.status}</Pill>, (r.reviewer?.full_name || '') + ' · ' + fmtDate(r.created_at)])} /></Sec>}
          {tab === 'Documents' && <FileTree label="Candidate files" folders={[
            { id: 'f-doc', name: 'Identity & education', files: (data.docs || []).map((d) => ({ id: 'd-' + d.id, name: d.doc_type, path: d.file_path || null, status: d.status, note: d.verified_at ? 'Verified ' + fmtDate(d.verified_at) : '' })) },
            ...(s.can('resume') ? [{ id: 'f-res', name: 'Resumes', files: (data.res || []).filter((r) => r.file_path).map((r) => ({ id: 'r-' + r.id, name: r.version, path: r.file_path, status: r.status })) }] : []),
          ]} />}
          {tab === 'Fees' && (
            <div className="grid gap-x-8 gap-y-5 2xl:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-4">
                <Sec title="Fee plan">{plan ? <KV rows={[['Total', money(plan.total)], ['Paid', money(plan.paid)], ['Balance', money(plan.balance)], ['Plan', plan.plan || '—']]} /> : <p className="text-[13.5px] text-text2">No fee plan yet.</p>}</Sec>
                <Sec title="Fee agreement signature">
                  {(data.sig || [])[0] ? <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={(data.sig || [])[0].png} alt={'Signature of ' + c.full_name} className="h-20 w-auto rounded-lg border border-line bg-white p-1" />
                    <p className="mt-1.5 text-[12.5px] text-text2">Signed in the student portal on {fmtDate((data.sig || [])[0].signed_at)}.</p>
                  </> : <p className="text-[13.5px] text-text2">Not signed yet. The student signs in the portal.</p>}
                </Sec>
              </div>
              {s.can('payment') && <Sec title="Payments"><Lines empty="No payments yet." rows={(data.pays || []).map((p) => [money(p.amount) + (p.mode ? ' · ' + p.mode : ''), <Pill key={p.id}>{p.status}</Pill>, p.paid_on ? 'Paid ' + fmtDate(p.paid_on) : 'Due ' + fmtDate(p.due_on)])} /></Sec>}
            </div>
          )}
          {tab === 'Placement' && (pl ? (
            <Sec title={'Placement · ' + (pl.company?.name || 'Company')}>
              <KV rows={[['Company', pl.company?.name || '—'], ['Role', pl.role || '—'], ['Package', pl.ctc_lpa ? pl.ctc_lpa + ' LPA' : '—'], ['Status', pl.status || '—'], ['Joining date', pl.joining_on ? fmtDate(pl.joining_on) : 'Not fixed yet'], ['Recorded', fmtDate(pl.created_at)]]} />
            </Sec>
          ) : <p className="text-[13.5px] text-text2">No placement recorded yet.</p>)}
          {tab === 'Job papers' && (
            <div className="grid gap-x-8 gap-y-5 2xl:grid-cols-2">
              {(data.jobs || []).map((j) => (
                <Sec key={j.id} title={(j.company || 'Company') + (j.joined_on ? ' · joined ' + fmtDate(j.joined_on) : '')}>
                  <JobPapers job={j} canWrite={s.can('jobdocs', 'w')} />
                </Sec>
              ))}
            </div>
          )}
        </div>
      </div>
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
