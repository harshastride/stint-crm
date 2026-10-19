'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, MessageSquareText, PhoneCall, RefreshCw, Send, Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { plainMessage } from '@/lib/plainMessage';
import { PageHeader } from '../kit/PageHeader';
import { EmptyState } from '../kit/EmptyState';
import { Confirm } from '../kit/Confirm';
import { Button, ButtonGroup, Notice, cx, fmtDateTime } from '../ui';
import { friendlyError } from '../Fields';
import { useToast } from '../Toasts';

// Win-back: leads we already paid for that said no (or stopped replying) long enough ago to try again, grouped by
// why they were lost. Per lead: write a message that answers that reason (AI draft from the Sales playbook, checked by
// the person), put the lead back into calling, or put it aside for another cooling period.
// Rows come from winback_list (the database decides who sees which lead; never mobile or email).

type Row = {
  lead_id: string; full_name: string; first_name: string; stage: string; kind: 'Lost' | 'Went quiet'; reason_group: string;
  course: string | null; owner_id: string | null; owner_name: string | null; days_since: number; last_note: string | null;
  last_outcome: string | null; tries: number; max_tries: number; marketing_consent: boolean; why: string;
};
type Summary = { can_win_back: number; back_this_month: number; moved_on_this_month: number; joined_this_month: number; after_days: number; max_tries: number };
type Lang = 'English' | 'Telugu' | 'Hindi';
type Draft = { lang: Lang; message: string; uses: string[]; playbookItems: number; loading: boolean; error: string };
type Done = { stage: string; next_call_at: string; owner_name: string | null; sent?: boolean };

const LIMIT = 1000;
const COLS = 'lead_id, full_name, first_name, stage, kind, reason_group, course, owner_id, owner_name, days_since, last_note, last_outcome, tries, max_tries, marketing_consent, why';
const field = 'h-11 min-w-0 rounded-[10px] border border-line2 bg-surface px-2.5 text-[13px] md:h-9';
const daysText = (n: number) => (n === 1 ? '1 day' : `${n} days`);

