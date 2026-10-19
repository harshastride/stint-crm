'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bot, ExternalLink, MessageCircle, PhoneMissed, RefreshCw, UserPlus, Hand, Ban, Undo2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { PageHeader } from '../kit/PageHeader';
import { EmptyState } from '../kit/EmptyState';
import { ChatThread } from '../kit/ChatThread';
import { Button, ButtonGroup, IconButton, Notice, Pill, cx, fmtDateTime } from '../ui';
import { friendlyError } from '../Fields';
import { useToast } from '../Toasts';

// New conversations (page `inbox`, migration 096): WhatsApp messages from numbers that are not a lead yet, and missed
// calls to the institute's tracking number. Telecallers make each one a lead (name + course; the number comes from the
// message on the server and is never typed or shown) or mark it Not a lead. Staff only ever see the masked number.

type Conv = {
  id: string; number_masked: string; channel: 'whatsapp' | 'missed_call'; profile_name: string | null; status: 'New' | 'Lead' | 'Not a lead';
  reason: string | null; lead_id: string | null; auto_created: boolean; taken_by: string | null; closed_by: string | null; closed_at: string | null;
  first_at: string; last_at: string; last_text: string | null; message_count: number; missed_calls: number; last_missed_call_at: string | null;
};
type Msg = { id: string; direction: 'in' | 'out'; body: string | null; status: string; error: string | null; created_at: string; auto: boolean; by_name: string | null };
type Tab = 'new' | 'mine' | 'done';

const COLS = 'id, number_masked, channel, profile_name, status, reason, lead_id, auto_created, taken_by, closed_by, closed_at, first_at, last_at, last_text, message_count, missed_calls, last_missed_call_at';
const IST = 'Asia/Kolkata';
const dayKey = (v: string) => new Date(v).toLocaleDateString('en-CA', { timeZone: IST });
function dayLabel(v: string) {
  const k = dayKey(v), today = dayKey(new Date().toISOString()), y = dayKey(new Date(Date.now() - 864e5).toISOString());
  if (k === today) return 'Today';
  if (k === y) return 'Yesterday';
  return new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: IST });
}
const timeOf = (v: string) => new Date(v).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: IST });
const title = (c: Conv) => c.profile_name || (c.channel === 'missed_call' ? 'Missed call' : 'New number');
const statusText = (c: Conv) => (c.status === 'Not a lead' ? 'Not a lead' + (c.reason ? ' · ' + c.reason : '') : c.status === 'Lead' ? 'Made a lead' : 'New');

