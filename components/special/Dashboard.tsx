'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Info } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { Pill, cx, fmtDateTime, money } from '../ui';
import { DashboardInsights, type SourceRow } from './DashboardInsights';
import { PageSkeleton } from '../Skeletons';
import { ActivityHeatmap } from '../kit/Heatmap';
import { Checklist } from '../kit/Checklist';
import { Sparkline, type SparkPoint } from '../kit/Sparkline';
import { StatSkeleton } from '../kit/StatSkeleton';
import { Leaderboard } from '../kit/Leaderboard';
import { Funnel } from '../kit/Funnel';
import { TargetRing } from '../kit/TargetRing';
import { PageHeader } from '../kit/PageHeader';

const TITLES: Record<string, [string, string]> = {
  Admin: ['Whole CRM at a glance', 'What needs attention, then how the month is going.'], 'Front desk': ['Today at the desk', 'Who walked in, and whose data sheet is still open?'],
  Marketing: ['Campaigns and sources', 'Which channels bring leads that enrol?'], Telecaller: ['My calls today', 'Who do I call next?'], Sales: ['My pipeline', 'Which deals can I close this week?'],
  'HR / Counsellor': ['My candidates', 'Who needs my help to get interview-ready?'], Trainer: ['My batches', 'Who is falling behind?'], SME: ['My mock reviews', 'Which candidates do I review?'],
  Placement: ['Placements in progress', 'Who is joining and what is pending?'], Finance: ['Collections', 'Who do I collect from and what came in?'],
};

// Every number below comes from dashboard_metrics(): counted in the database with the viewer's own rights,
// India time. null = the viewer cannot see that page, so the tile is not shown.
type Metrics = {
  today: string; month_from: string; last_from: string; last_to: string;
  fu_overdue: number | null; fu_today: number | null; fu_open: number | null; alerts_open: number | null; alerts_high: number | null;
  fees_overdue_n: number | null; fees_overdue_amt: number | null; collected_month: number | null; collected_last: number | null;
  leads_open: number | null; leads_month: number | null; leads_last: number | null; leads_today: number | null;
  enrolled_month: number | null; enrolled_last: number | null; joining_soon: number | null;
  target: number | null; target_mine: boolean; target_done: number | null; sources: SourceRow[] | null;
};
type Tile = { id: string; label: string; value: string | number; def: string; href: string; tone?: 'bad' | 'good'; note?: string; spark?: SparkPoint[]; sparkMoney?: boolean };