export function WinBack() {
  const s = useSession();
  const toast = useToast();
  const canWrite = s.can('winback', 'w');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [sum, setSum] = useState<Summary | null>(null);
  const [err, setErr] = useState('');
  const [reason, setReason] = useState<string>('all');
  const [owner, setOwner] = useState<string>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, Done>>({});
  const [whatsapp, setWhatsapp] = useState(false);

  const loadSummary = useCallback(async () => {
    const { data, error } = await supabase().rpc('winback_summary');
    if (!error) setSum(data as Summary);
  }, []);
  const load = useCallback(async () => {
    const [list] = await Promise.all([
      supabase().from('winback_list').select(COLS, { count: 'exact' }).order('reason_group').order('days_since', { ascending: true }).limit(LIMIT),
      loadSummary(),
    ]);
    if (list.error) { setErr(friendlyError(list.error, 'the Win-back list', 'Could not load the Win-back list. Please try again.')); setRows((r) => r || []); }
    else { setErr(''); setRows((list.data || []) as Row[]); setTotal(list.count ?? null); setDone({}); }
  }, [loadSummary]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!canWrite) return;
    fetch('/api/messages/send').then((r) => r.json()).then((j) => setWhatsapp(!!j?.whatsapp)).catch(() => setWhatsapp(false));
  }, [canWrite]);

  // filters: reason chips (with counts), owner (only when more than one owner is in the list), name search
  const visible = useMemo(() => rows || [], [rows]);
  const owners = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of visible) m.set(r.owner_id || 'none', r.owner_name || 'No owner');
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [visible]);
  const byOwner = visible.filter((r) => owner === 'all' || (r.owner_id || 'none') === owner)
    .filter((r) => !q.trim() || r.full_name.toLowerCase().includes(q.trim().toLowerCase()));
  const reasons = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of byOwner) if (!done[r.lead_id]) m.set(r.reason_group, (m.get(r.reason_group) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [byOwner, done]);
  const shown = byOwner.filter((r) => reason === 'all' || r.reason_group === reason);
  const groups = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of shown) m.set(r.reason_group, [...(m.get(r.reason_group) || []), r]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [shown]);
  const leftCount = (rows || []).filter((r) => !done[r.lead_id]).length;

  // ---- actions
  const write = async (r: Row, lang: Lang) => {
    setOpen(r.lead_id);
    setDrafts((d) => ({ ...d, [r.lead_id]: { lang, message: d[r.lead_id]?.message || '', uses: d[r.lead_id]?.uses || [], playbookItems: d[r.lead_id]?.playbookItems ?? 0, loading: true, error: '' } }));
    try {
      const res = await fetch('/api/ai/winback-message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lead_id: r.lead_id, language: lang }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.message) throw new Error(plainMessage(j?.error, 'Could not write the message. Please try again.'));
      setDrafts((d) => ({ ...d, [r.lead_id]: { lang, message: j.message, uses: j.uses_playbook || [], playbookItems: j.playbook_items ?? 0, loading: false, error: '' } }));
    } catch (e) {
      const m = e instanceof Error ? plainMessage(e.message, 'Could not write the message. Please try again.') : 'Could not write the message. Please try again.';
      setDrafts((d) => ({ ...d, [r.lead_id]: { ...(d[r.lead_id] || { message: '', uses: [], playbookItems: 0 }), lang, loading: false, error: m } }));
    }
  };

  const logAttempt = (r: Row, outcome: 'copied' | 'sent' | 'skipped', message?: string, channel: 'copy' | 'whatsapp' | 'none' = 'none') =>
    supabase().from('winback_attempt').insert({ lead_id: r.lead_id, by_id: s.staff.id, outcome, channel, message: message || null, lost_reason: r.kind === 'Lost' ? r.reason_group : null }).select('id').single();

  const copy = async (r: Row) => {
    const text = drafts[r.lead_id]?.message || '';
    try { await navigator.clipboard.writeText(text); toast('Message copied.'); }
    catch { toast('Could not copy. Select the text and copy it by hand.', { tone: 'bad' }); return; }
    if (canWrite) logAttempt(r, 'copied', text, 'copy').then(({ error }: { error: unknown }) => { if (error) console.error('winback copy log failed'); });
  };

  const reopen = async (r: Row, message?: string, channel?: 'whatsapp') => {
    setBusy(r.lead_id);
    const { data, error } = await supabase().rpc('winback_reopen', { p_lead: r.lead_id, p_message: message || null, p_channel: channel || null });
    setBusy(null);
    if (error) { toast(friendlyError(error, 'this lead', 'Could not move the lead back to calling. Please try again.'), { tone: 'bad' }); return null; }
    const d = data as Done;
    setDone((x) => ({ ...x, [r.lead_id]: d }));   // the row stays (with "Open lead") until the next refresh
    if (open === r.lead_id) setOpen(null);
    loadSummary();
    return d;
  };

  const backToCalling = async (r: Row) => {
    const d = await reopen(r);
    if (d) toast(`${r.first_name} is back in calling. Next call ${fmtDateTime(d.next_call_at)}${d.owner_name ? `, follow-up for ${d.owner_name}` : ''}.`);
  };

  const sendWhatsapp = async (r: Row) => {
    const text = (drafts[r.lead_id]?.message || '').trim();
    if (!text) return;
    const d = await reopen(r, text, 'whatsapp');
    if (!d) return;
    setBusy(r.lead_id);
    try {
      const res = await fetch('/api/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'whatsapp', lead_id: r.lead_id, body: text }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(plainMessage(j?.error, 'The message did not go.'));
      setDone((x) => ({ ...x, [r.lead_id]: { ...d, sent: true } }));
      logAttempt(r, 'sent', text, 'whatsapp').then(({ error }: { error: unknown }) => { if (error) console.error('winback send log failed'); });
      toast(`Sent to ${r.first_name} on WhatsApp. They are back in calling.`);
    } catch (e) {
      toast(`${r.first_name} is back in calling, but the WhatsApp message didn’t go${e instanceof Error && e.message ? ': ' + e.message : '.'} Copy it and send it yourself.`, { tone: 'bad' });
    } finally { setBusy(null); }
  };

  const notNow = async (r: Row) => {
    setBusy(r.lead_id);
    const { data, error } = await logAttempt(r, 'skipped');
    setBusy(null);
    if (error) { toast(friendlyError(error, 'this lead', 'Could not put the lead aside. Please try again.'), { tone: 'bad' }); return; }
    setRows((x) => (x || []).filter((y) => y.lead_id !== r.lead_id));
    if (open === r.lead_id) setOpen(null);
    toast(`${r.first_name} is put aside for ${daysText(sum?.after_days ?? 60)}.`, {
      undo: async () => {
        const { error: e2 } = await supabase().from('winback_attempt').delete().eq('id', (data as { id: string }).id);
        if (e2) toast('Could not undo. Please try again.', { tone: 'bad' });
        load();
      },
    });
    loadSummary();
  };

  // ---- view
  const after = sum?.after_days ?? 60;
  return (
    <main className="flex flex-1 flex-col gap-3 overflow-y-auto p-4 md:px-6 md:py-4">
      <PageHeader group="Telecalling" title="Win-back"
        description={`Leads that said no or stopped replying more than ${after} days ago and nobody has contacted since. Write a message that answers why they said no, then put them back into calling.`}
        actions={<Button variant="outline" size="lg" className="md:h-9" onClick={load} leftIcon={<RefreshCw size={15} />}>Refresh</Button>}
        filters={rows && rows.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <input aria-label="Search by name" placeholder="Search by name" className={field + ' w-44'} value={q} onChange={(e) => setQ(e.target.value)} />
            {owners.length > 1 && (
              <select aria-label="Owner" className={field} value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="all">Every owner</option>
                {owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            )}
          </div>
        ) : undefined} />

      {/* summary: what can be won back now, and what came back this month */}
      <section aria-label="Win-back summary" className="flex flex-wrap items-stretch gap-x-6 gap-y-2 rounded-card bg-surface px-4 py-3 shadow-1">
        <Stat label="Can be won back now" value={sum ? sum.can_win_back : null} hint={`Lost or quiet for over ${after} days, not contacted since`} />
        <Stat label="Back in calling this month" value={sum ? sum.back_this_month : null} hint="Brought back from this list since the 1st (India time)" />
        <Stat label="Moved on since" value={sum ? sum.moved_on_this_month : null}
          hint={sum ? `Of those, now Interested or further${sum.joined_this_month ? ` · ${sum.joined_this_month} joined` : ''}` : 'Of those, now Interested or further'} />
      </section>

      {err && <Notice tone="bad">{err}</Notice>}

      {rows === null ? <div className="rounded-card bg-surface p-6 text-muted shadow-1">Loading…</div>
        : rows.length === 0 && !err ? (
          <EmptyState kind="done" title="No one to win back right now"
            body={`Leads appear here ${after} days after they said no or stopped replying, if nobody has contacted them since. Each lead can be brought back ${sum?.max_tries ?? 2} times.`} />
        ) : (
          <>
            {reasons.length > 0 && (
              <div role="group" aria-label="Why they were lost" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
                <Chip on={reason === 'all'} onClick={() => setReason('all')}>All · {reasons.reduce((a, [, n]) => a + n, 0)}</Chip>
                {reasons.map(([g, n]) => <Chip key={g} on={reason === g} onClick={() => setReason(g)}>{g} · {n}</Chip>)}
              </div>
            )}
            {total !== null && total > LIMIT && <p className="text-xs text-muted">Showing the first {LIMIT} of {total}. Use the reason or owner filter to narrow it.</p>}
            {groups.length === 0 && <EmptyState kind="search" title="Nobody matches" body="Try another name, owner or reason." />}

            {groups.map(([g, list]) => (
              <section key={g} aria-label={`${g}, ${list.length}`} className="rounded-card bg-surface shadow-1">
                <h2 className="flex items-baseline gap-2 border-b border-line px-4 py-2.5 text-[13.5px] font-semibold">
                  {g}<span className="text-[12.5px] font-medium text-muted">· {list.length}</span>
                </h2>
                <ul>
                  {list.map((r) => {
                    const dn = done[r.lead_id], dr = drafts[r.lead_id], isOpen = open === r.lead_id, working = busy === r.lead_id;
                    return (
                      <li key={r.lead_id} data-testid="winback-row" className="border-t border-line px-4 py-3 first:border-0">
                        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-4">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="truncate text-[14px] font-medium" title={r.full_name}>{r.full_name}</span>
                              <span className="text-[12.5px] text-text2">{r.course || 'Course not chosen'}</span>
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-muted">
                              <span>{r.kind === 'Lost' ? `Said no ${daysText(r.days_since)} ago` : `Quiet for ${daysText(r.days_since)}`}</span>
                              <span aria-hidden>·</span><span>{r.owner_name ? `Owner: ${r.owner_name}` : 'No owner'}</span>
                              {r.tries > 0 && <><span aria-hidden>·</span><span>Brought back {r.tries} of {r.max_tries} times</span></>}
                              {r.kind === 'Went quiet' && r.last_outcome && <><span aria-hidden>·</span><span>Last call: {r.last_outcome}</span></>}
                            </div>
                            {r.last_note && <p className="mt-1 line-clamp-2 text-[12.5px] text-text2" title={r.last_note}><span className="text-muted">Last note: </span>{r.last_note}</p>}
                          </div>

                          {dn ? (
                            <div className="flex shrink-0 flex-wrap items-center gap-2 text-[12.5px]">
                              <span className="font-medium text-goodText">{dn.sent ? 'Message sent · back in calling' : 'Back in calling'} ({dn.stage})</span>
                              <Link href={`/p/lead?person=lead:${r.lead_id}`} className="inline-flex min-h-[44px] items-center font-medium text-accentText hover:underline md:min-h-[32px]">Open lead</Link>
                            </div>
                          ) : (
                            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                              <Button variant={isOpen ? 'secondary' : 'outline'} className="h-11 md:h-9" aria-expanded={isOpen} leftIcon={<MessageSquareText size={15} />}
                                onClick={() => (isOpen ? setOpen(null) : dr?.message ? setOpen(r.lead_id) : write(r, dr?.lang || 'English'))}>Write message</Button>
                              {canWrite && <Button variant="primary" className="h-11 md:h-9" loading={working && !isOpen} disabled={working} leftIcon={<PhoneCall size={15} />} onClick={() => backToCalling(r)}>Back to calling</Button>}
                              {canWrite && <Button variant="quiet" className="h-11 md:h-9" disabled={working} leftIcon={<Clock size={15} />} onClick={() => notNow(r)} aria-label={`Not now: put ${r.first_name} aside for ${daysText(after)}`}>Not now</Button>}
                            </div>
                          )}
                        </div>

                        {isOpen && (
                          <div className="mt-3 rounded-[12px] border border-line bg-surface2 p-3" aria-live="polite">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <ButtonGroup label="Language">
                                {(['English', 'Telugu', 'Hindi'] as Lang[]).map((l) => (
                                  <Button key={l} size="sm" active={dr?.lang === l} disabled={dr?.loading} className="h-11 md:h-9" onClick={() => write(r, l)}>{l}</Button>
                                ))}
                              </ButtonGroup>
                              <Button variant="quiet" size="sm" className="h-11 md:h-9" disabled={dr?.loading} leftIcon={<RefreshCw size={14} />} onClick={() => write(r, dr?.lang || 'English')}>Write again</Button>
                            </div>
                            {dr?.loading && <p className="mt-3 text-[13px] text-text2">Writing a message for {r.first_name}…</p>}
                            {dr?.error && !dr.loading && <p className="mt-3 text-[13px] text-badText">{dr.error}</p>}
                            {dr && !dr.loading && dr.message && (
                              <>
                                <label className="mt-3 block text-xs font-medium text-muted" htmlFor={`wb-msg-${r.lead_id}`}>Message (check and edit before sending)</label>
                                <textarea id={`wb-msg-${r.lead_id}`} rows={5} value={dr.message}
                                  onChange={(e) => setDrafts((d) => ({ ...d, [r.lead_id]: { ...d[r.lead_id], message: e.target.value } }))}
                                  className="mt-1 w-full rounded-[10px] border border-line2 bg-surface px-3 py-2 text-[13.5px] leading-relaxed" />
                                <p className="mt-1 text-xs text-muted">
                                  {dr.uses.length ? <>Uses from the Sales playbook: {dr.uses.join(' · ')}</>
                                    : dr.playbookItems === 0 ? 'The Sales playbook is empty, so this message makes no offers.'
                                    : 'Nothing from the Sales playbook fits this reason, so the message makes no offers.'}
                                  {' '}Written by AI. Check it before it goes.
                                </p>
                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                  <Button variant="outline" className="h-11 md:h-9" leftIcon={<Copy size={15} />} onClick={() => copy(r)}>Copy</Button>
                                  {canWrite && whatsapp && r.marketing_consent && (
                                    <Confirm danger={false} yes="Send" title={`Send to ${r.first_name} on WhatsApp?`} body="This also puts them back into calling, with a follow-up for the owner." align="left"
                                      disabled={working || !dr.message.trim()}
                                      className="btn inline-flex h-11 items-center gap-2 rounded-[10px] border border-transparent bg-accent px-4 text-[13.5px] font-semibold text-white hover:brightness-110 disabled:opacity-50 md:h-9"
                                      onYes={() => sendWhatsapp(r)}>
                                      <Send size={15} aria-hidden />{working ? 'Sending…' : 'Send on WhatsApp'}
                                    </Confirm>
                                  )}
                                </div>
                                {canWrite && whatsapp && !r.marketing_consent && (
                                  <p className="mt-2 text-xs text-text2">{r.first_name} hasn’t agreed to messages, so WhatsApp sending is off. Use Back to calling and ask on the call, or copy the message to use after they agree.</p>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {leftCount === 0 && rows.length > 0 && <p className="text-[13px] text-text2">All done here. Everyone on the list is back in calling.</p>}
          </>
        )}
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: number | null; hint: string }) {
  return (
    <div className="min-w-[150px] flex-1">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="num mt-0.5 text-[22px] font-semibold leading-tight">{value === null ? '—' : value}</div>
      <div className="text-[11.5px] text-text2">{hint}</div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cx('inline-flex h-11 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-[13px] font-medium md:h-9',
        on ? 'border-transparent bg-accentSoft text-accentText' : 'border-line2 bg-surface text-text2 hover:bg-surface2')}>
      {children}
    </button>
  );
}
