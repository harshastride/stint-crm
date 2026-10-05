'use client';
import Link from 'next/link';
import { Area, AreaChart, Brush, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Row } from '@/lib/pages';
import { money } from '../ui';

// Dashboard "insights" row: a trend chart, this month's target, and one plain-language insight.
// Ideas borrowed from the Advanced Stats / Stats Cards components, rebuilt on CRM data in Stint colours.

const ACCENT = '#4474B9', CORAL = '#FF6B35';
const DAY = 864e5;
const startOfWeek = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const monthStart = (offset = 0) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + offset, 1); };
const inMonth = (iso: string | null | undefined, offset: number) => { if (!iso) return false; const t = new Date(iso).getTime(); return t >= monthStart(offset).getTime() && t < monthStart(offset + 1).getTime(); };

/** % change this month vs last month, or null when last month had nothing to compare with. */
export function change(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) / before) * 100);
}
export const thisAndLast = (rows: Row[], field: string, pick: (r: Row) => number = () => 1) =>
  [rows.filter((r) => inMonth(r[field], 0)).reduce((a, r) => a + pick(r), 0), rows.filter((r) => inMonth(r[field], -1)).reduce((a, r) => a + pick(r), 0)] as const;

type Props = { leads: Row[]; cands: Row[]; fees: Row[]; target: number | null; targetLabel: string; sources: Record<string, string>; showLeads: boolean; showFees: boolean };

