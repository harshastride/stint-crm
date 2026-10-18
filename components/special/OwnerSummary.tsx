'use client';
import { useEffect, useState } from 'react';
import { ChevronDown, RefreshCw, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, cx, fmtDateTime, money } from '../ui';

// Weekly owner summary (Admin only; row security on ai_brief / ai_usage enforces that).
// Claude writes the words on Monday 08:00 India time from numbers the database counted; those numbers are shown beside it.

type Body = { headline: string; went_well: string[]; needs_attention: { issue: string; action: string }[]; keep_an_eye_on: string[] };
type N = number | string | null | undefined;
type Facts = {
  week?: { from: string; to: string; previous_from: string; previous_to: string };
  leads?: { new?: N; new_previous?: N; open_not_called_7_days?: N };
  calls?: { made?: N; made_previous?: N };
  counselling_booked?: N; counselling_booked_previous?: N;
  enrolments?: { new?: N; new_previous?: N };
  fees_inr?: { collected?: N; collected_previous?: N; overdue_amount?: N; overdue_payments?: N };
  placements?: { new?: N; new_previous?: N };
  follow_ups?: { overdue_open?: N };
  alerts?: { open?: N; open_high?: N };
};
type Brief = { period_start: string; period_end: string; body: Body; facts: Facts | null; created_at: string };

