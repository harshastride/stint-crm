'use client';
import { plainMessage } from '@/lib/plainMessage';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, IndianRupee, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { Confirm } from '../kit/Confirm';
import { Button, ButtonGroup, cx, money } from '../ui';

// Expected collections: money falling due over the next 30/60/90 India days, week by week, and the part at risk.
// Numbers come from collections_summary / expected_collections (migration 093, security invoker, so payment row
// security decides what is counted; a role without the Payments page gets "allowed: false", never ₹0).
// "Remind" sends one plain fee reminder through /api/messages/send (inserted as the caller; contact details stay on the server).

type Risky = {
  candidate_id: string; name: string; amount: number; overdue_amount: number; due_soon_amount: number;
  days_late: number | null; oldest_unpaid: string | null; next_due_on: string | null; paid_late_days: number | null; reason: string;
};
type Summary = {
  allowed: boolean; today?: string; days?: number; from?: string; to?: string;
  due_total?: number; due_count?: number; at_risk_total?: number; at_risk_count?: number; paid_early_total?: number;
  overdue_now_total?: number; overdue_now_count?: number; overdue_students?: number;
  month_from?: string; collected_this_month?: number; at_risk_students?: number; top_at_risk?: Risky[];
};
type Week = { week_start: string; week_end: string; from_day: string; to_day: string; due_amount: number; due_count: number; at_risk_amount: number; at_risk_count: number; paid_early_amount: number; collected_amount: number; collected_count: number };
type Channels = { whatsapp: boolean; email: boolean } | null;

const RANGES = [30, 60, 90] as const;
const KEY = 'stint.collections.range';
const PAID = '#16A34A', DUE = '#4474B9', RISK = '#E8592A';
/** Diagonal stripes so "at risk" is told apart by texture as well as colour. */
const STRIPES = { backgroundColor: 'color-mix(in srgb, ' + RISK + ' 22%, transparent)', backgroundImage: `repeating-linear-gradient(135deg, ${RISK} 0 3px, transparent 3px 6px)` };

