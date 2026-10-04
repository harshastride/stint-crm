'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { Pill, cx, fmtDateTime, money } from '../ui';
import { DashboardInsights, change, thisAndLast } from './DashboardInsights';

const JOURNEY: [string, 'lead' | 'candidate', string[]][] = [
  ['Leads', 'lead', ['New']], ['Calls', 'lead', ['Callback', 'Interested']], ['Counselling', 'lead', ['Counselling']], ['Enrolled', 'candidate', ['Enrolled']],
  ['Training', 'candidate', ['Training']], ['Mocks', 'candidate', ['Mocks']], ['Resume + docs', 'candidate', ['Resume', 'Docs']], ['Placement', 'candidate', ['Ready', 'Placed']], ['Alumni', 'candidate', ['Alumni']],
];
const TITLES: Record<string, [string, string]> = {
  Admin: ['Whole CRM at a glance', 'Where everyone is, and what needs attention.'], 'Front desk': ['Today at the desk', 'Who walked in, and whose data sheet is still open?'],
  Marketing: ['Campaigns and sources', 'Which channels bring leads that enrol?'], Telecaller: ['My calls today', 'Who do I call next?'], Sales: ['My pipeline', 'Which deals can I close this week?'],
  'HR / Counsellor': ['My candidates', 'Who needs my help to get interview-ready?'], Trainer: ['My batches', 'Who is falling behind?'], SME: ['My mock reviews', 'Which candidates do I review?'],
  Placement: ['Placements in progress', 'Who is joining and what is pending?'], Finance: ['Collections', 'Who do I collect from and what came in?'],
};