const USAGE_CAP = 1000;
const day = (ymd: string) => new Date(ymd + 'T00:00:00Z');
/** "13–19 Oct", or "29 Sep – 5 Oct" across months. */
function span(from?: string, to?: string) {
  if (!from || !to) return '';
  const f = day(from), t = day(to), o = { timeZone: 'UTC' } as const;
  const mon = (d: Date) => d.toLocaleDateString('en-IN', { ...o, month: 'short' });
  return f.getUTCMonth() === t.getUTCMonth() ? `${f.getUTCDate()}–${t.getUTCDate()} ${mon(t)}` : `${f.getUTCDate()} ${mon(f)} – ${t.getUTCDate()} ${mon(t)}`;
}
const count = (n: N) => (n == null || n === '' ? '—' : Number(n).toLocaleString('en-IN'));
const list = (a: unknown) => (Array.isArray(a) ? a.map((x) => String(x ?? '').trim()).filter(Boolean) : []);
/** Yesterday in India as YYYY-MM-DD (the last day a summary can cover). */
const indiaYesterday = () => new Date(Date.parse(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10);

export function OwnerSummary() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [cost, setCost] = useState<{ usd: number; partial: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; notSetUp: boolean } | null>(null);
  const [open, setOpen] = useState(false);

  const loadCost = async () => {
    const d = new Date(); const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
    const { data, count: total, error } = await supabase().from('ai_usage').select('cost_usd', { count: 'exact' })
      .gte('created_at', monthStart).limit(USAGE_CAP);
    if (error || !data) return setCost(null);
    const usd = (data as { cost_usd: N }[]).reduce((s, r) => s + Number(r.cost_usd || 0), 0);
    setCost({ usd, partial: (total ?? 0) > data.length });
  };

  const load = async () => {
    setLoading(true); setLoadErr('');
    const { data, error } = await supabase().from('ai_brief').select('period_start, period_end, body, facts, created_at')
      .eq('kind', 'owner_week').order('period_start', { ascending: false }).limit(1).maybeSingle();
    if (error) setLoadErr('Could not load the weekly summary.');
    else setBrief((data as Brief | null) ?? null);
    setLoading(false);
  };

  useEffect(() => { void load(); void loadCost(); }, []);

  const write = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/ai/weekly', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const json = await res.json().catch(() => ({}));
      if (res.status === 503) setErr({ text: json.error || 'The weekly summary is not set up yet. Add the Claude key on the server.', notSetUp: true });
      else if (!res.ok || !json.brief) setErr({ text: json.error || 'Could not write the summary. Please try again.', notSetUp: false });
      else { setBrief(json.brief as Brief); setOpen(false); }
    } catch {
      setErr({ text: 'Could not reach the server. Check the connection and try again.', notSetUp: false });
    } finally {
      setBusy(false); void loadCost();
    }
  };

  const b = brief?.body;
  const f = brief?.facts || {};
  const wentWell = list(b?.went_well);
  const attention = (Array.isArray(b?.needs_attention) ? b!.needs_attention : []).filter((x) => x && String(x.issue || '').trim());
  const watch = list(b?.keep_an_eye_on);
  // the Monday job keeps the summary at most 7 days behind yesterday; older means a run was missed
  const stale = !!brief && (day(indiaYesterday()).getTime() - day(brief.period_end).getTime()) / 86_400_000 > 7;
  const thisWeek = span(f.week?.from ?? brief?.period_start, f.week?.to ?? brief?.period_end);
  const prevWeek = span(f.week?.previous_from, f.week?.previous_to);

  const compare: [string, N, N, boolean?][] = [
    ['New leads', f.leads?.new, f.leads?.new_previous],
    ['Calls made', f.calls?.made, f.calls?.made_previous],
    ['Counselling booked', f.counselling_booked, f.counselling_booked_previous],
    ['Enrolments', f.enrolments?.new, f.enrolments?.new_previous],
    ['Fees collected', f.fees_inr?.collected, f.fees_inr?.collected_previous, true],
    ['Placements', f.placements?.new, f.placements?.new_previous],
  ];
  const now: [string, string][] = [
    ['Overdue fees', f.fees_inr?.overdue_amount == null ? '—' : `${money(f.fees_inr.overdue_amount)} · ${count(f.fees_inr.overdue_payments)} payment${Number(f.fees_inr.overdue_payments) === 1 ? '' : 's'}`],
    ['Overdue follow-ups', count(f.follow_ups?.overdue_open)],
    ['Open alerts (high)', count(f.alerts?.open_high)],
    ['Leads not called in 7 days', count(f.leads?.open_not_called_7_days)],
  ];

  const working = busy && <p aria-live="polite" className="mt-2 text-[13px] text-text2">Reading last week’s numbers…</p>;
  const problem = err && (
    <div className="mt-2 flex flex-wrap items-center gap-2" role="status">
      <p className={cx('text-[13px]', err.notSetUp ? 'text-text2' : 'text-badText')}>{err.text}</p>
      {!err.notSetUp && <Button size="sm" variant="outline" className="min-h-[44px]" onClick={write}>Try again</Button>}
    </div>
  );

  return (
    <section aria-label="Weekly summary" aria-busy={busy || loading || undefined} className="rounded-card bg-surface px-4 py-3 shadow-1">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <h2 className="flex min-h-[44px] items-center gap-2 text-[13px] font-semibold">
          <Sparkles size={15} className="text-accentText" aria-hidden />
          Last week in one minute
          {brief && <span className="font-normal text-muted">· {thisWeek}</span>}
        </h2>
        {brief && (
          <Button size="sm" variant="outline" className="min-h-[44px]" leftIcon={<RefreshCw size={14} />} loading={busy} disabled={busy} onClick={write}
            title="Write it again from the CRM's counts for the last 7 days up to yesterday">Rewrite</Button>
        )}
      </div>

      {loading && <p className="mt-1 text-[13px] text-muted">Loading…</p>}
      {!loading && loadErr && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p className="text-[13px] text-badText">{loadErr}</p>
          <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => void load()}>Try again</Button>
        </div>
      )}

      {!loading && !loadErr && !brief && (
        <div className="mt-1">
          <p className="text-[13px] text-text2">No summary yet. The first one is written on Monday at 8 am.</p>
          <Button size="sm" variant="secondary" className="mt-2 min-h-[44px]" loading={busy} disabled={busy} onClick={write}>Write it now</Button>
        </div>
      )}

      {working}
      {problem}

      {brief && b && (
        <>
          {stale && <p className="mt-1 text-xs text-warnText">This covers {thisWeek}. This Monday’s summary has not been written yet.</p>}
          {b.headline && <p className="mt-1 text-[15px] font-semibold leading-snug">{b.headline}</p>}

          {wentWell.length > 0 && (
            <div className="mt-3">
              <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Went well</h3>
              <ul className="mt-1 space-y-1">{wentWell.map((t, i) => <li key={i} className="text-[13px] leading-snug">{t}</li>)}</ul>
            </div>
          )}
          {attention.length > 0 && (
            <div className="mt-3">
              <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Needs attention</h3>
              <ul className="mt-1 space-y-1.5">
                {attention.map((x, i) => (
                  <li key={i} className="text-[13px] leading-snug">
                    <div>{x.issue}</div>
                    {x.action && <div className="text-text2">→ {x.action}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {watch.length > 0 && (
            <div className="mt-3">
              <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Keep an eye on</h3>
              <ul className="mt-1 space-y-1">{watch.map((t, i) => <li key={i} className="text-[13px] leading-snug">{t}</li>)}</ul>
            </div>
          )}

          <p className="mt-3 text-xs text-muted">
            Written by AI on {fmtDateTime(brief.created_at)} from the CRM’s own counts. Check a number in ‘See the numbers’ before acting on it.
          </p>

          {brief.facts && (
            <>
              <button type="button" aria-expanded={open} aria-controls="owner-week-numbers" onClick={() => setOpen(!open)}
                className="mt-1 inline-flex min-h-[44px] items-center gap-1 rounded-lg px-1 text-[13px] font-medium text-accentText hover:underline">
                See the numbers <ChevronDown size={14} aria-hidden className={cx('transition-transform', open && 'rotate-180')} />
              </button>
              {open && (
                <div id="owner-week-numbers" className="mt-1">
                  <table className="w-full text-[13px]">
                    <caption className="pb-1 text-left text-xs text-muted">Counted for {thisWeek} (India days) and the 7 days before ({prevWeek}).</caption>
                    <thead>
                      <tr className="text-xs text-muted">
                        <th scope="col" className="py-1 text-left font-medium">Counted</th>
                        <th scope="col" className="py-1 text-right font-medium">{thisWeek}</th>
                        <th scope="col" className="py-1 pl-3 text-right font-medium">{prevWeek || 'Week before'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compare.map(([label, a, p, isMoney]) => (
                        <tr key={label} className="border-t border-line">
                          <th scope="row" className="py-1.5 text-left font-normal">{label}{isMoney ? ' (₹)' : ''}</th>
                          <td className="py-1.5 text-right font-medium tabular-nums">{isMoney ? money(a) : count(a)}</td>
                          <td className="py-1.5 pl-3 text-right tabular-nums text-text2">{isMoney ? money(p) : count(p)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <table className="mt-3 w-full text-[13px]">
                    <caption className="pb-1 text-left text-xs text-muted">Open right now, when it was written ({fmtDateTime(brief.created_at)}).</caption>
                    <tbody>
                      {now.map(([label, v]) => (
                        <tr key={label} className="border-t border-line">
                          <th scope="row" className="py-1.5 text-left font-normal">{label}</th>
                          <td className="py-1.5 text-right font-medium tabular-nums">{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}

      {cost && (
        <p className="mt-1 text-[11.5px] text-muted" title="Sum of every Claude call logged since the 1st of this month">
          AI cost this month: {cost.partial ? 'at least ' : ''}${cost.usd.toFixed(2)}
        </p>
      )}
    </section>
  );
}
