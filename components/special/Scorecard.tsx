'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '../Fields';
import { Button, cx } from '../ui';
import { PageHeader } from '../kit/PageHeader';
import { DateRange, type Range } from '../kit/DateRange';
import { EmptyState } from '../kit/EmptyState';
import { Meter } from '../kit/Meter';
import { Table, THead, TBody, Th, Td, Tr } from '../kit/Table';

// Staff scorecard (Reports): each person's week against their own usual (the 4 weeks before) and the team average.
// The database decides who is visible (staff_scorecard, migration 092): Admin everyone, a Head their own team,
// a Junior only themselves. Built for coaching: no ranks or medals, the comparison that matters is with yourself.

type Hist = { from: string; to: string; counted: boolean; calls: number; connected: number; talk_minutes: number; counselling: number; quotes: number; enrolments: number };
type Row = {
  staff_id: string; name: string; role: string; level: string; is_me: boolean;
  calls: number; connected: number; connected_pct: number | null; talk_minutes: number;
  counselling_booked: number; quotes_sent: number; enrolments: number;
  target: number | null; target_month: string; month_enrolments: number;
  prev_periods: number;
  prev4_avg_calls: number | null; prev4_avg_connected_pct: number | null; prev4_avg_talk_minutes: number | null;
  prev4_avg_counselling: number | null; prev4_avg_quotes: number | null; prev4_avg_enrolments: number | null;
  history: Hist[] | null; days_counted: number; counted_to: string;
};
type Team = { role: string; people: number; shown: boolean; avg_calls: number | null; connected_pct: number | null; avg_talk_minutes: number | null; avg_counselling: number | null; avg_quotes: number | null; avg_enrolments: number | null };

type Key = 'calls' | 'connected_pct' | 'talk_minutes' | 'counselling_booked' | 'quotes_sent' | 'enrolments';
type Metric = { key: Key; label: string; short: string; usual: keyof Row; team: keyof Team; hist: keyof Hist | null; pct?: boolean; how: string };
const METRICS: Metric[] = [
  { key: 'calls', label: 'Calls', short: 'Calls', usual: 'prev4_avg_calls', team: 'avg_calls', hist: 'calls', how: 'Calls the person logged, by call time (India time).' },
  { key: 'connected_pct', label: 'Connected %', short: 'Connected', usual: 'prev4_avg_connected_pct', team: 'connected_pct', hist: null, pct: true, how: 'Calls with any outcome except No answer and Wrong number, divided by all calls. Shown as — when there were no calls.' },
  { key: 'talk_minutes', label: 'Talk time', short: 'Talk', usual: 'prev4_avg_talk_minutes', team: 'avg_talk_minutes', hist: 'talk_minutes', how: 'Total call length logged. A call saved without a length counts as 0 minutes.' },
  { key: 'counselling_booked', label: 'Counselling booked', short: 'Counselling', usual: 'prev4_avg_counselling', team: 'avg_counselling', hist: 'counselling', how: 'Different leads the person booked counselling for: a call marked Booked counselling, or a counselling session they added.' },
  { key: 'quotes_sent', label: 'Quotes sent', short: 'Quotes', usual: 'prev4_avg_quotes', team: 'avg_quotes', hist: 'quotes', how: 'Fee quotes the person created.' },
  { key: 'enrolments', label: 'Enrolments', short: 'Enrolled', usual: 'prev4_avg_enrolments', team: 'avg_enrolments', hist: 'enrolments', how: 'Candidates whose joining date is in the period and whose lead this person owns now. Candidates added without a lead are not counted.' },
];
const ROLE_ORDER = ['Telecaller', 'Sales', 'HR / Counsellor', 'Front desk', 'Placement', 'Finance'];
const defaultMetric = (role: string): Key => (role === 'Sales' || role === 'HR / Counsellor' ? 'enrolments' : 'calls');

