'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { Pill, fmtDateTime, money } from '../ui';

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
  const [d, setD] = useState<{ leads: Row[]; cands: Row[]; tasks: Row[]; alerts: Row[]; fees: Row[] } | null>(null);

  useEffect(() => {
    const db = supabase();
    (async () => {
      const [leads, cands, tasks, alerts, fees] = await Promise.all([
        s.can('lead') ? db.from('lead').select('id,stage,created_at,owner_id').limit(2000) : Promise.resolve({ data: [] }),
        s.can('candidate') ? db.from('candidate').select('id,stage').limit(2000) : Promise.resolve({ data: [] }),
        db.from('follow_up').select('*, lead:lead_id(id,full_name), candidate:candidate_id(id,full_name)').eq('status', 'Open').order('due_at').limit(12),
        s.can('alert') ? db.from('alert').select('*, lead:lead_id(full_name), candidate:candidate_id(full_name)').eq('status', 'Open').order('raised_at', { ascending: false }).limit(6) : Promise.resolve({ data: [] }),
        s.can('payment') ? db.from('fee_payment').select('amount,status,paid_on').limit(5000) : Promise.resolve({ data: [] }),
      ]);
      setD({ leads: leads.data || [], cands: cands.data || [], tasks: tasks.data || [], alerts: alerts.data || [], fees: fees.data || [] });
    })();
  }, [s]);

  const [title, sub] = TITLES[s.staff.role] || TITLES.Admin;
  if (!d) return <main className="flex-1 p-8 text-muted">Loading…</main>;

  const today = new Date().toDateString();
  const overdueTasks = d.tasks.filter((t) => new Date(t.due_at).getTime() < Date.now() && new Date(t.due_at).toDateString() !== today).length;
  const kpis: [string, string | number, string?][] = [];
  if (s.can('lead')) { kpis.push(['Open leads', d.leads.filter((l) => !['Converted', 'Not interested'].includes(l.stage)).length]); kpis.push(['New leads today', d.leads.filter((l) => new Date(l.created_at).toDateString() === today).length]); }
  if (s.can('candidate')) { kpis.push(['Active candidates', d.cands.filter((c) => !['Placed', 'Alumni'].includes(c.stage)).length]); kpis.push(['Placed', d.cands.filter((c) => ['Placed', 'Alumni'].includes(c.stage)).length]); }
  if (s.can('payment')) { kpis.push(['Collected', money(d.fees.filter((f) => f.status === 'Received').reduce((a, f) => a + Number(f.amount), 0))]); kpis.push(['Overdue', money(d.fees.filter((f) => f.status === 'Overdue').reduce((a, f) => a + Number(f.amount), 0)), 'bad']); }
  kpis.push(['My follow-ups', d.tasks.length, overdueTasks ? 'bad' : undefined]);

  const showJourney = s.can('lead') && s.can('candidate');
  const max = Math.max(1, ...JOURNEY.map(([, kind, st]) => (kind === 'lead' ? d.leads : d.cands).filter((x) => st.includes(x.stage)).length));

  return (
    <main className="flex flex-1 flex-col gap-5 overflow-y-auto p-8">
      <header>
        <div className="text-[13px] font-medium text-muted">{s.staff.role} · Stint Academy</div>
        <h1 className="mt-1 text-[30px] font-semibold leading-tight">{title}</h1>
        <p className="mt-1 text-text2">{sub}</p>
      </header>

      <section aria-label="Headline numbers" className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        {kpis.map(([l, v, tone]) => (
          <div key={l} className="rounded-2xl border border-line bg-surface px-5 py-4">
            <div className="text-[13px] font-medium text-muted">{l}</div>
            <div className={'num mt-1.5 text-[28px] font-semibold ' + (tone === 'bad' && v !== 0 && v !== '₹0' ? 'text-badText' : '')}>{v}</div>
          </div>
        ))}
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