const n = (v: unknown) => Number(v || 0);
/** ₹4.2 L, ₹80 k, ₹1.1 Cr — for headlines and bar labels; exact amounts sit in the legend, tooltips and table. */
function short(v: unknown) {
  const x = n(v), a = Math.abs(x);
  const t = (d: number, u: string) => '₹' + (x / d).toLocaleString('en-IN', { maximumFractionDigits: (x / d) % 1 === 0 ? 0 : 1 }) + ' ' + u;
  if (a >= 1e7) return t(1e7, 'Cr');
  if (a >= 1e5) return t(1e5, 'L');
  if (a >= 1e3) return t(1e3, 'k');
  return money(x);
}
const ymd = (s: string) => new Date(s + 'T00:00:00Z');
const dayMon = (s?: string | null) => (s ? ymd(s).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' }) : '');
function span(from?: string, to?: string) {
  if (!from || !to) return '';
  if (from === to) return dayMon(from);
  const f = ymd(from), t = ymd(to);
  return f.getUTCMonth() === t.getUTCMonth() ? `${f.getUTCDate()}–${dayMon(to)}` : `${dayMon(from)} – ${dayMon(to)}`;
}
const plural = (k: number, one: string, many = one + 's') => `${k.toLocaleString('en-IN')} ${k === 1 ? one : many}`;

function reminderText(r: Risky) {
  const amt = money(r.overdue_amount > 0 ? r.overdue_amount : r.due_soon_amount);
  return r.overdue_amount > 0 && r.oldest_unpaid
    ? `Hi {{first_name}}, a reminder from Stint: ${amt} of your course fee was due on ${dayMon(r.oldest_unpaid)} and is still unpaid. Please pay at the front desk, or reply here if you need help.`
    : `Hi {{first_name}}, a reminder from Stint: ${amt} of your course fee is due on ${dayMon(r.next_due_on)}. Please pay at the front desk, or reply here if you need help.`;
}

export function CollectionsForecast() {
  const s = useSession();
  const [days, setDays] = useState<number>(30);
  const [sum, setSum] = useState<Summary | null>(null);
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [table, setTable] = useState(false);
  const [how, setHow] = useState(false);
  const [channels, setChannels] = useState<Channels>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, string>>({});   // candidate id → plain result line
  const canRemind = s.can('payment', 'w') && s.can('candidate');

  useEffect(() => {
    try { const v = Number(localStorage.getItem(KEY)); if (RANGES.includes(v as 30)) setDays(v); } catch { /* private window: keep 30 */ }
  }, []);

  const load = useCallback(async (d: number) => {
    setLoading(true); setErr('');
    const db = supabase();
    const [a, b] = await Promise.all([db.rpc('collections_summary', { p_days: d }), db.rpc('expected_collections', { p_days: d })]);
    if (a.error || b.error) { console.error(a.error || b.error); setErr('Could not load expected collections.'); setLoading(false); return; }
    setSum(a.data as Summary); setWeeks((b.data || []) as Week[]); setLoading(false);
  }, []);
  useEffect(() => { void load(days); }, [days, load]);

  useEffect(() => {
    if (!canRemind) return;
    fetch('/api/messages/send').then((r) => (r.ok ? r.json() : null)).then((j) => setChannels(j ? { whatsapp: !!j.whatsapp, email: !!j.email } : { whatsapp: false, email: false }))
      .catch(() => setChannels({ whatsapp: false, email: false }));
  }, [canRemind]);

  const pick = (d: number) => { setDays(d); try { localStorage.setItem(KEY, String(d)); } catch { /* ignore */ } };

  const remind = async (r: Risky) => {
    const channel = channels?.whatsapp ? 'whatsapp' : channels?.email ? 'email' : null;
    if (!channel || sending) return;
    setSending(r.candidate_id);
    try {
      const res = await fetch('/api/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, candidate_id: r.candidate_id, body: reminderText(r), subject: channel === 'email' ? 'Fee reminder' : undefined }) });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) setSent((m) => ({ ...m, [r.candidate_id]: 'Reminder sent on ' + (channel === 'whatsapp' ? 'WhatsApp' : 'email') }));
      else if (j.notSetUp) setSent((m) => ({ ...m, [r.candidate_id]: 'Saved, but messages are not set up yet, so it was not sent' }));
      else setSent((m) => ({ ...m, [r.candidate_id]: plainMessage(j.error, 'Could not send the reminder. Please try again.') }));
    } catch {
      setSent((m) => ({ ...m, [r.candidate_id]: 'Couldn’t reach the server. Check the internet and try again.' }));
    } finally { setSending(null); }
  };

  if (!loading && sum && !sum.allowed) return null;  // no Payments page for this role: nothing to show (the database counted nothing)

  const due = n(sum?.due_total), risk = n(sum?.at_risk_total), paid = n(sum?.paid_early_total), onTrack = Math.max(0, due - risk);
  const whole = paid + due;
  const parts = [
    { key: 'paid', label: 'Already paid', value: paid, note: 'paid ahead of the due day', style: { backgroundColor: PAID } },
    { key: 'due', label: 'Due, on track', value: onTrack, note: plural(n(sum?.due_count) - n(sum?.at_risk_count), 'instalment'), style: { backgroundColor: DUE } },
    { key: 'risk', label: 'Due, at risk', value: risk, note: plural(n(sum?.at_risk_count), 'instalment'), style: STRIPES },
  ];
  const max = Math.max(1, ...weeks.map((w) => n(w.due_amount)));
  const top = sum?.top_at_risk || [];
  const period = span(sum?.from, sum?.to);
  const noChannel = canRemind && channels && !channels.whatsapp && !channels.email;

  return (
    <section aria-label="Expected collections" aria-busy={loading || undefined} className="rounded-card bg-surface px-4 py-3 shadow-1">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="flex min-h-[44px] items-center gap-2 text-[13px] font-semibold">
          <IndianRupee size={15} className="text-accentText" aria-hidden />
          Money coming in
          {period && <span className="font-normal text-muted">· {period}</span>}
        </h2>
        <ButtonGroup label="How far ahead">
          {RANGES.map((d) => <Button key={d} size="sm" active={days === d} className="!h-11 md:!h-9" onClick={() => pick(d)}>{d} days</Button>)}
        </ButtonGroup>
      </div>

      {loading && !sum && <p className="mt-1 text-[13px] text-muted">Loading…</p>}
      {err && (
        <div className="mt-1 flex flex-wrap items-center gap-2" role="status">
          <p className="text-[13px] text-badText">{err}</p>
          <Button size="sm" variant="outline" className="h-11 md:h-9" leftIcon={<RefreshCw size={14} />} onClick={() => void load(days)}>Try again</Button>
        </div>
      )}

      {sum?.allowed && !err && (
        <>
          <p className="mt-1 text-[15px] font-semibold leading-snug" aria-live="polite">
            {due === 0
              ? <>Next {days} days: nothing is due{paid > 0 ? <> ({short(paid)} already paid ahead)</> : null}.</>
              : <>Next {days} days: {short(due)} due{risk > 0 ? <>, <span className="text-badText">{short(risk)} of it at risk</span></> : <>, none of it at risk</>}.</>}
          </p>
          <p className="mt-0.5 text-[12.5px] text-text2">
            {n(sum.overdue_now_total) > 0
              ? <>Already overdue: <span className="num font-medium text-badText">{money(sum.overdue_now_total)}</span> from {plural(n(sum.overdue_students), 'student')} · </>
              : <>Nothing overdue now · </>}
            Collected this month: <span className="num font-medium text-text">{money(sum.collected_this_month)}</span> ({span(sum.month_from, sum.today)})
          </p>

          {/* Partition of every instalment that falls due in the window */}
          {whole > 0 && (
            <div className="mt-3">
              <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full" role="img"
                aria-label={`Instalments due ${period}: ${parts.map((p) => `${p.label} ${money(p.value)}`).join(', ')}`}>
                {parts.filter((p) => p.value > 0).map((p) => (
                  <div key={p.key} title={`${p.label}: ${money(p.value)}`} className="h-full" style={{ ...p.style, width: (100 * p.value) / whole + '%', minWidth: 4 }} />
                ))}
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
                {parts.map((p) => (
                  <li key={p.key} className="flex items-center gap-1.5">
                    <span aria-hidden className="inline-block h-3 w-3 shrink-0 rounded-[3px]" style={p.style} />
                    <span className="text-text2">{p.label}</span>
                    <span className="num font-medium text-text">{money(p.value)}</span>
                    {p.key !== 'paid' && <span className="text-muted">· {p.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Week by week */}
          {weeks.length > 0 && (
            <div className="mt-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Due each week</h3>
                <button type="button" aria-expanded={table} aria-controls="collections-weeks-table" onClick={() => setTable(!table)}
                  className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-1 text-[12.5px] font-medium text-accentText hover:underline md:min-h-[32px]">
                  {table ? 'Show as bars' : 'Show as table'}
                </button>
              </div>
              {!table ? (
                <ol className="mt-1 flex items-end gap-1 overflow-x-auto pb-1" aria-label="Amount due each week">
                  {weeks.map((w, i) => {
                    const d = n(w.due_amount), r = n(w.at_risk_amount), h = d > 0 ? Math.max(4, (112 * d) / max) : 0, rh = d > 0 ? (h * r) / d : 0;
                    const label = i === 0 ? 'This week' : dayMon(w.week_start);
                    const tip = `${span(w.from_day, w.to_day)}: ${money(d)} due (${plural(n(w.due_count), 'instalment')})${r > 0 ? `, ${money(r)} at risk` : ''}${n(w.paid_early_amount) > 0 ? `, ${money(w.paid_early_amount)} already paid` : ''}${i === 0 && n(w.collected_amount) > 0 ? `, ${money(w.collected_amount)} collected so far` : ''}`;
                    return (
                      <li key={w.week_start} className="flex min-w-[44px] flex-1 flex-col items-center" title={tip} aria-label={tip} tabIndex={0}>
                        <span className="num mb-1 text-[11px] font-medium text-text2">{d > 0 ? short(d) : '₹0'}</span>
                        <span className="flex h-[112px] w-full max-w-[40px] flex-col justify-end" aria-hidden>
                          {r > 0 && <span className="block w-full rounded-t-[4px]" style={{ ...STRIPES, height: rh }} />}
                          {d - r > 0 && <span className={cx('block w-full', r > 0 ? 'mt-[2px]' : 'rounded-t-[4px]')} style={{ backgroundColor: DUE, height: Math.max(0, h - rh - (r > 0 ? 2 : 0)) }} />}
                          <span className="block h-px w-full bg-line2" />
                        </span>
                        <span className={cx('mt-1 whitespace-nowrap text-[11px]', i === 0 ? 'font-semibold text-text' : 'text-muted')}>{label}</span>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <div id="collections-weeks-table" className="mt-1 overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <caption className="pb-1 text-left text-xs text-muted">Weeks start on Monday (India time). This week counts from today.</caption>
                    <thead>
                      <tr className="text-xs text-muted">
                        <th scope="col" className="py-1 text-left font-medium">Week</th>
                        <th scope="col" className="py-1 text-right font-medium">Due</th>
                        <th scope="col" className="py-1 pl-3 text-right font-medium">At risk</th>
                        <th scope="col" className="py-1 pl-3 text-right font-medium">Already paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weeks.map((w) => (
                        <tr key={w.week_start} className="border-t border-line">
                          <th scope="row" className="py-1.5 text-left font-normal">{span(w.from_day, w.to_day)}</th>
                          <td className="num py-1.5 text-right">{money(w.due_amount)} <span className="text-muted">· {n(w.due_count)}</span></td>
                          <td className="num py-1.5 pl-3 text-right">{money(w.at_risk_amount)}</td>
                          <td className="num py-1.5 pl-3 text-right">{money(w.paid_early_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Who to act on */}
          <div className="mt-4">
            <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">
              Students at risk{n(sum.at_risk_students) > top.length ? ` · top ${top.length} of ${n(sum.at_risk_students)}` : ''}
            </h3>
            {top.length === 0 ? (
              <p className="mt-1 text-[13px] text-text2">No student is late now or has paid late before, with money owed in this period.</p>
            ) : (
              <ul className="mt-1">
                {top.map((r) => (
                  <li key={r.candidate_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line py-2 first:border-0">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-medium" title={r.name}>{r.name}</div>
                      <div className="text-[12.5px] text-text2">
                        <span className={r.days_late != null ? 'font-medium text-badText' : 'text-warnText'}>{r.reason}</span>
                        {r.overdue_amount > 0 && <> · {money(r.overdue_amount)} overdue</>}
                        {r.due_soon_amount > 0 && <> · {money(r.due_soon_amount)} due {dayMon(r.next_due_on)}</>}
                      </div>
                      {sent[r.candidate_id] && <div className="mt-0.5 flex items-center gap-1 text-[12px] text-text2" role="status"><Check size={12} aria-hidden />{sent[r.candidate_id]}</div>}
                    </div>
                    <span className="num text-[13.5px] font-semibold">{money(r.amount)}</span>
                    <div className="flex items-center gap-1.5">
                      <Link href={'/candidate/' + r.candidate_id} className="inline-flex h-11 items-center rounded-lg border border-line2 bg-surface px-3 text-[13px] font-medium text-text hover:bg-surface2 md:h-8">Open</Link>
                      {canRemind && channels && (channels.whatsapp || channels.email) && (
                        <Confirm title={`Send a fee reminder to ${r.name}?`} body={reminderText(r).replace('{{first_name}}', r.name.split(' ')[0])} yes="Send reminder" danger={false}
                          onYes={() => void remind(r)} disabled={!!sending || !!sent[r.candidate_id]?.startsWith('Reminder sent')} ariaLabel={`Send a fee reminder to ${r.name}`}
                          className="inline-flex h-11 items-center rounded-lg bg-accentSoft px-3 text-[13px] font-semibold text-accentText hover:brightness-[.97] disabled:opacity-50 md:h-8">
                          {sending === r.candidate_id ? 'Sending…' : 'Remind'}
                        </Confirm>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {noChannel && top.length > 0 && <p className="mt-1 text-xs text-muted">Reminders can’t be sent from here yet because WhatsApp and email are not set up. Open the student to follow up.</p>}
          </div>

          <button type="button" aria-expanded={how} aria-controls="collections-how" onClick={() => setHow(!how)}
            className="mt-2 inline-flex min-h-[44px] items-center gap-1 rounded-lg px-1 text-[13px] font-medium text-accentText hover:underline">
            How it’s counted <ChevronDown size={14} aria-hidden className={cx('transition-transform', how && 'rotate-180')} />
          </button>
          {how && (
            <ul id="collections-how" className="mt-1 list-disc space-y-1 pl-5 text-[12.5px] text-text2">
              <li><b className="font-medium text-text">Due</b>: instalments not paid yet whose due day falls between today and {dayMon(sum.to)} (India time).</li>
              <li><b className="font-medium text-text">At risk</b>: the part of that owed by a student who has an instalment past its due day now, or who paid an earlier one more than 14 days late.</li>
              <li><b className="font-medium text-text">Already paid</b>: instalments due in this period that were paid ahead of time.</li>
              <li><b className="font-medium text-text">Already overdue</b>: unpaid instalments whose due day has passed. They are not part of the next {days} days.</li>
              <li><b className="font-medium text-text">Collected this month</b>: payments received from the 1st of this month to today.</li>
              <li>Refunds are not counted. Weeks start on Monday; this week counts from today.</li>
            </ul>
          )}
        </>
      )}
    </section>
  );
}