// India-time dates as YYYY-MM-DD (date maths done in UTC so the device's own time zone never shifts a day)
const indiaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const monday = (ymd: string) => addDays(ymd, -((new Date(ymd + 'T00:00:00Z').getUTCDay() + 6) % 7));
const nice = (ymd: string) => new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const span = (a: string, b: string) => (a === b ? nice(a) : `${nice(a)} – ${nice(b)}`);
const monthName = (ymd: string) => new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', timeZone: 'UTC' });

type Period = { kind: 'this' | 'last' | 'custom'; from: string; to: string };
function presetPeriod(kind: 'this' | 'last'): Period {
  const m = monday(indiaToday());
  return kind === 'this' ? { kind, from: m, to: addDays(m, 6) } : { kind, from: addDays(m, -7), to: addDays(m, -1) };
}

const n1 = (v: number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 }));
function fmt(m: Metric, v: number | null | undefined) {
  if (v == null) return '—';
  if (m.pct) return n1(v) + '%';
  if (m.key === 'talk_minutes') { const t = Math.round(Number(v)); return t >= 60 ? `${Math.floor(t / 60)} h ${t % 60} min` : `${t} min`; }
  return n1(v);
}

/** Change against the person's own usual, in words (never by colour alone). */
function trend(m: Metric, cur: number | null, usual: number | null, word: string): { dir: 'up' | 'down' | 'same' | 'none'; text: string } {
  if (m.pct && cur == null) return { dir: 'none', text: 'No calls' };
  if (usual == null) return { dir: 'none', text: `No earlier ${word}s to compare` };
  const c = Number(cur || 0), u = Number(usual);
  if (m.pct) {
    const d = Math.round(c - u);
    if (Math.abs(d) < 3) return { dir: 'same', text: `About usual (${fmt(m, u)})` };
    return { dir: d > 0 ? 'up' : 'down', text: `${Math.abs(d)} pts ${d > 0 ? 'above' : 'below'} usual (${fmt(m, u)})` };
  }
  if (u === 0) return c === 0 ? { dir: 'same', text: 'Same as usual (0)' } : { dir: 'up', text: 'Up from a usual of 0' };
  const r = Math.round(((c - u) / u) * 100);
  if (Math.abs(r) < 10) return { dir: 'same', text: `About usual (${fmt(m, u)})` };
  return { dir: r > 0 ? 'up' : 'down', text: `${Math.abs(r)}% ${r > 0 ? 'above' : 'below'} usual (${fmt(m, u)})` };
}
function TrendText({ t, className }: { t: ReturnType<typeof trend>; className?: string }) {
  return (
    <span className={cx('text-[11.5px]', t.dir === 'up' ? 'text-goodText' : t.dir === 'down' ? 'text-badText' : 'text-muted', className)}>
      {t.dir === 'up' && <span aria-hidden>▲ </span>}{t.dir === 'down' && <span aria-hidden>▼ </span>}{t.text}
    </span>
  );
}
const val = (r: Row, k: Key) => (r[k] as number | null);

