'use client';
import { Journey } from '@/components/Journey';
import { journey, type StageChange } from '@/lib/journey';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { Pill, cx, fmtDate, fmtDateTime, initials, money } from '@/components/ui';

const GROUPS: [string, string][] = [['contact', 'Contact and address'], ['family', 'Family'], ['identity', 'Identity'], ['bank', 'Bank']];

export default function Candidate360({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const s = useSession();
  const [c, setC] = useState<Row | null>(null);
  const [priv, setPriv] = useState<Row | null>(null);
  const [data, setData] = useState<Record<string, Row[]>>({});
  const [tab, setTab] = useState('Profile');
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const db = supabase();
    const opt = (page: string, q: PromiseLike<{ data: Row[] | null }>) => (s.can(page) ? q : Promise.resolve({ data: [] as Row[] }));
    (async () => {
      const one = await db.from('candidate').select('*, program:program_id(name), batch:batch_id(code), poc:poc_id(full_name)').eq('id', id).maybeSingle();
      if (!one.data) { setMissing(true); return; }
      setC(one.data);
      const ids = [id, one.data.lead_id].filter(Boolean);
      const [p, att, notes, mocks, fb, res, docs, plan, pays, hist] = await Promise.all([
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
      ]);
      setPriv(p.data);
      setData({ hist: (hist.data || []).map((h: Row) => ({ ...h, by_name: h.by?.full_name })), att: att.data || [], notes: notes.data || [], mocks: mocks.data || [], fb: fb.data || [], res: res.data || [], docs: docs.data || [], plan: plan.data || [], pays: pays.data || [] });
    })();
  }, [id, s]);

  if (missing) return <main className="flex-1 p-8 text-text2">This candidate does not exist, or your role can’t open it.</main>;
  if (!c) return <main className="flex-1 p-8 text-muted">Loading…</main>;

  const tabs = ['Profile', 'Education', 'Work experience', s.can('attendance') || s.can('note') ? 'Training' : '', s.can('mock') ? 'Mocks' : '', s.can('resume') ? 'Resume' : '', s.can('doc') ? 'Documents' : '', s.can('plan') ? 'Fees' : ''].filter(Boolean);
  const present = data.att?.length ? Math.round((100 * data.att.filter((a) => a.mark === 'P').length) / data.att.length) + '%' : '—';
  const plan = data.plan?.[0];
  const card = 'rounded-2xl border border-line bg-surface p-5';
  const Lines = ({ rows, empty }: { rows: [string, React.ReactNode, React.ReactNode?][]; empty: string }) => (
    rows.length === 0 ? <p className="text-text2">{empty}</p> : <>{rows.map(([a, b, cc], i) => (
      <div key={i} className="flex items-center justify-between gap-3 border-t border-line py-2.5 first:border-0"><div className="min-w-0"><div className="text-[13px] font-medium">{a}</div>{cc && <div className="text-xs text-muted">{cc}</div>}</div><div className="shrink-0 text-[13px]">{b}</div></div>
    ))}</>
  );

  return (
    <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={'/p/candidate?person=candidate:' + id} className="flex min-h-[40px] items-center rounded-[10px] border border-line2 bg-surface px-3.5 text-sm font-medium">← Back to candidates</Link>
        <span className="rounded-full bg-warnBg px-3 py-1.5 text-xs font-semibold text-warnText">Viewing as {s.staff.role}{s.staff.role === 'Admin' ? ' · sees everything' : ' · some parts are masked or hidden'}</span>
      </div>
      <section className={cx(card, 'flex flex-wrap items-center gap-4')}>
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-ink text-xl font-semibold text-white">{initials(c.full_name)}</div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-muted">Candidate 360 · {c.code}</div>
          <h1 className="text-[26px] font-semibold leading-tight">{c.full_name}</h1>
          <div className="mt-1.5 flex flex-wrap gap-1.5"><Pill>{(c.program?.name || 'No program') + (c.batch?.code ? ' · ' + c.batch.code : '')}</Pill><Pill>{'Stage: ' + c.stage}</Pill></div>
        </div>
        {[['Owner', c.poc?.full_name || '—'], ['Attendance', present], ['Fee due', plan ? money(plan.balance) : '—']].map(([l, v]) => (
          <div key={l} className="rounded-xl bg-surface2 px-3.5 py-2.5"><div className="text-[11px] font-medium text-muted">{l}</div><div className="num text-base font-semibold">{v}</div></div>
        ))}
      </section>
      <section className={card} aria-label="Student journey">
        <h2 className="mb-4 text-base font-semibold">Journey</h2>
        <Journey steps={journey((data.hist || []) as StageChange[], c.stage, c.created_at)} />
      </section>
      <div className="flex flex-wrap gap-1 border-b border-line pb-2">
        {tabs.map((t) => <button key={t} type="button" onClick={() => setTab(t)} className={cx('min-h-[38px] rounded-[10px] px-3.5 text-[13px] font-medium', tab === t ? 'bg-ink text-white' : 'text-text2')}>{t}</button>)}
      </div>

      {tab === 'Profile' && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
          <section className={card}><h2 className="mb-2 text-base font-semibold">Personal</h2>
            <Lines empty="Not filled in yet." rows={[['Full name', c.full_name], ...Object.entries(c.profile || {}).filter(([, v]) => v).map(([k, v]) => [k.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase()), String(v)] as [string, string]), ['Joined', fmtDate(c.joined_on)]]} />
          </section>
          {priv && GROUPS.filter(([g]) => priv.modes[g] !== 'h').map(([g, label]) => (
            <section key={g} className={card}>
              <div className="mb-2 flex items-center justify-between"><h2 className="text-base font-semibold">{label}</h2>
                <span className={cx('rounded-full px-2.5 py-1 text-[11px] font-semibold', priv.modes[g] === 'f' ? 'bg-goodBg text-goodText' : 'bg-warnBg text-warnText')}>{priv.modes[g] === 'f' ? 'Full' : priv.modes[g] === 'm' ? 'Masked for ' + s.staff.role : 'Hidden for ' + s.staff.role}</span></div>
              {priv.modes[g] === 'h' ? <p className="text-text2">Your role can’t see this part.</p>
                : <Lines empty="Not filled in yet." rows={Object.entries(priv[g] || {}).map(([k, v]) => [k.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase()), <span key={k} className="num">{String(v)}</span>])} />}
            </section>
          ))}
        </div>
      )}
      {tab === 'Education' && <section className={card}><Lines empty="No education added. Fill it from the Enrolment form." rows={(c.education || []).map((e: Row) => [e.level || 'Education', [e.years, e.marks && e.marks + '%'].filter(Boolean).join(' · ') || '—', [e.institution, e.board, e.course].filter(Boolean).join(' · ')])} /></section>}
      {tab === 'Work experience' && <section className={card}><Lines empty="No work experience on record." rows={(c.experience || []).map((e: Row) => [e.company || 'Company', [e.joined, e.last_day].filter(Boolean).join(' → ') || '—', [e.role, e.ctc].filter(Boolean).join(' · ')])} /></section>}
      {tab === 'Training' && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
          <section className={card}><h2 className="mb-2 text-base font-semibold">Attendance · {present} present</h2><Lines empty="Not marked yet." rows={(data.att || []).slice(0, 12).map((a) => [fmtDate(a.day), <Pill key={a.day}>{a.mark === 'P' ? 'Present' : a.mark === 'A' ? 'Absent · missed' : 'Late · pending'}</Pill>])} /></section>
          <section className={card}><h2 className="mb-2 text-base font-semibold">Trainer notes</h2><Lines empty="No notes yet." rows={(data.notes || []).map((n) => [n.note, n.flag ? <Pill key={n.id}>{n.flag}</Pill> : '', (n.trainer?.full_name || '') + ' · ' + fmtDate(n.created_at)])} /></section>
        </div>
      )}
      {tab === 'Mocks' && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
          <section className={card}><h2 className="mb-2 text-base font-semibold">Mock sessions</h2><Lines empty="No mocks booked." rows={(data.mocks || []).map((m) => [m.level + ' · ' + (m.trainer?.full_name || ''), <Pill key={m.id}>{m.status}</Pill>, fmtDateTime(m.scheduled_at)])} /></section>
          {s.can('sme') && <section className={card}><h2 className="mb-2 text-base font-semibold">SME feedback</h2><Lines empty="No feedback yet." rows={(data.fb || []).map((f) => [(f.rating || '—') + ' / 5 · ' + (f.comments || ''), <Pill key={f.id}>{f.verdict}</Pill>, (f.sme?.full_name || '') + ' · ' + fmtDate(f.created_at)])} /></section>}
        </div>
      )}
      {tab === 'Resume' && <section className={card}><Lines empty="No resume versions yet." rows={(data.res || []).map((r) => ['Resume ' + r.version + (r.reason ? ' · ' + r.reason : ''), <Pill key={r.id}>{r.status}</Pill>, (r.reviewer?.full_name || '') + ' · ' + fmtDate(r.created_at)])} /></section>}
      {tab === 'Documents' && <section className={card}><Lines empty="No documents requested yet." rows={(data.docs || []).map((d) => [d.doc_type, <Pill key={d.id}>{d.status}</Pill>, d.verified_at ? 'Verified ' + fmtDate(d.verified_at) : ''])} /></section>}
      {tab === 'Fees' && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
          <section className={card}><h2 className="mb-2 text-base font-semibold">Fee plan</h2><Lines empty="No fee plan yet." rows={plan ? [['Total', <span key="t" className="num">{money(plan.total)}</span>], ['Paid', <span key="p" className="num">{money(plan.paid)}</span>], ['Balance', <span key="b" className="num">{money(plan.balance)}</span>], ['Plan', plan.plan]] : []} /></section>
          {s.can('payment') && <section className={card}><h2 className="mb-2 text-base font-semibold">Payments</h2><Lines empty="No payments yet." rows={(data.pays || []).map((p) => [money(p.amount) + (p.mode ? ' · ' + p.mode : ''), <Pill key={p.id}>{p.status}</Pill>, p.paid_on ? 'Paid ' + fmtDate(p.paid_on) : 'Due ' + fmtDate(p.due_on)])} /></section>}
        </div>
      )}
    </main>
  );
}