const short = (iso: string) => new Date(iso + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const span = (a: string, b: string) => (a === b ? short(a) : a.slice(0, 7) === b.slice(0, 7) ? `${Number(a.slice(8))}–${short(b)}` : `${short(a)} – ${short(b)}`);

function StatTile({ t, compact }: { t: Tile; compact?: boolean }) {
  const [why, setWhy] = useState(false);
  return (
    <div data-testid="tile" data-tile={t.id} className="flex flex-col rounded-row border border-line bg-surface px-3 py-2">
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-muted" title={t.label}>{t.label}</span>
        <button type="button" aria-expanded={why} aria-label={'How “' + t.label + '” is counted'} onClick={() => setWhy(!why)}
          className="-my-2 flex h-11 w-9 shrink-0 items-center justify-center rounded-row text-muted hover:bg-surface2 hover:text-text"><Info size={13} /></button>
        <Link href={t.href} data-testid="tile-link" aria-label={'Open list: ' + t.label} title="Open list"
          className="-my-2 -mr-2 flex h-11 w-9 shrink-0 items-center justify-center rounded-row text-accentText hover:bg-surface2"><ArrowRight size={15} /></Link>
      </div>
      <div className={cx('flex items-end gap-3', compact ? 'mt-0.5' : 'mt-1')}>
        <div className="min-w-0 flex-1">
          <div data-testid="tile-value" className={cx('num font-semibold leading-none', compact ? 'text-[22px]' : 'text-[24px]', t.tone === 'bad' && 'text-badText')}>{t.value}</div>
          {t.note && <div className="mt-1 text-[11.5px] leading-snug text-muted">{t.note}</div>}
        </div>
        {t.spark && (
          <div className="w-[45%] shrink-0" title="Per day, last 30 days">
            <Sparkline points={t.spark} label={t.label} format={t.sparkMoney ? (n) => money(n) : undefined} />
          </div>
        )}
      </div>
      {why && <p className="mt-2 rounded-row bg-surface2 p-2 text-[12px] leading-relaxed text-text2">{t.def}</p>}
    </div>
  );
}

function Tiles({ label, tiles, compact }: { label: string; tiles: Tile[]; compact?: boolean }) {
  if (!tiles.length) return null;
  return (
    <section aria-label={label} className="flex flex-col gap-1.5">
      <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{label}</h2>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${compact ? 200 : 240}px), 1fr))` }}>
        {tiles.map((t) => <StatTile key={t.id} t={t} compact={compact} />)}
      </div>
    </section>
  );
}

/** Same days of last month, e.g. "1–5 Sep last month: 4 (▲ 3)"; says "none" when there is nothing to compare. */
function vsLast(now: number, before: number, m: Metrics, fmt: (n: number) => string = String) {
  const when = span(m.last_from, m.last_to) + ' last month';
  if (!before) return `${when}: none to compare`;
  const d = now - before;
  return `${when}: ${fmt(before)} (${d === 0 ? 'same' : (d > 0 ? '▲ ' : '▼ ') + fmt(Math.abs(d))})`;
}

export function Dashboard() {
  const s = useSession();
  const [m, setM] = useState<Metrics | null>(null);
  const [err, setErr] = useState('');
  const [lists, setLists] = useState<{ tasks: Row[]; alerts: Row[]; trends: Row[] } | null>(null);

  useEffect(() => {
    const db = supabase();
    let live = true;
    db.rpc('dashboard_metrics').then(({ data, error }) => { if (!live) return; if (error) setErr(error.message); else setM(data as Metrics); });
    Promise.all([
      db.from('follow_up').select('*, lead:lead_id(id,full_name), candidate:candidate_id(id,full_name)').eq('status', 'Open').order('due_at').limit(7),
      s.can('alert') ? db.from('alert').select('*, lead:lead_id(full_name), candidate:candidate_id(full_name)').eq('status', 'Open').order('raised_at', { ascending: false }).limit(6) : Promise.resolve({ data: [] }),
      db.rpc('kpi_trends', { days: 30 }).then((r) => r, () => ({ data: [] })),
    ]).then(([tasks, alerts, trends]) => { if (live) setLists({ tasks: tasks.data || [], alerts: alerts.data || [], trends: (trends.data as Row[]) || [] }); });
    return () => { live = false; };
  }, [s]);

  const [title, sub] = TITLES[s.staff.role] || TITLES.Admin;
  const header = <PageHeader title={title} description={sub} />;
  if (err) return <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:px-6 md:py-5">{header}<p className="text-badText">Could not load the dashboard numbers: {err}. Refresh to try again.</p></main>;
  if (!m || !lists) return (
    <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:px-6 md:py-5">
      {header}
      <StatSkeleton count={4} />
      <PageSkeleton />
    </main>
  );

  const series = (k: string): SparkPoint[] | undefined => {
    const pts = lists.trends.filter((r) => r[k] != null).map((r) => ({ day: String(r.day), value: Number(r[k]) }));
    return pts.length >= 2 ? pts : undefined;
  };
  const mtd = `${m.month_from}&to=${m.today}`;
  const monthSpan = span(m.month_from, m.today);

  // 1. Needs attention: work that is late or due now
  const attention: Tile[] = [];
  if (m.fu_overdue != null) attention.push({ id: 'fu_overdue', label: 'Overdue follow-ups', value: m.fu_overdue, tone: m.fu_overdue ? 'bad' : 'good', note: m.fu_overdue ? 'Due before today, still open' : 'None. You are clear.',
    def: 'Open follow-ups you can see (yours, your team’s, or ones you created) that were due before today, India time.', href: '/p/followups?view=Overdue' });
  if (m.fu_today != null) attention.push({ id: 'fu_today', label: 'Follow-ups due today', value: m.fu_today, note: m.fu_open != null ? `${m.fu_open} open in all` : undefined,
    def: 'Open follow-ups you can see that are due today, India time.', href: '/p/followups?view=Today' });
  if (m.alerts_open != null) attention.push({ id: 'alerts_open', label: 'Open alerts', value: m.alerts_open, tone: m.alerts_high ? 'bad' : undefined, note: m.alerts_high ? `${m.alerts_high} high priority` : 'None high priority',
    def: 'Alerts raised by the CRM’s rules (for example, a lead not called for days) that nobody has resolved yet.', href: '/p/alert?view=Open' });
  if (m.fees_overdue_amt != null) attention.push({ id: 'fees_overdue', label: 'Overdue fees', value: money(m.fees_overdue_amt), tone: m.fees_overdue_amt ? 'bad' : 'good', note: `${m.fees_overdue_n} payment${m.fees_overdue_n === 1 ? '' : 's'} marked Overdue`,
    def: 'Total of fee payments whose status is Overdue (a due date has passed without payment).', href: '/p/payment?view=All&f.status=Overdue' });
  if (m.joining_soon != null && ['Placement', 'Admin'].includes(s.staff.role)) attention.push({ id: 'joining_soon', label: 'Joining soon', value: m.joining_soon, note: 'Offers waiting for joining',
    def: 'Placements with status “Joining soon”: the candidate accepted an offer and has not joined yet.', href: '/p/placement?view=Joining soon' });

  // 2. This month so far, compared with the same days of last month
  const month: Tile[] = [];
  if (m.leads_month != null) month.push({ id: 'leads_month', label: 'New leads this month', value: m.leads_month, note: vsLast(m.leads_month, m.leads_last || 0, m), spark: series('leads'),
    def: `Leads created ${monthSpan} (India time) that you can see. Compared with the same days of last month.`, href: `/p/lead?from=${mtd}` });
  if (m.enrolled_month != null) month.push({ id: 'enrolled_month', label: 'Enrolled this month', value: m.enrolled_month, note: vsLast(m.enrolled_month, m.enrolled_last || 0, m), spark: series('enrolled'),
    def: `Candidates added ${monthSpan} (India time). Compared with the same days of last month.`, href: `/p/candidate?from=${mtd}` });
  if (m.collected_month != null) month.push({ id: 'collected_month', label: 'Collected this month', value: money(m.collected_month), note: vsLast(Number(m.collected_month), Number(m.collected_last || 0), m, (n) => money(n)), spark: series('collected'), sparkMoney: true,
    def: `Fee payments with status Received and a paid date ${monthSpan}. Compared with the same days of last month.`, href: `/p/payment?view=Received&on=paid_on&from=${mtd}` });
  if (m.leads_open != null) month.push({ id: 'leads_open', label: 'Open leads', value: m.leads_open, note: `${m.leads_today ?? 0} new today`,
    def: 'Leads you can see whose stage is not Converted or Not interested. Not limited to this month.', href: '/p/lead?view=Open' });

  const manager = s.staff.role === 'Admin' || s.staff.level === 'Head' || s.staff.role === 'Marketing';
  const showFunnel = manager && s.can('lead') && s.can('candidate');
  const showSources = manager && m.sources != null;
  const ring = m.target != null && m.target > 0 && m.target_done != null
    ? <TargetRing value={m.target_done} target={m.target} title={m.target_mine ? 'My monthly target' : 'Team monthly target'} /> : null;

  const workLists = (
    <>
      <section aria-label="Follow-ups due" className="rounded-card bg-surface px-4 py-3 shadow-1">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold" title="Open, earliest due first">Next follow-ups</h2>
          <Link href="/p/followups" className="inline-flex min-h-[44px] items-center text-[13px] font-medium text-accentText hover:underline">Open all</Link>
        </div>
        {lists.tasks.length === 0 && <p className="mt-3 text-text2">Nothing due. You’re clear.</p>}
        {lists.tasks.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-3 border-t border-line py-1.5 first:border-0">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium">{t.title}</div>
              <div className="truncate text-xs text-muted">{t.lead?.full_name || t.candidate?.full_name || ''} · {t.owner_role}</div>
            </div>
            <span className={'whitespace-nowrap text-xs font-medium ' + (new Date(t.due_at).getTime() < Date.now() ? 'text-badText' : 'text-text2')}>{fmtDateTime(t.due_at)}</span>
          </div>
        ))}
      </section>
      {s.can('alert') && (
        <section aria-label="Open alerts" className="rounded-card bg-surface px-4 py-3 shadow-1">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold" title="Newest first">Latest open alerts</h2>
            <Link href="/p/alert" className="inline-flex min-h-[44px] items-center text-[13px] font-medium text-accentText hover:underline">Open all</Link>
          </div>
          {lists.alerts.length === 0 && <p className="mt-3 text-text2">No open alerts.</p>}
          {lists.alerts.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3 border-t border-line py-1.5 first:border-0">
              <div className="truncate text-[13px] font-medium" title={a.title}>{a.title}: {a.lead?.full_name || a.candidate?.full_name || ''}</div>
              <Pill>{a.priority}</Pill>
            </div>
          ))}
        </section>
      )}
    </>
  );

  return (
    <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:px-6 md:py-5">
      {header}
      <Checklist />
      <Tiles label="Needs attention" tiles={attention} compact />
      <Tiles label={`This month so far · ${monthSpan}`} tiles={month} />
      <div className="grid items-start gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 360px), 1fr))' }}>
        {!manager && workLists}
        {ring}
        {manager && workLists}
        {showFunnel && <Funnel />}
        {showSources && <DashboardInsights sources={m.sources!} from={m.month_from} to={m.today} />}
        <Leaderboard role={s.staff.role} />
      </div>
      {['Telecaller', 'Sales', 'HR / Counsellor', 'Placement', 'Front desk', 'Admin'].includes(s.staff.role) && <ActivityHeatmap />}
    </main>
  );
}