export function Scorecard() {
  const s = useSession();
  const isAdmin = s.staff.role === 'Admin';
  const scope = isAdmin ? 'Admin · everyone' : s.staff.level === 'Head' ? 'Your team' : 'Only you';
  const [period, setPeriod] = useState<Period>(() => presetPeriod('this'));
  const [custom, setCustom] = useState<Range>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [err, setErr] = useState('');
  const [reload, setReload] = useState(0);
  const [team, setTeam] = useState('');
  const [metric, setMetric] = useState<Key>(defaultMetric(s.staff.role));

  useEffect(() => {
    let live = true;
    setRows(null); setErr('');
    const args = { p_from: period.from, p_to: period.to };
    Promise.all([supabase().rpc('staff_scorecard', args), supabase().rpc('staff_scorecard_team', args)]).then(([a, b]) => {
      if (!live) return;
      if (a.error) { console.error('scorecard', a.error); setErr(friendlyError(a.error, 'the scorecard', 'Could not load the scorecard. Please try again.')); return; }
      if (b.error) console.error('scorecard team', b.error);
      setRows((a.data as Row[]) || []); setTeams((b.data as Team[]) || []);
    });
    return () => { live = false; };
  }, [period.from, period.to, reload]);

  // teams present, in a fixed order; Admin picks one (people are only compared with others doing the same job)
  const roles = useMemo(() => {
    const present = Array.from(new Set((rows || []).map((r) => r.role)));
    return present.sort((a, b) => (ROLE_ORDER.indexOf(a) + 1 || 99) - (ROLE_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
  }, [rows]);
  // the team shown: the one picked, else the viewer's own team, else the first in order
  const activeTeam = roles.includes(team) ? team : roles.includes(s.staff.role) ? s.staff.role : roles[0] || '';

  const m = METRICS.find((x) => x.key === metric)!;
  const people = useMemo(() => (rows || []).filter((r) => r.role === activeTeam), [rows, activeTeam]);
  const ranked = useMemo(() => [...people].sort((a, b) => (Number(val(b, metric) ?? -1) - Number(val(a, metric) ?? -1)) || a.name.localeCompare(b.name)), [people, metric]);
  const avg = teams.find((t) => t.role === activeTeam) || null;
  const first = rows?.[0];
  const isWeek = period.kind !== 'custom';
  const word = isWeek ? 'week' : 'period';
  const running = !!first && first.counted_to < period.to;
  const pickTeam = (r: string) => { setTeam(r); setMetric(defaultMetric(r)); };

  const seg = (on: boolean) => cx('h-11 rounded-row px-3 text-[13px] font-medium md:h-9', on ? 'bg-accentSoft text-accentText' : 'text-text2 hover:bg-surface2');
  const drill: [string, string, string][] = [['call', 'Calls', '/p/call'], ['counsel', 'Counselling', '/p/counsel'], ['quote', 'Fee quotes', '/p/quote'], ['candidate', 'Candidates', '/p/candidate'], ['target', 'Targets', '/p/target']];

  return (
    <main className="flex flex-1 flex-col gap-3 overflow-y-auto p-4 md:px-6 md:py-4" data-testid="scorecard">
      <PageHeader group="Reports" title="Staff scorecard" scope={scope}
        description="Each person’s calls, counselling, quotes and enrolments for the week, against their own usual and the team average. For coaching: look for what changed, then ask why."
        filters={<>
          <div role="group" aria-label="Period" className="flex gap-0.5 rounded-[10px] border border-line2 bg-surface p-0.5">
            <button type="button" aria-pressed={period.kind === 'this'} className={seg(period.kind === 'this')} onClick={() => { setCustom(null); setPeriod(presetPeriod('this')); }}>This week</button>
            <button type="button" aria-pressed={period.kind === 'last'} className={seg(period.kind === 'last')} onClick={() => { setCustom(null); setPeriod(presetPeriod('last')); }}>Last week</button>
          </div>
          <DateRange label="Other dates" value={custom} onChange={(r) => { setCustom(r); setPeriod(r ? { kind: 'custom', from: r.from, to: r.to } : presetPeriod('this')); }} />
          <span className="text-[12.5px] text-text2" data-testid="scorecard-period">
            {span(period.from, period.to)}
            {running && first && <> · counted up to {nice(first.counted_to)} ({first.days_counted} {first.days_counted === 1 ? 'day' : 'days'})</>}
          </span>
        </>} />

      {err && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-card bg-badBg px-4 py-3 text-[13.5px] text-badText">
          <span className="flex-1">{err}</span>
          <Button size="sm" onClick={() => setReload((x) => x + 1)}>Try again</Button>
        </div>
      )}
      {!err && rows === null && <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading"><div className="h-12 animate-pulse rounded-card bg-surface2" /><div className="h-56 animate-pulse rounded-card bg-surface2" /></div>}
      {!err && rows && rows.length === 0 && <EmptyState title="No one to show for these dates" body="People appear here once they are active in a team that makes calls, books counselling, sends quotes or enrols." />}

      {!err && rows && rows.length > 0 && (
        <>
          {/* Team (Admin, or anyone who sees more than one team) and the measure to sort by */}
          <div className="flex flex-col gap-2">
            {roles.length > 1 && (
              <div role="group" aria-label="Team" className="flex flex-wrap gap-1">
                {roles.map((r) => <button key={r} type="button" aria-pressed={activeTeam === r} className={seg(activeTeam === r)} onClick={() => pickTeam(r)}>{r}</button>)}
              </div>
            )}
            {people.length > 1 && (
              <div role="group" aria-label="Sort by" className="flex flex-wrap gap-0.5 border-b border-line pb-1">
                {METRICS.map((x) => <button key={x.key} type="button" aria-pressed={metric === x.key} className={seg(metric === x.key)} onClick={() => setMetric(x.key)}>{x.label}</button>)}
              </div>
            )}
          </div>

          {people.length > 1 && <BarList m={m} rows={ranked} avg={avg} word={word} />}
          {people.length === 1 && <You r={people[0]} avg={avg} word={word} />}

          {/* All measures: table on wider screens, one card per person on a phone */}
          <section aria-label="All measures" className="flex flex-col gap-2">
            <h2 className="text-[13px] font-semibold">All measures · {activeTeam}</h2>
            <div className="hidden md:block"><ScoreTable rows={ranked} avg={avg} word={word} /></div>
            <div className="flex flex-col gap-2 md:hidden">{ranked.map((r) => <PersonCard key={r.staff_id} r={r} word={word} />)}{avg && <TeamCard avg={avg} />}</div>
          </section>

          <HowCounted word={word} isWeek={isWeek} drill={drill.filter(([id]) => s.can(id))} />
        </>
      )}
    </main>
  );
}

/** Ranked bar list for one measure: name, bar, number, and the change against the person's own usual. */
function BarList({ m, rows, avg, word }: { m: Metric; rows: Row[]; avg: Team | null; word: string }) {
  const teamAvg = avg?.shown ? (avg[m.team] as number | null) : null;
  const max = m.pct ? 100 : Math.max(1, Number(teamAvg || 0), ...rows.map((r) => Number(val(r, m.key) || 0)));
  return (
    <section aria-label={`${m.label} by person`} data-testid="scorecard-bars" className="rounded-card bg-surface px-4 py-3 shadow-1">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold">{m.label}, most first</h2>
        <span className="text-[12px] text-muted">{teamAvg != null ? <>Team average {fmt(m, teamAvg)} <span aria-hidden>(dashed line)</span></> : 'Team average not available'}</span>
      </div>
      <ol className="flex flex-col">
        {rows.map((r) => {
          const v = val(r, m.key);
          const t = trend(m, v, r[m.usual] as number | null, word);
          return (
            <li key={r.staff_id} className={cx('grid min-h-[44px] grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-x-3 gap-y-0.5 rounded-row px-2 py-1 sm:grid-cols-[minmax(0,11rem)_1fr_auto_minmax(0,13rem)]', r.is_me && 'bg-accentSoft')}>
              <span className="truncate text-[13.5px] font-medium">{r.name}{r.is_me && <span className="ml-1 text-xs text-accentText">(you)</span>}</span>
              <span className="relative h-2.5 rounded-full bg-surface2" aria-hidden>
                {v != null && <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.min(100, (Number(v) / max) * 100)}%` }} />}
                {teamAvg != null && <span className="absolute -inset-y-1 w-0 border-l-2 border-dashed border-text2" style={{ left: `${Math.min(100, (Number(teamAvg) / max) * 100)}%` }} />}
              </span>
              <span className="num text-right text-[14px] font-semibold">{fmt(m, v)}</span>
              <TrendText t={t} className="col-span-3 sm:col-span-1" />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** A single person (a Junior sees only themselves): each measure against their usual and the team. */
function You({ r, avg, word }: { r: Row; avg: Team | null; word: string }) {
  const earlier = (r.history || []).filter((h) => h.counted);   // oldest first
  return (
    <section aria-label={r.is_me ? 'Your numbers' : r.name} data-testid="scorecard-you" className="rounded-card bg-surface px-4 py-3 shadow-1">
      <h2 className="text-[13px] font-semibold">{r.is_me ? `Your ${word}` : r.name}</h2>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {METRICS.map((m) => {
          const t = trend(m, val(r, m.key), r[m.usual] as number | null, word);
          const tv = avg?.shown ? (avg[m.team] as number | null) : null;
          return (
            <div key={m.key} className="min-w-0">
              <dt className="text-xs font-medium text-muted">{m.label}</dt>
              <dd className="num text-[22px] font-semibold leading-tight">{fmt(m, val(r, m.key))}</dd>
              <dd><TrendText t={t} /></dd>
              {tv != null && <dd className="text-[11.5px] text-muted">Team average {fmt(m, tv)}</dd>}
              {m.hist && earlier.length > 0 && <dd className="text-[11.5px] text-muted">Earlier {word}s: {earlier.map((h) => fmt(m, h[m.hist!] as number)).join(' · ')}</dd>}
            </div>
          );
        })}
      </dl>
      {avg && !avg.shown && <p className="mt-3 text-[12px] text-muted">The team average shows when your team has 3 or more people.</p>}
      <Target r={r} className="mt-3 max-w-md" />
    </section>
  );
}

function Target({ r, className }: { r: Row; className?: string }) {
  if (r.target == null) return null;
  return <Meter className={className} label={`Enrolment target, ${monthName(r.target_month)}`} value={r.month_enrolments} max={r.target} text={`${r.month_enrolments} of ${r.target}`} />;
}

function ScoreTable({ rows, avg, word }: { rows: Row[]; avg: Team | null; word: string }) {
  const hasTarget = rows.some((r) => r.target != null);
  return (
    <Table label="Scorecard, all measures" density="compact">
      <THead>
        <Th>Person</Th>
        {METRICS.map((m) => <Th key={m.key} numeric>{m.label}</Th>)}
        {hasTarget && <Th>Month target</Th>}
      </THead>
      <TBody>
        {rows.map((r) => (
          <Tr key={r.staff_id} className={r.is_me ? 'bg-accentSoft' : undefined}>
            <Td><span className="font-medium">{r.name}</span>{r.is_me && <span className="ml-1 text-xs text-accentText">(you)</span>}<span className="block text-[11.5px] text-muted">{r.level}</span></Td>
            {METRICS.map((m) => (
              <Td key={m.key} numeric className="align-top">
                <span className="block font-semibold">{fmt(m, val(r, m.key))}</span>
                <TrendText t={trend(m, val(r, m.key), r[m.usual] as number | null, word)} className="block whitespace-nowrap font-sans" />
              </Td>
            ))}
            {hasTarget && <Td className="min-w-[160px] align-top">{r.target != null ? <Target r={r} /> : <span className="text-[12px] text-muted">No target set</span>}</Td>}
          </Tr>
        ))}
        {avg && (
          <Tr className="border-t-2 border-line2 bg-surface2" data-testid="scorecard-team-row">
            <Td><span className="font-medium">Team average</span><span className="block text-[11.5px] text-muted">{avg.people} {avg.people === 1 ? 'person' : 'people'} in {avg.role}</span></Td>
            {METRICS.map((m) => <Td key={m.key} numeric className="align-top">{avg.shown ? fmt(m, avg[m.team] as number | null) : '—'}</Td>)}
            {hasTarget && <Td />}
          </Tr>
        )}
      </TBody>
    </Table>
  );
}

function PersonCard({ r, word }: { r: Row; word: string }) {
  return (
    <article className={cx('rounded-card bg-surface px-4 py-3 shadow-1', r.is_me && 'ring-1 ring-accent')} aria-label={r.name}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="truncate text-[14px] font-semibold">{r.name}{r.is_me && <span className="ml-1 text-xs font-medium text-accentText">(you)</span>}</h3>
        <span className="text-[11.5px] text-muted">{r.level}</span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
        {METRICS.map((m) => (
          <div key={m.key} className="min-w-0">
            <dt className="text-[11.5px] text-muted">{m.label}</dt>
            <dd className="num text-[16px] font-semibold leading-tight">{fmt(m, val(r, m.key))}</dd>
            <dd><TrendText t={trend(m, val(r, m.key), r[m.usual] as number | null, word)} /></dd>
          </div>
        ))}
      </dl>
      <Target r={r} className="mt-3" />
    </article>
  );
}

function TeamCard({ avg }: { avg: Team }) {
  return (
    <article className="rounded-card border border-dashed border-line2 bg-surface px-4 py-3" aria-label="Team average">
      <h3 className="text-[14px] font-semibold">Team average <span className="text-[11.5px] font-normal text-muted">· {avg.people} {avg.people === 1 ? 'person' : 'people'} in {avg.role}</span></h3>
      {avg.shown ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
          {METRICS.map((m) => <div key={m.key}><dt className="text-[11.5px] text-muted">{m.label}</dt><dd className="num text-[15px] font-semibold">{fmt(m, avg[m.team] as number | null)}</dd></div>)}
        </dl>
      ) : <p className="mt-1 text-[12.5px] text-text2">Shows when the team has 3 or more people.</p>}
    </article>
  );
}

function HowCounted({ word, isWeek, drill }: { word: string; isWeek: boolean; drill: [string, string, string][] }) {
  return (
    <details className="rounded-card bg-surface px-4 py-2 text-[12.5px] text-text2 shadow-1" data-testid="scorecard-how">
      <summary className="flex min-h-[44px] cursor-pointer items-center font-medium text-accent [&::-webkit-details-marker]:hidden">How each number is counted</summary>
      <dl className="grid gap-x-4 gap-y-1.5 pb-2 sm:grid-cols-[max-content_1fr]">
        {METRICS.map((m) => <div key={m.key} className="contents"><dt className="font-medium text-text">{m.label}</dt><dd>{m.how}</dd></div>)}
        <dt className="font-medium text-text">Usual</dt>
        <dd>The average of the 4 {word}s before this one{isWeek ? '' : ' (each the same length)'}. While a {word} is still running it is compared with the same days of those {word}s, not with whole {word}s. {word[0].toUpperCase() + word.slice(1)}s before the person joined are left out. ▲ or ▼ shows a change of 10% or more (3 points or more for Connected %).</dd>
        <dt className="font-medium text-text">Team average</dt>
        <dd>Everyone active in the same role, with people who did no work counted as 0. Connected % is the team’s connected calls divided by the team’s calls. Someone who sees only their own numbers gets the average once the team has 3 or more people.</dd>
        <dt className="font-medium text-text">Month target</dt>
        <dd>The enrolment target set on the Targets page for the month, against enrolments from the 1st of that month up to the last day counted.</dd>
        <dt className="font-medium text-text">Dates</dt>
        <dd>India time. Weeks run Monday to Sunday. Live numbers; only people your role may see.</dd>
      </dl>
      {drill.length > 0 && (
        <nav aria-label="See the rows behind the numbers" className="flex flex-wrap items-center gap-1 border-t border-line pt-1">
          <span className="text-muted">See the rows:</span>
          {drill.map(([id, l, href]) => <Link key={id} href={href} className="inline-flex min-h-[44px] items-center rounded-[8px] px-2 text-accent hover:bg-accentSoft">{l}</Link>)}
        </nav>
      )}
    </details>
  );
}