export function CaptureInbox() {
  const s = useSession();
  const toast = useToast();
  const canWrite = s.can('inbox', 'w');
  const [tab, setTab] = useState<Tab>('new');
  const [rows, setRows] = useState<Conv[] | null>(null);
  const [counts, setCounts] = useState<{ new: number; mine: number } | null>(null);
  const [open, setOpen] = useState<Conv | null>(null);   // kept while the list reloads (a conversation made a lead leaves the New list)
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [wa, setWa] = useState<boolean | null>(null);
  const [auto, setAuto] = useState<boolean | null>(null);
  const [anyMissed, setAnyMissed] = useState<boolean | null>(null);
  const [tick, setTick] = useState(0);
  const names = useMemo(() => Object.fromEntries(s.refs.staff.map((p) => [p.id, p.label])), [s.refs.staff]);

  const load = useCallback(async () => {
    const db = supabase();
    let q = db.from('capture_conversation').select(COLS).order('last_at', { ascending: false }).limit(200);
    q = tab === 'done' ? q.neq('status', 'New') : q.eq('status', 'New');
    if (tab === 'mine') q = q.eq('taken_by', s.staff.id);
    const [list, c, missed] = await Promise.all([q, db.rpc('capture_counts'), db.from('capture_conversation').select('id', { count: 'exact', head: true }).eq('channel', 'missed_call')]);
    if (list.error) { setLoadErr(friendlyError(list.error, 'new conversations', 'Could not load the conversations. Please try again.')); setRows([]); return; }
    setLoadErr(null);
    const fresh = (list.data || []) as Conv[];
    setRows(fresh);
    setOpen((o) => (o ? fresh.find((r) => r.id === o.id) || o : o));
    if (c.data) setCounts({ new: Number(c.data.new || 0), mine: Number(c.data.mine || 0) });
    setAnyMissed((missed.count || 0) > 0);
  }, [tab, s.staff.id]);

  useEffect(() => { load(); }, [load, tick]);
  // new messages arrive by themselves: look again every 30 seconds while the page is open
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') setTick((n) => n + 1); }, 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    fetch('/api/messages/send').then((r) => (r.ok ? r.json() : null)).then((j) => setWa(j ? !!j.whatsapp : null)).catch(() => setWa(null));
    supabase().from('setting').select('value').eq('key', 'capture_auto_create').maybeSingle().then(({ data }) => setAuto(/^(on|yes|true)$/i.test(String(data?.value || '').trim())));
  }, []);

  const toggleAuto = async () => {
    const next = !auto;
    const { error } = await supabase().from('setting').update({ value: next ? 'on' : 'off' }).eq('key', 'capture_auto_create');
    if (error) { toast(friendlyError(error, 'this setting'), { tone: 'bad' }); return; }
    setAuto(next);
    toast(next ? 'New WhatsApp numbers now become leads straight away.' : 'New WhatsApp numbers now wait here for a person to check.');
  };

  const groups: { label: string; items: Conv[] }[] = [];
  for (const r of rows || []) {
    const label = dayLabel(r.last_at);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(r); else groups.push({ label, items: [r] });
  }

  const tabBtn = (t: Tab, label: string, n?: number) => (
    <Button size="sm" active={tab === t} onClick={() => { setTab(t); setOpen(null); setRows(null); }} className="h-11 md:h-9">
      {label}{n != null && <span className="num ml-1 rounded-full bg-surface2 px-1.5 text-[11px] font-semibold text-text2">{n}</span>}
    </Button>
  );

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:overflow-hidden md:p-6">
      <PageHeader group="Telecalling" title="New conversations"
        description="WhatsApp messages from new numbers and missed calls to the institute. Make each one a lead, or mark it Not a lead."
        actions={<IconButton aria-label="Look for new messages" icon={<RefreshCw size={16} />} onClick={() => setTick((n) => n + 1)} />} />

      {wa === false && (
        <Notice tone="warn">WhatsApp isn’t switched on yet. Messages from new numbers will show here once the admin connects the institute’s WhatsApp number. Auto-replies are saved and go out then.</Notice>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-text2">
        {auto !== null && (
          <span className="inline-flex flex-wrap items-center gap-2">
            New WhatsApp numbers: <b className="font-semibold text-text">{auto ? 'become leads straight away' : 'wait here for you to check'}</b>
            {s.can('branding', 'w') && <Button size="sm" variant="link" className="h-11 md:h-8" onClick={toggleAuto}>{auto ? 'Keep them here instead' : 'Make leads straight away'}</Button>}
          </span>
        )}
        {anyMissed === false && <span>No missed calls received yet. They show here once the admin connects the institute’s call-tracking number.</span>}
      </div>
      {loadErr && <Notice tone="bad">{loadErr}</Notice>}

      <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
        <section aria-label="Conversations" className={cx('flex min-h-0 flex-col gap-3 md:w-[360px] md:shrink-0', open && 'max-md:hidden')}>
          <ButtonGroup label="Show" className="self-start">
            {tabBtn('new', 'New', counts?.new)}{tabBtn('mine', 'Mine', counts?.mine)}{tabBtn('done', 'Done')}
          </ButtonGroup>
          <div className="flex min-h-0 flex-1 flex-col gap-3 md:overflow-y-auto md:pr-1">
            {rows === null ? <p className="rounded-[14px] bg-surface p-6 text-center text-[13px] text-text2 shadow-[var(--shadow-1)]">Loading…</p>
              : rows.length === 0 ? (
                tab === 'new' ? <EmptyState kind="done" title="No new conversations" body="When someone new messages the institute on WhatsApp, or gives a missed call, it shows here." />
                  : tab === 'mine' ? <EmptyState title="Nothing taken by you" body="Open a conversation in New and press Take this to keep it in your list." />
                    : <EmptyState title="Nothing handled recently" body="Conversations you make a lead or mark Not a lead show here." />
              ) : groups.map((g) => (
                <div key={g.label} className="flex flex-col gap-1">
                  <h3 className="px-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{g.label}</h3>
                  <ul className="flex flex-col overflow-hidden rounded-[14px] bg-surface shadow-[var(--shadow-1)]">
                    {g.items.map((c) => {
                      const Icon = c.channel === 'missed_call' ? PhoneMissed : MessageCircle;
                      return (
                        <li key={c.id} className="border-b border-line last:border-b-0">
                          <button type="button" onClick={() => setOpen(c)} aria-current={open?.id === c.id || undefined}
                            className={cx('flex min-h-[64px] w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface2', open?.id === c.id && 'bg-accentSoft hover:bg-accentSoft')}>
                            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface2 text-text2"><Icon size={15} aria-hidden /></span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-baseline gap-2">
                                <span className="truncate text-[13.5px] font-semibold">{title(c)}</span>
                                <span className="num ml-auto shrink-0 text-[11.5px] text-muted">{timeOf(c.last_at)}</span>
                              </span>
                              <span className="block truncate text-[12.5px] text-text2">
                                <span className="num">{c.number_masked}</span> · {c.channel === 'missed_call' ? (c.missed_calls > 1 ? `${c.missed_calls} missed calls` : 'Missed call') : (c.last_text || 'WhatsApp')}
                              </span>
                              {(tab === 'done' || c.taken_by) && (
                                <span className="mt-1 flex flex-wrap gap-1.5 text-[11.5px]">
                                  {tab === 'done' && <Pill>{statusText(c)}</Pill>}
                                  {tab !== 'done' && c.taken_by && <span className="rounded-full bg-surface2 px-2 py-[2px] font-medium text-text2">{c.taken_by === s.staff.id ? 'Taken by you' : 'Taken by ' + (names[c.taken_by] || 'a colleague')}</span>}
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            {rows && rows.length >= 200 && <p className="px-1 text-[12px] text-muted">Showing the latest 200.</p>}
          </div>
        </section>

        <section aria-label="Conversation" className={cx('flex min-h-0 min-w-0 flex-1 flex-col', !open && 'max-md:hidden')}>
          {open ? <Conversation key={open.id} c={open} canWrite={canWrite} waReady={wa} names={names} me={s.staff.id}
            programs={s.refs.program} reasons={s.lists.capture_not_lead || []} onBack={() => setOpen(null)}
            onChanged={(stay) => { if (!stay) setOpen(null); setTick((n) => n + 1); }} toast={toast} />
            : <div className="hidden flex-1 items-center justify-center rounded-[14px] border border-dashed border-line2 p-6 text-[13px] text-text2 md:flex">Pick a conversation to read it.</div>}
        </section>
      </div>
    </main>
  );
}

function Conversation({ c, canWrite, waReady, names, me, programs, reasons, onBack, onChanged, toast }: {
  c: Conv; canWrite: boolean; waReady: boolean | null; names: Record<string, string>; me: string;
  programs: { id: string; label: string }[]; reasons: string[]; onBack: () => void; onChanged: (stay?: boolean) => void;
  toast: ReturnType<typeof useToast>;
}) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState(c.profile_name || '');
  const [program, setProgram] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'take' | 'lead' | 'not' | 'back' | null>(null);
  const [made, setMade] = useState<string | null>(null);   // lead id just made here: show its chat with the composer

  useEffect(() => {
    let live = true;
    supabase().rpc('capture_thread', { p_id: c.id }).then(({ data, error }) => {
      if (!live) return;
      if (error) { setErr(friendlyError(error, 'this conversation', 'Could not open this conversation.')); setMsgs([]); return; }
      setMsgs((data || []) as Msg[]);
    });
    return () => { live = false; };
  }, [c.id, c.last_at]);

  const run = async (what: typeof busy, fn: () => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>, done: (data: unknown) => void) => {
    setBusy(what); setErr(null);
    const { data, error } = await fn();
    setBusy(null);
    if (error) { setErr(friendlyError(error, 'this conversation')); return; }
    done(data);
  };
  const take = () => run('take', () => supabase().rpc('capture_take', { p_id: c.id }), () => { toast('Taken. It is in your Mine list.'); onChanged(true); });
  const makeLead = () => {
    if (!name.trim()) { setErr('Type their name first.'); return; }
    run('lead', () => supabase().rpc('capture_make_lead', { p_id: c.id, p_name: name.trim(), p_program: program || null }), (d) => {
      const r = d as { lead_id: string; owner: string | null };
      setMade(r.lead_id);
      toast(`${name.trim()} is now a lead${r.owner ? ' with ' + r.owner : ''}.`);
      onChanged(true);
    });
  };
  const notLead = () => {
    if (!reason) { setErr('Pick a reason first.'); return; }
    run('not', () => supabase().rpc('capture_not_lead', { p_id: c.id, p_reason: reason }), () => {
      toast('Marked Not a lead (' + reason + ').', { undo: async () => { await supabase().rpc('capture_reopen', { p_id: c.id }); onChanged(true); } });
      onChanged();
    });
  };
  const putBack = () => run('back', () => supabase().rpc('capture_reopen', { p_id: c.id }), () => { toast('Put back in New.'); onChanged(); });

  const leadId = made || (c.status === 'Lead' ? c.lead_id : null);
  const Icon = c.channel === 'missed_call' ? PhoneMissed : MessageCircle;
  const outcome = c.status === 'Lead'
    ? (c.auto_created ? 'Made a lead automatically' : c.closed_by ? 'Made a lead by ' + (c.closed_by === me ? 'you' : names[c.closed_by] || 'a colleague') : 'Already a lead')
    : c.status === 'Not a lead' ? 'Marked Not a lead' + (c.reason ? ' (' + c.reason + ')' : '') + (c.closed_by ? ' by ' + (c.closed_by === me ? 'you' : names[c.closed_by] || 'a colleague') : '') : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-[14px] bg-surface p-3 shadow-[var(--shadow-1)] md:p-4">
      <header className="flex items-start gap-2">
        <IconButton aria-label="Back to the list" icon={<ArrowLeft size={18} />} onClick={onBack} size="icon-lg" className="md:hidden" />
        <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface2 text-text2"><Icon size={16} aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[16px] font-semibold leading-6">{title(c)}</h2>
          <p className="text-[12.5px] text-text2">
            <span className="num">{c.number_masked}</span> · {c.channel === 'missed_call' ? 'Missed call' : 'WhatsApp'} · first contact {fmtDateTime(c.first_at)}
            {c.missed_calls > 0 && c.channel !== 'missed_call' ? ` · ${c.missed_calls} missed call${c.missed_calls > 1 ? 's' : ''}` : ''}
          </p>
        </div>
        <Pill>{statusText(c)}</Pill>
      </header>

      {err && <Notice tone="bad">{err}</Notice>}
      {outcome && !made && <p className="text-[12.5px] text-text2">{outcome}{c.closed_at ? ' · ' + fmtDateTime(c.closed_at) : ''}</p>}

      {leadId ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {made && <Notice tone="good">Made a lead. You can message them below, or open the lead to call.</Notice>}
            <Link href={`/p/lead?person=lead:${leadId}`} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[10px] px-2 text-[13px] font-semibold text-accentText hover:underline md:min-h-[36px]">
              <ExternalLink size={14} aria-hidden />Open lead
            </Link>
          </div>
          <div className="flex min-h-0 flex-1 flex-col"><ChatThread kind="lead" id={leadId} channel="whatsapp" /></div>
        </>
      ) : (
        <>
          <Thread c={c} msgs={msgs} waReady={waReady} />
          {c.status === 'New' && canWrite && (
            <div className="flex flex-col gap-3 border-t border-line pt-3">
              {c.taken_by !== me && (
                <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-text2">
                  {c.taken_by ? <span>{names[c.taken_by] || 'A colleague'} is on this.</span> : <span>Nobody has taken this yet.</span>}
                  {!c.taken_by && <Button size="sm" variant="outline" className="h-11 md:h-8" leftIcon={<Hand size={14} />} loading={busy === 'take'} onClick={take}>Take this</Button>}
                </div>
              )}
              <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); makeLead(); }}>
                <div className="text-[13px] font-semibold">Make lead</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-[12px] font-medium text-text2">Name
                    <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" placeholder="Their name"
                      className="h-11 rounded-[10px] border border-line2 bg-surface px-3 text-[13.5px] text-text md:h-9" />
                  </label>
                  <label className="flex flex-col gap-1 text-[12px] font-medium text-text2">Course
                    <select value={program} onChange={(e) => setProgram(e.target.value)} className="h-11 rounded-[10px] border border-line2 bg-surface px-2 text-[13.5px] text-text md:h-9">
                      <option value="">Not sure yet</option>
                      {programs.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </label>
                </div>
                <p className="text-[12px] text-muted">Their number is taken from the message. You don’t need to type it.</p>
                <div><Button type="submit" variant="primary" className="h-11 md:h-9" leftIcon={<UserPlus size={15} />} loading={busy === 'lead'} disabled={!!busy}>Make lead</Button></div>
              </form>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-[12px] font-medium text-text2">Not a lead
                  <select value={reason} onChange={(e) => setReason(e.target.value)} className="h-11 min-w-[180px] rounded-[10px] border border-line2 bg-surface px-2 text-[13.5px] text-text md:h-9">
                    <option value="">Pick a reason</option>
                    {reasons.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
                <Button variant="outline" className="h-11 md:h-9" leftIcon={<Ban size={15} />} loading={busy === 'not'} disabled={!!busy || !reason} onClick={notLead}>Not a lead</Button>
              </div>
            </div>
          )}
          {c.status === 'Not a lead' && canWrite && (
            <div className="border-t border-line pt-3">
              <Button variant="outline" className="h-11 md:h-9" leftIcon={<Undo2 size={15} />} loading={busy === 'back'} onClick={putBack}>Put back in New</Button>
            </div>
          )}
          {!canWrite && c.status === 'New' && <p className="text-[12.5px] text-text2">View only. Your role can’t make leads from here.</p>}
        </>
      )}
    </div>
  );
}

/** Messages of a number that is not a lead yet: theirs on the left, the CRM's auto-reply on the right. */
function Thread({ c, msgs, waReady }: { c: Conv; msgs: Msg[] | null; waReady: boolean | null }) {
  if (!msgs) return <p className="py-6 text-center text-[13px] text-text2">Loading…</p>;
  let last = '';
  const sentLabel = (m: Msg) => ({ queued: waReady === false ? 'Waiting: WhatsApp isn’t switched on yet' : 'Waiting to send', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Not sent' } as Record<string, string>)[m.status] || m.status;
  return (
    <div role="log" aria-label="Messages" className="flex min-h-[200px] flex-1 flex-col gap-1.5 overflow-y-auto rounded-[10px] bg-surface2 p-2">
      {msgs.length === 0 && (
        <p className="py-6 text-center text-[13px] text-text2">
          {c.channel === 'missed_call' ? `${c.missed_calls || 1} missed call${c.missed_calls > 1 ? 's' : ''}${c.last_missed_call_at ? ', last at ' + fmtDateTime(c.last_missed_call_at) : ''}. No messages.` : 'No messages yet.'}
        </p>
      )}
      {msgs.map((m) => {
        const day = dayLabel(m.created_at), sep = day !== last; last = day;
        const mine = m.direction === 'out';
        return (
          <div key={m.id} className="contents">
            {sep && <h4 className="my-1 self-center rounded-full bg-surface px-3 py-0.5 text-[11px] font-semibold text-text2">{day}</h4>}
            <div className={cx('max-w-[85%] rounded-2xl px-3 py-2 text-[13px] shadow-sm', mine ? 'self-end rounded-br-sm bg-accent text-white' : 'self-start rounded-bl-sm bg-surface text-text')}>
              {mine && <div className="flex items-center gap-1.5 text-[12px] font-semibold">{m.auto ? <><Bot size={13} aria-hidden />Auto-reply</> : <><MessageCircle size={13} aria-hidden />{m.by_name || 'WhatsApp'}</>}</div>}
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] opacity-80">{timeOf(m.created_at)}{mine && <> · {sentLabel(m)}</>}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