export function Dashboard() {
  const s = useSession();
  const [d, setD] = useState<{ leads: Row[]; cands: Row[]; tasks: Row[]; alerts: Row[]; fees: Row[]; target: number | null; sources: Record<string, string> } | null>(null);

  useEffect(() => {
    const db = supabase();
    (async () => {
      const [leads, cands, tasks, alerts, fees] = await Promise.all([
        s.can('lead') ? db.from('lead').select('id,stage,created_at,owner_id,source_id').limit(5000) : Promise.resolve({ data: [] }),
        s.can('candidate') ? db.from('candidate').select('id,stage,created_at').limit(5000) : Promise.resolve({ data: [] }),
        db.from('follow_up').select('*, lead:lead_id(id,full_name), candidate:candidate_id(id,full_name)').eq('status', 'Open').order('due_at').limit(12),
        s.can('alert') ? db.from('alert').select('*, lead:lead_id(full_name), candidate:candidate_id(full_name)').eq('status', 'Open').order('raised_at', { ascending: false }).limit(6) : Promise.resolve({ data: [] }),
        s.can('payment') ? db.from('fee_payment').select('amount,status,paid_on').limit(5000) : Promise.resolve({ data: [] }),
      ]);
      // this month's enrolment target: your own (Sales) or the whole team's (anyone who can see Sales targets)
      const m = new Date(); const month = new Date(m.getFullYear(), m.getMonth(), 1);
      const monthIso = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-01`;
      let target: number | null = null;
      if (s.can('target')) {
        let q = db.from('sales_target').select('target, staff_id').eq('month', monthIso);
        if (s.staff.role === 'Sales' && s.staff.level !== 'Head') q = q.eq('staff_id', s.staff.id);
        const { data: t } = await q;
        if (t && t.length) target = t.reduce((a: number, r: Row) => a + Number(r.target || 0), 0);
      }
      const sources = Object.fromEntries(s.refs.lead_source.map((x) => [x.id, x.label]));
      setD({ leads: leads.data || [], cands: cands.data || [], tasks: tasks.data || [], alerts: alerts.data || [], fees: fees.data || [], target, sources });
    })();
  }, [s]);

  const [title, sub] = TITLES[s.staff.role] || TITLES.Admin;
  if (!d) return <main className="flex-1 p-8 text-muted">Loading…</main>;

  const today = new Date().toDateString();
  const overdueTasks = d.tasks.filter((t) => new Date(t.due_at).getTime() < Date.now() && new Date(t.due_at).toDateString() !== today).length;
  // headline tiles: value, change vs last month (when it means something), and where to go next
  type Tile = { label: string; value: string | number; delta?: number | null; goodWhenUp?: boolean; bad?: boolean; href: string; note?: string };
  const tiles: Tile[] = [];
  const received = d.fees.filter((f) => f.status === 'Received');
  if (s.can('lead')) {
    const [nowL, lastL] = thisAndLast(d.leads, 'created_at');
    tiles.push({ label: 'Open leads', value: d.leads.filter((l) => !['Converted', 'Not interested'].includes(l.stage)).length, href: '/p/lead' });
    tiles.push({ label: 'New leads this month', value: nowL, delta: change(nowL, lastL), goodWhenUp: true, href: '/p/lead', note: d.leads.filter((l) => new Date(l.created_at).toDateString() === today).length + ' today' });
  }
  if (s.can('candidate')) {
    const [nowC, lastC] = thisAndLast(d.cands, 'created_at');
    tiles.push({ label: 'Enrolled this month', value: nowC, delta: change(nowC, lastC), goodWhenUp: true, href: '/p/candidate', note: d.cands.filter((c) => !['Placed', 'Alumni'].includes(c.stage)).length + ' active' });
    tiles.push({ label: 'Placed', value: d.cands.filter((c) => ['Placed', 'Alumni'].includes(c.stage)).length, href: '/p/placement' });
  }
  if (s.can('payment')) {
    const [nowF, lastF] = thisAndLast(received, 'paid_on', (f) => Number(f.amount));
    const overdue = d.fees.filter((f) => f.status === 'Overdue').reduce((a, f) => a + Number(f.amount), 0);
    tiles.push({ label: 'Collected this month', value: money(nowF), delta: change(nowF, lastF), goodWhenUp: true, href: '/p/payment', note: money(received.reduce((a, f) => a + Number(f.amount), 0)) + ' in all' });
    tiles.push({ label: 'Overdue fees', value: money(overdue), bad: overdue > 0, href: '/p/payment' });
  }
  tiles.push({ label: 'My follow-ups', value: d.tasks.length, bad: overdueTasks > 0, href: '/p/followups', note: overdueTasks ? overdueTasks + ' overdue' : undefined });

  const showJourney = s.can('lead') && s.can('candidate');
  const max = Math.max(1, ...JOURNEY.map(([, kind, st]) => (kind === 'lead' ? d.leads : d.cands).filter((x) => st.includes(x.stage)).length));

  return (
    <main className="flex flex-1 flex-col gap-5 overflow-y-auto p-8">
      <header>
        <div className="text-[13px] font-medium text-muted">{s.staff.role} · Stint Academy</div>
        <h1 className="mt-1 text-[30px] font-semibold leading-tight">{title}</h1>
        <p className="mt-1 text-text2">{sub}</p>
      </header>

      <DashboardInsights leads={d.leads} cands={d.cands} fees={d.fees} target={d.target} sources={d.sources}
        targetLabel={s.staff.role === 'Sales' && s.staff.level !== 'Head' ? 'My enrolments' : 'Team enrolments'} showLeads={s.can('lead')} showFees={s.can('payment')} />

      <section aria-label="Headline numbers" className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        {tiles.map((t, i) => {
          const up = (t.delta ?? 0) >= 0, good = t.goodWhenUp ? up : !up;
          return (
            <div key={t.label} className="anim-rise flex flex-col rounded-2xl border border-line bg-surface" style={{ animationDelay: 200 + i * 50 + 'ms' }}>
              <div className="px-5 pb-3 pt-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[13px] font-medium text-muted">{t.label}</span>
                  {t.delta != null && (
                    <span title="Compared with last month" className={cx('num whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold', good ? 'bg-goodBg text-goodText' : 'bg-badBg text-badText')}>
                      {up ? '▲' : '▼'} {Math.abs(t.delta)}%
                    </span>
                  )}
                </div>
                <div className={cx('num mt-1.5 text-[28px] font-semibold', t.bad && 'text-badText')}>{t.value}</div>
                {t.note && <div className="mt-0.5 text-xs text-muted">{t.note}</div>}
              </div>
              <Link href={t.href} className="mt-auto flex justify-end border-t border-line px-5 py-2.5 text-[13px] font-medium text-accentText hover:bg-surface2">View →</Link>
            </div>
          );
        })}
      </section>

      {showJourney && (
        <section className="rounded-2xl bg-ink p-5 text-[#E6EBF5]">
          <h2 className="text-lg font-semibold">Student journey — where everyone is</h2>
          <div className="mt-4 flex flex-wrap gap-2.5">
            {JOURNEY.map(([name, kind, st], i) => {
              const n = (kind === 'lead' ? d.leads : d.cands).filter((x) => st.includes(x.stage)).length;
              return (
                <div key={name} className="min-w-0 rounded-xl bg-white/10 p-3" style={{ flex: '1 1 max(120px, calc(20% - 10px))' }}>
                  <div className="text-[11px] font-medium text-[#9AA8C4]">{i + 1}. {name}</div>
                  <div className="num mt-1 text-2xl font-semibold text-white">{n}</div>
                  <div className="mt-2 h-1.5 rounded bg-white/15"><div className="h-full rounded bg-coral" style={{ width: Math.round((100 * n) / max) + '%' }} /></div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <section className="rounded-2xl border border-line bg-surface p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Follow-ups due</h2>
            <Link href="/p/followups" className="text-[13px] font-medium text-accentText">Open all</Link>
          </div>
          {d.tasks.length === 0 && <p className="mt-3 text-text2">Nothing due. You’re clear.</p>}
          {d.tasks.slice(0, 7).map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 border-t border-line py-2.5 first:border-0">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium">{t.title}</div>
                <div className="truncate text-xs text-muted">{t.lead?.full_name || t.candidate?.full_name || ''} · {t.owner_role}</div>
              </div>
              <span className={'whitespace-nowrap text-xs font-medium ' + (new Date(t.due_at).getTime() < Date.now() ? 'text-badText' : 'text-text2')}>{fmtDateTime(t.due_at)}</span>
            </div>
          ))}
        </section>
        {s.can('alert') && (
          <section className="rounded-2xl border border-line bg-surface p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Open alerts</h2>
              <Link href="/p/alert" className="text-[13px] font-medium text-accentText">Open all</Link>
            </div>
            {d.alerts.length === 0 && <p className="mt-3 text-text2">No open alerts.</p>}
            {d.alerts.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 border-t border-line py-2.5 first:border-0">
                <div className="truncate text-[13px] font-medium">{a.title}: {a.lead?.full_name || a.candidate?.full_name || ''}</div>
                <Pill>{a.priority}</Pill>
              </div>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
