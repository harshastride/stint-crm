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
import { Pill, cx, fmtDate, fmtDateTime, initials, money } from '@/components/ui';
import { PageSkeleton } from '@/components/Skeletons';
import { StageControl } from '@/components/profile/StageControl';
import { NextSteps } from '@/components/profile/NextSteps';
import { DetailGroup, PrivateDetails } from '@/components/profile/PrivateDetails';
import { Timeline } from '@/components/Timeline';
import { stepsForStage } from '@/lib/nextSteps';
import { useRouter } from 'next/navigation';
import { AvatarStack, type StackPerson } from '@/components/kit/AvatarStack';

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
        opt('placement', db.from('job_record').select('id, company, joined_on').eq('candidate_id', id)),
        opt('practice', db.from('interview_practice').select('topic, question, overall, accuracy, fluency, completeness, wpm, filler_count, created_at').eq('candidate_id', id).order('created_at', { ascending: false }).limit(50)),
      ]);
      setPriv(p.data);
      setData({ hist: (hist.data || []).map((h: Row) => ({ ...h, by_name: h.by?.full_name })), att: att.data || [], notes: notes.data || [], mocks: mocks.data || [], fb: fb.data || [], res: res.data || [], docs: docs.data || [], plan: plan.data || [], pays: pays.data || [], sig: sig.data || [], plc: plc.data || [], jobs: jobs.data || [], prac: prac.data || [] });
    })();
  }, [id, s, reload]);
  useEffect(() => { if (tab === 'Activity') supabase().rpc('person_timeline', { p_lead: null, p_candidate: id }).then(({ data }) => setTimeline(data || [])); }, [tab, id, reload]);

  if (missing) return <main className="flex-1 p-8 text-text2">This candidate does not exist, or your role can’t open it.</main>;
  if (!c) return <PageSkeleton />;

  const tabs = ['Profile', 'Activity', 'Education', 'Work experience', s.can('attendance') || s.can('note') ? 'Training' : '', s.can('mock') ? 'Mocks' : '', s.can('resume') ? 'Resume' : '', s.can('doc') ? 'Documents' : '', s.can('plan') ? 'Fees' : ''].filter(Boolean);
  const present = data.att?.length ? Math.round((100 * data.att.filter((a) => a.mark === 'P').length) / data.att.length) + '%' : '—';
  const plan = data.plan?.[0];
  const nextSteps = stepsForStage(c.stage).filter((st) => !st.inline && s.can(st.page, 'w'));
  const card = 'rounded-card bg-surface p-card shadow-1';
  const Lines = ({ rows, empty }: { rows: [string, React.ReactNode, React.ReactNode?][]; empty: string }) => (
    rows.length === 0 ? <p className="text-text2">{empty}</p> : <>{rows.map(([a, b, cc], i) => (
      <div key={i} className="flex items-center justify-between gap-3 border-t border-line py-2.5 first:border-0"><div className="min-w-0"><div className="truncate text-[13.5px] font-medium" title={typeof a === 'string' ? a : undefined}>{a}</div>{cc && <div className="truncate text-xs text-muted" title={typeof cc === 'string' ? cc : undefined}>{cc}</div>}</div><div className="shrink-0 text-[13px]">{b}</div></div>
    ))}</>
  );

  return (
    <main className="flex flex-1 flex-col gap-section overflow-y-auto p-page-sm md:p-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={'/p/candidate?person=candidate:' + id} className="flex min-h-[44px] items-center gap-1.5 rounded-row px-2.5 text-[13.5px] font-medium text-text2 transition-colors duration-150 hover:bg-surface2 hover:text-text">← Back to candidates</Link>
        <span className="rounded-full bg-warnBg px-3 py-1 text-[12px] font-medium text-warnText">Viewing as {s.staff.role}{s.staff.role === 'Admin' ? ' · sees everything' : ' · some parts are masked or hidden'}</span>
      </div>
      <section className={cx(card, 'flex flex-col gap-4 p-5')} aria-label="Candidate summary">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-card bg-accentSoft text-lg font-semibold text-accentText sm:h-16 sm:w-16 sm:text-xl" aria-hidden>{initials(c.full_name)}</div>
          <div className="min-w-0 flex-1 basis-56">
            <div className="text-xs font-medium text-muted">Candidate · {c.code}</div>
            <h1 className="line-clamp-2 break-words text-[22px] font-semibold leading-tight">{c.full_name}</h1>
            <div className="mt-1.5 flex flex-wrap gap-1.5"><Pill>{(c.program?.name || 'No program') + (c.batch?.code ? ' · ' + c.batch.code : ' · No batch yet')}</Pill><TagChips tags={c.tags} max={6} /></div>
          </div>
          <CandidateTeam c={c} />
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <StageControl kind="candidate" id={id} stage={c.stage} changedAt={c.stage_changed_at} onMoved={() => setReload((n) => n + 1)} />
          <NextSteps inline stage={c.stage} steps={nextSteps} onRun={(st) => st.href && router.push(st.href({ kind: 'candidate', id }))} />
        </div>
        <dl className="grid grid-cols-3 gap-2">
          {[['Owner', c.poc?.full_name || 'Not set'], ['Attendance', present], ['Fee due', plan ? money(plan.balance) : 'No plan']].map(([l, v]) => (
            <div key={l} className="min-w-0 rounded-control bg-surface2 px-3 py-2"><dt className="text-[12px] font-medium text-muted">{l}</dt><dd className="num truncate text-[15px] font-semibold">{v}</dd></div>
          ))}
        </dl>
      </section>
      {(plan || (data.docs || []).length > 0) && (
        <section className={cx(card, 'grid gap-4 sm:grid-cols-2')} aria-label="Progress">
          {plan && Number(plan.total) > 0 && <Meter label="Fees paid" value={Number(plan.paid)} max={Number(plan.total)} text={`${money(plan.paid)} of ${money(plan.total)}`} />}
          {(data.docs || []).length > 0 && <Meter label="Documents in" value={(data.docs || []).filter((d) => d.status !== 'Missing').length} max={(data.docs || []).length} />}
        </section>
      )}
      {(data.plc || [])[0] && (() => {
        const pl = (data.plc || [])[0], job = (data.jobs || [])[0], dropped = pl.status === 'Dropped';
        const joined = pl.status === 'Joined' || !!job;
        return (
          <section className={card} aria-label="Placement tracker">
            <h2 className="mb-3 text-base font-semibold">Placement · {pl.company?.name || 'Company'}{pl.role ? ' · ' + pl.role : ''}</h2>
            <Tracker label="Placement steps" steps={[
              { label: 'Offer accepted', note: [pl.company?.name, pl.ctc_lpa ? pl.ctc_lpa + ' LPA' : '', 'recorded ' + fmtDate(pl.created_at)].filter(Boolean).join(' · '), done: true },
              { label: 'Joining date fixed', note: pl.joining_on ? fmtDate(pl.joining_on) : 'Not fixed yet', done: !!pl.joining_on },
              { label: dropped ? 'Dropped' : 'Joined', note: dropped ? 'The candidate did not join.' : joined ? 'Joined' + (job?.joined_on ? ' on ' + fmtDate(job.joined_on) : '') : pl.joining_on && new Date(pl.joining_on) < new Date() ? 'Joining date passed: please confirm' : 'Waiting for joining day', done: joined, bad: dropped },
              { label: 'Job papers tracked', note: job ? 'Papers are tracked under Job papers.' : 'Starts once they join.', done: !!job },
            ]} />
          </section>
        );
      })()}
      <section className={card} aria-label="Student journey">
        <h2 className="mb-4 text-base font-semibold">Journey</h2>
        <Journey steps={journey((data.hist || []) as StageChange[], c.stage, c.created_at)} />
      </section>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Candidate sections">
        {tabs.map((t) => <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)} className={cx('min-h-[44px] rounded-row px-3.5 text-[13.5px] transition-colors duration-150 active:scale-[0.97]', tab === t ? 'bg-accentSoft font-semibold text-accentText' : 'font-medium text-text2 hover:bg-surface2 hover:text-text')}>{t}</button>)}
      </div>

      {tab === 'Profile' && (
        <div className="grid gap-section" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
          {(s.can('sme') || s.can('mock')) && ((data.fb || []).length > 0 || (data.mocks || []).some((m) => m.status === 'Passed' || m.status === 'Failed')) && <RatingSummary reviews={s.can('sme') ? data.fb || [] : []} mocks={data.mocks || []} />}
          {s.can('practice') && <PracticeCard attempts={(data.prac || []) as unknown as PracticeAttempt[]} />}
          <section className={cx(card, 'flex flex-col gap-2.5')} aria-label="Details">
            <h2 className="text-base font-semibold">Details</h2>
            <DetailGroup title="Personal" rows={[['Full name', c.full_name], ...Object.entries(c.profile || {}).filter(([, v]) => v).map(([k, v]) => [k.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase()), String(v)] as [string, string]), ['Joined', c.joined_on ? fmtDate(c.joined_on) : '']]} />
            <PrivateDetails id={id} priv={priv} />
          </section>
        </div>
      )}
      {tab === 'Activity' && <section className={card} aria-label="Activity">{timeline === null ? <p className="text-text2">Loading…</p> : <Timeline items={timeline} />}</section>}
      {tab === 'Education' && <section className={card}><Lines empty="No education added. Fill it from the Enrolment form." rows={(c.education || []).map((e: Row) => [e.level || 'Education', [e.years, e.marks && e.marks + '%'].filter(Boolean).join(' · ') || '—', [e.institution, e.board, e.course].filter(Boolean).join(' · ')])} /></section>}
      {tab === 'Work experience' && <section className={card}><Lines empty="No work experience on record." rows={(c.experience || []).map((e: Row) => [e.company || 'Company', [e.joined, e.last_day].filter(Boolean).join(' → ') || '—', [e.role, e.ctc].filter(Boolean).join(' · ')])} /></section>}
      {tab === 'Training' && (
        <div className="grid gap-section" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
          <section className={card}><h2 className="mb-2 text-base font-semibold">Attendance · {present} present</h2><Lines empty="Not marked yet." rows={(data.att || []).slice(0, 12).map((a) => [fmtDate(a.day), <Pill key={a.day}>{a.mark === 'P' ? 'Present' : a.mark === 'A' ? 'Absent · missed' : 'Late · pending'}</Pill>])} /></section>
          <section className={card}><h2 className="mb-2 text-base font-semibold">Trainer notes</h2><Lines empty="No notes yet." rows={(data.notes || []).map((n) => [n.note, n.flag ? <Pill key={n.id}>{n.flag}</Pill> : '', (n.trainer?.full_name || '') + ' · ' + fmtDate(n.created_at)])} /></section>
        </div>
      )}
      {tab === 'Mocks' && (
        <div className="grid gap-section" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
          <section className={card}><h2 className="mb-2 text-base font-semibold">Mock sessions</h2><Lines empty="No mocks booked." rows={(data.mocks || []).map((m) => [m.level + ' · ' + (m.trainer?.full_name || ''), <Pill key={m.id}>{m.status}</Pill>, fmtDateTime(m.scheduled_at)])} /></section>
          {s.can('sme') && <section className={card}><h2 className="mb-2 text-base font-semibold">SME feedback</h2><Lines empty="No feedback yet." rows={(data.fb || []).map((f) => [(f.rating || '—') + ' / 5 · ' + (f.comments || ''), <Pill key={f.id}>{f.verdict}</Pill>, (f.sme?.full_name || '') + ' · ' + fmtDate(f.created_at)])} /></section>}
        </div>
      )}
      {tab === 'Resume' && <section className={card}><Lines empty="No resume versions yet." rows={(data.res || []).map((r) => ['Resume ' + r.version + (r.reason ? ' · ' + r.reason : ''), <Pill key={r.id}>{r.status}</Pill>, (r.reviewer?.full_name || '') + ' · ' + fmtDate(r.created_at)])} /></section>}
      {tab === 'Documents' && <section className={card}><FileTree label="Candidate files" folders={[
        { id: 'f-doc', name: 'Identity & education', files: (data.docs || []).map((d) => ({ id: 'd-' + d.id, name: d.doc_type, path: d.file_path || null, status: d.status, note: d.verified_at ? 'Verified ' + fmtDate(d.verified_at) : '' })) },
        ...(s.can('resume') ? [{ id: 'f-res', name: 'Resumes', files: (data.res || []).filter((r) => r.file_path).map((r) => ({ id: 'r-' + r.id, name: r.version, path: r.file_path, status: r.status })) }] : []),
      ]} /></section>}
      {tab === 'Fees' && (
        <div className="grid gap-section" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
          <section className={card}><h2 className="mb-2 text-base font-semibold">Fee plan</h2><Lines empty="No fee plan yet." rows={plan ? [['Total', <span key="t" className="num">{money(plan.total)}</span>], ['Paid', <span key="p" className="num">{money(plan.paid)}</span>], ['Balance', <span key="b" className="num">{money(plan.balance)}</span>], ['Plan', plan.plan]] : []} /></section>
          <section className={card}><h2 className="mb-2 text-base font-semibold">Fee agreement signature</h2>
            {(data.sig || [])[0] ? <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={(data.sig || [])[0].png} alt={'Signature of ' + c.full_name} className="h-24 w-auto rounded-lg border border-line bg-white p-1" />
              <p className="mt-1.5 text-[12.5px] text-text2">Signed in the student portal on {fmtDate((data.sig || [])[0].signed_at)}.</p>
            </> : <p className="text-text2">Not signed yet. The student signs in the portal.</p>}
          </section>
          {s.can('payment') && <section className={card}><h2 className="mb-2 text-base font-semibold">Payments</h2><Lines empty="No payments yet." rows={(data.pays || []).map((p) => [money(p.amount) + (p.mode ? ' · ' + p.mode : ''), <Pill key={p.id}>{p.status}</Pill>, p.paid_on ? 'Paid ' + fmtDate(p.paid_on) : 'Due ' + fmtDate(p.due_on)])} /></section>}
        </div>
      )}
    </main>
  );
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
  return <div className="rounded-control bg-surface2 px-3.5 py-2"><div className="mb-1 text-[12px] font-medium text-muted">Worked with</div><AvatarStack people={people} label="Staff who worked with this candidate" /></div>;
}