export function DashboardInsights({ leads, cands, fees, target, targetLabel, sources, showLeads, showFees }: Props) {
  // 26 weekly points (drag the strip under the chart to zoom): new leads and enrolments, or collections when the role only sees fees
  const N = 26;
  const weeks = Array.from({ length: N }, (_, i) => startOfWeek(new Date(Date.now() - (N - 1 - i) * 7 * DAY)));
  const bucket = (rows: Row[], field: string, pick: (r: Row) => number = () => 1) => weeks.map((w, i) => {
    const end = i < N - 1 ? weeks[i + 1].getTime() : Infinity;
    return rows.filter((r) => r[field] && new Date(r[field]).getTime() >= w.getTime() && new Date(r[field]).getTime() < end).reduce((a, r) => a + pick(r), 0);
  });
  const label = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const chart = showLeads
    ? { title: 'New leads and enrolments', sub: 'Last 6 months · drag the strip below to zoom', series: [['leads', 'New leads', ACCENT], ['enrolled', 'Enrolled', CORAL]] as const,
        data: (() => { const a = bucket(leads, 'created_at'), b = bucket(cands, 'created_at'); return weeks.map((w, i) => ({ week: label(w), leads: a[i], enrolled: b[i] })); })() }
    : showFees
      ? { title: 'Fees collected', sub: 'Per week, last 6 months · drag the strip below to zoom', series: [['collected', 'Collected', ACCENT]] as const,
          data: (() => { const a = bucket(fees.filter((f) => f.status === 'Received'), 'paid_on', (f) => Number(f.amount)); return weeks.map((w, i) => ({ week: label(w), collected: a[i] })); })() }
      : null;

  const [enrolNow] = thisAndLast(cands, 'created_at');
  const pct = target ? Math.min(100, Math.round((100 * enrolNow) / target)) : 0;

  // best lead source this month, and how it moved since last month
  let insight: { text: string; href: string } | null = null;
  if (showLeads && leads.length) {
    const count = (offset: number) => { const m: Record<string, number> = {}; leads.filter((l) => inMonth(l.created_at, offset)).forEach((l) => { const k = l.source_id || 'none'; m[k] = (m[k] || 0) + 1; }); return m; };
    const now = count(0), before = count(-1);
    const best = Object.entries(now).sort((a, b) => b[1] - a[1])[0];
    if (best) {
      const name = sources[best[0]] || 'No source';
      const ch = change(best[1], before[best[0]] || 0);
      insight = { text: `${name} brought the most leads this month: ${best[1]}${ch === null ? '' : ch >= 0 ? `, up ${ch}% on last month` : `, down ${-ch}% on last month`}.`, href: '/p/source' };
    }
  } else if (showFees) {
    const [now, before] = thisAndLast(fees.filter((f) => f.status === 'Received'), 'paid_on', (f) => Number(f.amount));
    const ch = change(now, before);
    insight = { text: `${money(now)} collected this month${ch === null ? '' : ch >= 0 ? `, up ${ch}% on last month` : `, down ${-ch}% on last month`}.`, href: '/p/payment' };
  }

  if (!chart && target === null && !insight) return null;

  return (
    <section className="grid gap-4 lg:grid-cols-3" aria-label="Trends and targets">
      {chart && (
        <div className="anim-rise rounded-card bg-surface shadow-1 p-5 lg:col-span-2" style={{ animationDelay: '0ms' }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div><h2 className="text-base font-semibold">{chart.title}</h2><p className="text-xs text-muted">{chart.sub}</p></div>
            <div className="flex gap-3 text-xs text-text2">
              {chart.series.map(([k, l, c]) => <span key={k} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{l}</span>)}
            </div>
          </div>
          <div className="mt-3 h-[260px] text-muted" role="img" aria-label={chart.title + ', ' + chart.sub}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart.data as Record<string, string | number>[]} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  {chart.series.map(([k, , c]) => (
                    <linearGradient key={k} id={'fill-' + k} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={c} stopOpacity={0.28} /><stop offset="100%" stopColor={c} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.15} />
                <XAxis dataKey="week" tickLine={false} axisLine={false} tick={{ fill: 'currentColor', fontSize: 11 }} interval="preserveStartEnd" minTickGap={18} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} tick={{ fill: 'currentColor', fontSize: 11 }}
                  tickFormatter={(v: number) => (showLeads ? String(v) : v >= 100000 ? '₹' + Math.round(v / 1000) / 100 + 'L' : v >= 1000 ? '₹' + Math.round(v / 1000) + 'K' : '₹' + v)} />
                <Tooltip cursor={{ stroke: 'currentColor', strokeOpacity: 0.25 }}
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, fontSize: 12, color: 'var(--text)' }}
                  formatter={(v, n) => [showLeads ? String(v) : money(Number(v)), chart.series.find(([k]) => k === n)?.[1] || String(n)]} labelFormatter={(l) => 'Week of ' + String(l)} />
                {chart.series.map(([k, , c]) => <Area key={k} type="monotone" dataKey={k} stroke={c} strokeWidth={2} fill={`url(#fill-${k})`} isAnimationActive={false} />)}
                <Brush dataKey="week" height={26} startIndex={N - 12} travellerWidth={10} stroke={ACCENT} fill="var(--surface2)" tickFormatter={() => ''} aria-label="Zoom: drag the handles to pick weeks" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-4">
        {target !== null && (
          <div className="anim-rise flex flex-1 flex-col justify-between rounded-2xl bg-ink p-5 text-[#E6EBF5]" style={{ animationDelay: '80ms' }}>
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#9AA8C4]">This month’s target</p>
              <h3 className="mt-1 text-lg font-semibold text-white">{targetLabel}</h3>
            </div>
            <div className="mt-6">
              <div className="mb-2 flex items-end justify-between">
                <span className="num text-3xl font-semibold text-white">{enrolNow}<span className="text-lg text-[#9AA8C4]"> / {target}</span></span>
                <span className="num mb-1 text-xs font-medium text-[#9AA8C4]">{pct}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Target progress">
                <div className="h-full rounded-full bg-coral" style={{ width: pct + '%' }} />
              </div>
            </div>
          </div>
        )}
        {insight && (
          <div className="anim-rise flex flex-1 flex-col justify-between rounded-card bg-surface shadow-1 p-5" style={{ animationDelay: '160ms' }}>
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted">Worth knowing</p>
              <p className="mt-2 text-[14px] leading-relaxed text-text">{insight.text}</p>
            </div>
            <Link href={insight.href} className="mt-3 self-end text-[13px] font-medium text-accentText">View more →</Link>
          </div>
        )}
      </div>
    </section>
  );
}
