'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CalendarClock, Clock, ExternalLink, Pause, Phone, Play, RefreshCw, SkipForward, Sparkles, StepForward } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { stepForFollowUp } from '@/lib/nextSteps';
import { explainStageError } from '@/lib/stageMoves';
import { Button, Notice, Pill, cx, fmtDateTime, fmtDuration } from '../ui';
import { PageHeader } from '../kit/PageHeader';
import { EmptyState } from '../kit/EmptyState';
import { Meter } from '../kit/Meter';
import { ScoreBadge, type Band } from '../kit/ScoreBadge';
import { Reveal, contactStatus, revealOnce } from '../kit/Reveal';
import { ago } from '../kit/Threads';
import { QuickDate } from '../QuickDate';
import { useToast } from '../Toasts';
import { friendlyError } from '../Fields';

// Start my calls: one lead fills the screen. Call, pick what happened (number keys), Enter saves, the next lead opens.
// The list and its order come from the database (my_call_queue, migration 091): overdue first, then Hot → Warm → Cold,
// then those inside their usual answering hours. Saving a call does what the quick panel's "Log call" does
// (call log, stage move, follow-up rule suggestion) and also closes the call follow-up it answered.

type Item = {
  lead_id: string; full_name: string; stage: string; program: string | null;
  due_at: string | null; due_kind: 'follow_up' | 'next_call' | 'new_lead' | 'done'; overdue: boolean; done_today: boolean;
  follow_up_id: string | null; follow_up_title: string | null;
  band: string | null; score: number | null; reasons: string[] | null; best_label: string | null; in_window: boolean;
  called_today_at: string | null; last_contact_at: string | null; pos: number;
};
type Phase = 'ready' | 'calling' | 'paused';
type Next = { title: string; due: string; note: string };
type Brief = { lead_id: string; last_time: string; say_now: string };
type Line = { kind: string; body: string; by_name: string | null; at: string };

// Same moves as the quick panel's Log call (components/QuickPanel.tsx)
const CALL_TO_STAGE: Record<string, string> = { Interested: 'Interested', Callback: 'Callback', 'Booked counselling': 'Counselling', 'Not interested': 'Not interested' };
// "Connected" in the day's count means the person picked up: every outcome except these two
const NOT_CONNECTED = ['No answer', 'Wrong number'];

const indiaDay = (addDays = 0) => new Date(Date.now() + addDays * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const indiaStart = (ymd: string) => new Date(ymd + 'T00:00:00+05:30');
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).toLowerCase();
const span = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return m + ' min';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' h';
  const d = Math.round(h / 24);
  return d + (d === 1 ? ' day' : ' days');
};

/** "Overdue 2 h", "Due in 12 min", "New lead · waiting 40 min", "Called 10:40 am" */
function dueText(it: Item, now: number): { text: string; late: boolean } {
  if (it.done_today) return { text: it.called_today_at ? 'Called ' + clock(it.called_today_at) : 'Done', late: false };
  if (!it.due_at) return { text: 'No time set', late: false };
  const diff = +new Date(it.due_at) - now;
  if (it.due_kind === 'new_lead') return { text: 'New lead · waiting ' + span(-diff), late: -diff > 3600e3 };
  if (diff <= 0) return { text: 'Overdue ' + span(-diff), late: true };
  if (diff < 60e3) return { text: 'Due now', late: false };
  return { text: 'Due in ' + span(diff), late: false };
}

/** Close the follow-up this call answered: call follow-ups always; others only when the outcome settles them. */
function closesFollowUp(title: string, outcome: string) {
  const st = stepForFollowUp(title, 'lead');
  if (!st || st.key === 'call') return true;
  if (outcome === 'Not interested' || outcome === 'Wrong number') return true;
  return st.key === 'counsel' && outcome === 'Booked counselling';
}

/** Hot / Warm / Cold with the score, for list rows (the row itself is the button, so not the interactive ScoreBadge). */
function BandTag({ band, score }: { band: string | null; score: number | null }) {
  if (!band) return null;
  const cls = band === 'Hot' ? 'bg-[#FFE4D6] text-[#9A3412] dark:bg-[#3A2418] dark:text-[#FFB08F]' : band === 'Warm' ? 'bg-warnBg text-warnText' : 'bg-surface2 text-text2';
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-semibold', cls)} title={score != null ? `Lead score ${score} out of 100` : undefined}>
      {band}{score != null && <span className="num font-medium opacity-80">· {score}</span>}
    </span>
  );
}

const Kbd = ({ children, className, onAccent }: { children: React.ReactNode; className?: string; onAccent?: boolean }) => (
  <kbd className={cx('inline-flex min-w-[22px] items-center justify-center rounded-chip border px-1.5 py-px font-sans text-[11px] font-semibold',
    onAccent ? 'border-transparent bg-white/20 text-white' : 'border-line2 bg-surface text-text2', className)}>{children}</kbd>
);

function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export function CallQueue() {
  const params = useSearchParams();
  return params.get('day') === 'tomorrow' ? <TomorrowList /> : <TodayQueue />;
}

function TodayQueue() {
  const s = useSession();
  const toast = useToast();
  const now = useNow();
  const today = indiaDay();
  const memKey = `stint-queue:${s.staff.id}:${today}`;
  const [items, setItems] = useState<Item[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [day, setDay] = useState<{ calls: number; connected: number } | null>(null);
  const [briefs, setBriefs] = useState<Record<string, Brief>>({});
  // where I am, kept in this tab so Live help and back keeps my place
  const mem = useMemo(() => { try { return JSON.parse(sessionStorage.getItem(memKey) || 'null') as { phase?: Phase; current?: string | null; skipped?: string[] } | null; } catch { return null; } }, [memKey]);
  const [phase, setPhase] = useState<Phase>(mem?.phase === 'calling' ? 'calling' : mem?.phase === 'paused' ? 'paused' : 'ready');
  const [current, setCurrent] = useState<string | null>(mem?.current ?? null);
  const [skipped, setSkipped] = useState<string[]>(mem?.skipped ?? []);
  useEffect(() => { try { sessionStorage.setItem(memKey, JSON.stringify({ phase, current, skipped })); } catch { /* storage blocked: place not kept */ } }, [memKey, phase, current, skipped]);

  const load = useCallback(async () => {
    const db = supabase();
    const [q, calls] = await Promise.all([
      db.rpc('my_call_queue'),
      db.from('call_log').select('outcome').eq('caller_id', s.staff.id).gte('called_at', indiaStart(indiaDay()).toISOString()).limit(1000),
    ]);
    if (q.error) { console.error('my_call_queue', q.error); setLoadErr(friendlyError(q.error, 'your calls', 'Could not load your calls. Please try again.')); return; }
    setLoadErr(null);
    setItems((q.data || []) as Item[]);
    if (!calls.error) { const o = (calls.data || []).map((r: { outcome: string }) => r.outcome); setDay({ calls: o.length, connected: o.filter((x) => !NOT_CONNECTED.includes(x)).length }); }
  }, [s.staff.id]);
  useEffect(() => { load(); const t = setInterval(load, 120000); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    supabase().from('ai_brief').select('body').eq('kind', 'call_brief').eq('staff_id', s.staff.id).eq('period_start', today).maybeSingle()
      .then(({ data }: { data: { body?: { items?: Brief[] } } | null }) => {
        const m: Record<string, Brief> = {};
        for (const it of data?.body?.items || []) if (it?.lead_id) m[it.lead_id] = it;
        setBriefs(m);
      }, () => {});
  }, [s.staff.id, today]);

  const pending = useMemo(() => {
    const open = (items || []).filter((i) => !i.done_today);
    const rank = (id: string) => { const k = skipped.indexOf(id); return k < 0 ? -1 : k; };
    return [...open].sort((a, b) => (rank(a.lead_id) - rank(b.lead_id)) || (a.pos - b.pos));
  }, [items, skipped]);
  const doneList = useMemo(() => (items || []).filter((i) => i.done_today), [items]);
  const total = (items || []).length;
  const cur = pending.find((i) => i.lead_id === current) || null;

  // keep "current" pointing at a lead that is still to call
  useEffect(() => {
    if (!items || phase !== 'calling') return;
    if (!cur) setCurrent(pending[0]?.lead_id ?? null);
  }, [items, phase, cur, pending]);

  const after = (id: string | null) => {
    const at = pending.findIndex((i) => i.lead_id === id);
    const rest = pending.filter((i) => i.lead_id !== id);
    if (!rest.length) return null;
    return (pending[at + 1] && pending[at + 1].lead_id !== id ? pending[at + 1] : rest[0]).lead_id;
  };
  const start = (id?: string) => { setCurrent(id ?? cur?.lead_id ?? pending[0]?.lead_id ?? null); setPhase('calling'); };
  const pause = () => setPhase('paused');
  const goNext = () => { if (!cur) return; const n = after(cur.lead_id); if (!n) { toast('This is the only lead left to call.'); return; } setCurrent(n); };
  const skip = () => {
    if (!cur) return;
    const n = after(cur.lead_id);
    setSkipped((k) => [...k.filter((x) => x !== cur.lead_id), cur.lead_id]);
    if (n) setCurrent(n); else toast('This is the only lead left to call.');
  };
  const saved = async (leadId: string) => {
    const n = after(leadId);
    await load();
    setSkipped((k) => k.filter((x) => x !== leadId));
    setCurrent(n);
  };

  const header = (
    <PageHeader group="Telecalling" title="Start my calls" scope="Today · India time"
      description="Your leads to call today, most urgent first. Call, pick what happened, and the next one opens."
      actions={items && pending.length > 0 ? (phase === 'calling'
        ? <Button variant="outline" size="lg" leftIcon={<Pause size={16} />} onClick={pause}>Pause <Kbd className="ml-1 max-md:hidden">Esc</Kbd></Button>
        : <Button variant="primary" size="lg" leftIcon={<Play size={16} />} onClick={() => start()} data-testid="queue-start">{phase === 'paused' ? 'Resume' : 'Start'}</Button>) : undefined} />
  );

  if (loadErr && !items) return (
    <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:px-6 md:py-4">{header}
      <div className="flex flex-wrap items-center gap-3"><Notice tone="bad">{loadErr}</Notice><Button variant="outline" size="lg" leftIcon={<RefreshCw size={15} />} onClick={load}>Try again</Button></div>
    </main>
  );
  if (!items) return (
    <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:px-6 md:py-4">{header}
      <div className="h-24 animate-pulse rounded-card bg-surface shadow-1" aria-hidden /><div className="h-64 animate-pulse rounded-card bg-surface shadow-1" aria-hidden />
      <span className="sr-only" role="status">Loading your calls…</span>
    </main>
  );

  const doneCount = doneList.length;
  const progress = (
    <section aria-label="Today so far" className="flex flex-col gap-2 rounded-card bg-surface px-4 py-3 shadow-1">
      <Meter label="Today’s list" value={doneCount} max={total} text={`${doneCount} of ${total} done today`} />
      <p className="text-xs text-muted">
        {day ? <>Your calls since midnight: <b className="num text-text2">{day.calls}</b> · picked up: <b className="num text-text2">{day.connected}</b></> : 'Counting your calls…'}
        {skipped.length > 0 && phase === 'calling' && <> · {skipped.length} skipped for later</>}
      </p>
    </section>
  );

  // Done for today (or nothing was due)
  if (pending.length === 0) return (
    <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:px-6 md:py-4">{header}
      {total > 0 && progress}
      <EmptyState kind="done"
        title={total > 0 ? `All done for today: ${day?.calls ?? doneCount} calls, ${day?.connected ?? 0} connected` : 'Nothing to call today'}
        body={total > 0 ? 'Connected means the person picked up (every outcome except No answer and Wrong number). Counted from your calls since midnight, India time.' : 'No follow-ups or next calls are due for your leads today, and no new leads are waiting.'} />
      <div className="flex justify-center"><Link href="/p/queue?day=tomorrow" className="btn inline-flex min-h-[44px] items-center gap-2 rounded-[10px] px-4 text-[13.5px] font-semibold text-accentText hover:bg-accentSoft"><CalendarClock size={16} aria-hidden />See tomorrow’s list</Link></div>
      {doneList.length > 0 && <QueueList title={`Done today (${doneList.length})`} items={doneList} now={now} />}
    </main>
  );

  if (phase !== 'calling' || !cur) {
    const late = pending.filter((i) => i.overdue && i.due_kind !== 'new_lead').length;
    const fresh = pending.filter((i) => i.due_kind === 'new_lead').length;
    const later = pending.length - late - fresh;
    return (
      <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:px-6 md:py-4">{header}
        {progress}
        {phase === 'paused' && cur && <Notice tone="warn">Paused. Your place is kept: next is {cur.full_name}. Press Resume when you are ready.</Notice>}
        <p className="text-[13px] text-text2" data-testid="queue-summary">
          <b className="text-text">{pending.length} to call today</b>
          {/* a breakdown of the same leads, so it reads "of them", never as extra calls */}
          {(() => { const parts = [late && `${late} overdue`, fresh && `${fresh} new ${fresh === 1 ? 'lead' : 'leads'} waiting`, later && `${later} due later today`].filter(Boolean) as string[];
            return parts.length ? <span>: {parts.length === 1 && parts[0] === `${pending.length} due later today` ? (pending.length === 1 ? 'due later today' : 'all due later today') : parts.join(' · ')}</span> : null; })()}
        </p>
        <QueueList title="In calling order" items={pending} now={now} onPick={start} skipped={skipped} />
        {doneList.length > 0 && <QueueList title={`Done today (${doneList.length})`} items={doneList} now={now} />}
      </main>
    );
  }

  return <Focus key={cur.lead_id} item={cur} index={pending.indexOf(cur)} left={pending.length} progress={progress} header={header} now={now}
    brief={briefs[cur.lead_id] || null} onSaved={saved} onNext={goNext} onSkip={skip} onPause={pause} />;
}

/** The day's list: in calling order, each row opens focus mode on that lead. */
function QueueList({ title, items, now, onPick, skipped = [] }: { title: string; items: Item[]; now: number; onPick?: (id: string) => void; skipped?: string[] }) {
  return (
    <section aria-label={title} className="rounded-card bg-surface shadow-1">
      <h2 className="px-4 pb-1 pt-3 text-[13px] font-semibold">{title}</h2>
      <ol>
        {items.map((it, n) => {
          const due = dueText(it, now);
          const body = (
            <>
              {onPick && <span className="num w-6 shrink-0 text-right text-xs text-muted">{n + 1}</span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-text">{it.full_name}</span>
                <span className="block truncate text-xs text-muted">{[it.stage, it.program, it.follow_up_title].filter(Boolean).join(' · ')}{skipped.includes(it.lead_id) && ' · skipped for later'}</span>
              </span>
              <BandTag band={it.band} score={it.score} />
              <span className={cx('w-[132px] shrink-0 text-right text-xs font-medium max-sm:w-auto', due.late ? 'text-badText' : 'text-text2')}>{due.text}</span>
            </>
          );
          const row = 'flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left';
          return (
            <li key={it.lead_id} className="border-t border-line">
              {onPick
                ? <button type="button" className={cx(row, 'hover:bg-surface2')} onClick={() => onPick(it.lead_id)} aria-label={`Start with ${it.full_name}, ${due.text}`}>{body}</button>
                : <Link href={`/p/lead?person=lead:${it.lead_id}`} className={cx(row, 'hover:bg-surface2')}>{body}</Link>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Focus({ item, index, left, progress, header, now, brief, onSaved, onNext, onSkip, onPause }: {
  item: Item; index: number; left: number; progress: React.ReactNode; header: React.ReactNode; now: number; brief: Brief | null;
  onSaved: (leadId: string) => Promise<void>; onNext: () => void; onSkip: () => void; onPause: () => void;
}) {
  const s = useSession();
  const toast = useToast();
  const outcomes = s.lists.call_outcome || [];
  const canLog = s.can('call', 'w');
  const canEditLead = s.can('lead', 'w');
  const canFollow = s.can('followups', 'w');
  const [lead, setLead] = useState<{ next_call_at: string | null; mobile_masked: string | null } | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [lock, setLock] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [lostReason, setLostReason] = useState(''); // asked when the outcome moves the lead to Not interested
  const [next, setNext] = useState<Next | null>(null);
  const [nextOpen, setNextOpen] = useState(false);
  const [callAt, setCallAt] = useState<number | null>(null);
  const [draftSecs, setDraftSecs] = useState(0);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { if (callAt == null) return; const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, [callAt]);
  const callSecs = callAt == null ? 0 : Math.max(0, Math.round((Date.now() - callAt) / 1000));
  void tick;

  useEffect(() => {
    let on = true;
    heading.current?.focus({ preventScroll: true });
    const db = supabase();
    Promise.all([
      db.from('lead_list').select('next_call_at, mobile_masked').eq('id', item.lead_id).maybeSingle(),
      db.rpc('person_timeline', { p_lead: item.lead_id, p_candidate: null }),
      contactStatus('lead', item.lead_id, true),
    ]).then(([l, tl, st]) => {
      if (!on) return;
      setLead((l.data as { next_call_at: string | null; mobile_masked: string | null } | null) || { next_call_at: null, mobile_masked: null });
      setLines(((tl.data || []) as Line[]).filter((x) => x.kind !== 'Stage' && x.kind !== 'Fee').slice(0, 2));
      setLock(st.allowed ? null : st.reason || 'Contact details are locked');
    });
    // back from Live help: fill the outcome and notes from its call summary (kept in this tab only)
    try {
      const k = 'stint-live-draft:' + item.lead_id;
      const d = JSON.parse(sessionStorage.getItem(k) || 'null') as { outcome?: string | null; body?: string; duration?: number } | null;
      if (d) {
        sessionStorage.removeItem(k);
        if (d.outcome && outcomes.includes(d.outcome)) pickOutcome(d.outcome);
        setNotes(d.body || ''); setDraftSecs(Number(d.duration || 0));
        setMsg({ tone: 'good', text: 'Filled in from Live help. Check what happened and the notes, then save.' });
      }
    } catch { /* storage blocked */ }
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.lead_id]);

  const pickOutcome = useCallback(async (o: string) => {
    setOutcome(o); setMsg(null);
    // the follow-up rule (Admin settings) suggests the next step; the caller can change or remove it
    const { data } = await supabase().rpc('suggest_follow_up', { p_trigger: 'Call: ' + o });
    const sug = data as { title?: string; due_at?: string; after?: string | null } | null;
    setNext(sug?.title && sug.due_at ? { title: sug.title, due: sug.due_at, note: sug.after ? `Suggested by the follow-up rule (${sug.after}).` : 'Suggested by the follow-up rule.' } : null);
    setNextOpen(false);
  }, []);

  const dial = async () => {
    if (lock) return;
    const v = await revealOnce('lead', item.lead_id, 'mobile');
    if (!v) { setMsg({ tone: 'bad', text: 'Could not get the number. ' + (lock || 'Please try again.') }); return; }
    setCallAt((t) => t ?? Date.now());
    window.location.href = 'tel:+91' + v.replace(/\D/g, '').slice(-10);
  };

  const save = async () => {
    if (busyRef.current) return;
    if (!canLog) return;
    if (!outcome) { setMsg({ tone: 'bad', text: 'Pick what happened first (keys 1 to ' + Math.min(9, outcomes.length) + ').' }); bar.current?.querySelector('button')?.focus(); return; }
    if (CALL_TO_STAGE[outcome] === 'Not interested' && item.stage !== 'Not interested' && canEditLead && !lostReason) {
      setMsg({ tone: 'bad', text: 'Pick why they are not interested.' }); document.querySelector<HTMLSelectElement>('[data-queue-lost]')?.focus(); return;
    }
    busyRef.current = true; setBusy(true);
    const db = supabase();
    const duration = callAt != null ? callSecs : draftSecs;
    const { error } = await db.from('call_log').insert({ lead_id: item.lead_id, caller_id: s.staff.id, outcome, notes: notes.trim() || null, duration_sec: duration });
    if (error) { busyRef.current = false; setBusy(false); setMsg({ tone: 'bad', text: friendlyError(error, 'this call') }); return; }
    const extra: string[] = [];
    const problems: string[] = [];
    // next follow-up first (so a move to Callback finds its next call set)
    if (next && canFollow) {
      const f = await db.from('follow_up').insert({ title: next.title.trim() || 'Call again', lead_id: item.lead_id, owner_id: s.staff.id, owner_role: s.staff.role, due_at: next.due, created_by: s.staff.id });
      if (f.error) problems.push('The next follow-up was not added: ' + friendlyError(f.error, 'the follow-up'));
      else extra.push('Next: ' + next.title + ', ' + fmtDateTime(next.due) + '.');
    }
    // the follow-up this call answered
    if (item.follow_up_id && item.follow_up_title && closesFollowUp(item.follow_up_title, outcome)) {
      const c = await db.from('follow_up').update({ status: 'Done' }).eq('id', item.follow_up_id);
      if (c.error) problems.push('“' + item.follow_up_title + '” is still open: ' + friendlyError(c.error, 'the follow-up'));
    }
    // a "next call" time that this call answered moves to the new follow-up (or is cleared)
    const stageTo = CALL_TO_STAGE[outcome];
    const endOfToday = indiaStart(indiaDay(1)).getTime();
    const ncDue = !!lead?.next_call_at && +new Date(lead.next_call_at) < endOfToday;
    if (canEditLead && (ncDue || (stageTo === 'Callback' && next))) {
      const u = await db.from('lead').update({ next_call_at: next ? next.due : null }).eq('id', item.lead_id);
      if (u.error) console.error('next_call_at', u.error);
    }
    if (stageTo && stageTo !== item.stage && canEditLead) {
      const up = await db.from('lead').update({ stage: stageTo, ...(stageTo === 'Not interested' ? { lost_reason: lostReason } : {}) }).eq('id', item.lead_id);
      if (!up.error) extra.push('Stage moved to ' + stageTo + '.');
      else problems.push(explainStageError(up.error, stageTo, s.staff.role).text);
    }
    toast(`Call logged: ${item.full_name}, ${outcome}. ${extra.join(' ')}`.trim());
    if (problems.length) toast(problems.join(' '), { tone: 'bad' });
    await onSaved(item.lead_id);
    busyRef.current = false; setBusy(false);
  };

  // keys: 1–9 outcome, Enter save, N next, S skip, C call, Esc pause. Not while typing (Enter in the notes saves).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('[role="dialog"], [role="menu"]')) return;
      const t = e.target as HTMLElement;
      const typing = !!t.closest('input, textarea, select, [contenteditable]');
      if (typing) {
        if (e.key === 'Enter' && !e.shiftKey && t.tagName === 'TEXTAREA' && t.dataset.queueNotes) { e.preventDefault(); save(); }
        else if (e.key === 'Escape') (t as HTMLElement).blur();
        return;
      }
      const ob = t.closest<HTMLElement>('[data-outcome]');
      if (e.key === 'Enter' && ob && canLog) { e.preventDefault(); if (ob.dataset.outcome === outcome) save(); else pickOutcome(ob.dataset.outcome || ''); return; }
      const k = e.key.toLowerCase();
      if (/^[1-9]$/.test(e.key) && canLog) { const o = outcomes[Number(e.key) - 1]; if (o) { e.preventDefault(); pickOutcome(o); } }
      else if (e.key === 'Enter' && !t.closest('button, a') && canLog) { e.preventDefault(); save(); }
      else if (k === 'n') { e.preventDefault(); onNext(); }
      else if (k === 's') { e.preventDefault(); onSkip(); }
      else if (k === 'c') { e.preventDefault(); dial(); }
      else if (e.key === 'Escape') { e.preventDefault(); onPause(); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });

  const due = dueText(item, now);
  const liveHref = `/live/${item.lead_id}?from=queue`;
  const leadHref = `/p/lead?person=lead:${item.lead_id}`;
  const focusBar = () => { bar.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); (bar.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') || bar.current?.querySelector<HTMLButtonElement>('button'))?.focus({ preventScroll: true }); };

  return (
    <main className={cx('flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:px-6 md:py-4', callAt != null && 'pb-28')}>
      {header}
      {progress}

      <article aria-label={'Now calling ' + item.full_name} className="mx-auto flex w-full max-w-3xl flex-col gap-4 rounded-card bg-surface p-4 shadow-1 md:p-6" data-testid="queue-focus">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="font-medium text-muted">Lead {index + 1} of {left} left</span>
          <span className={cx('inline-flex items-center gap-1 font-semibold', due.late ? 'text-badText' : 'text-text2')} data-testid="queue-due"><Clock size={13} aria-hidden />{due.text}</span>
          {item.follow_up_title && <span className="truncate text-text2">Follow-up: {item.follow_up_title}</span>}
        </div>

        <div className="flex flex-col gap-2">
          <h2 ref={heading} tabIndex={-1} className="text-[24px] font-semibold leading-tight outline-none md:text-[28px]" aria-live="polite">{item.full_name}</h2>
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-text2">
            <Pill>{item.stage}</Pill>
            {item.program && <span>{item.program}</span>}
            {item.score != null && <ScoreBadge score={item.score} band={item.band as Band | null} reasons={item.reasons} size="header" />}
            {item.best_label && <span className={cx('inline-flex items-center gap-1', item.in_window && 'font-semibold text-goodText')}><Clock size={13} aria-hidden />{item.best_label}{item.in_window && ' · good time now'}</span>}
          </div>
          {!!item.reasons?.length && (
            <ul aria-label="Why this lead" className="flex flex-wrap gap-1.5">
              {item.reasons.slice(0, 4).map((r) => <li key={r} className="rounded-full bg-surface2 px-2.5 py-1 text-xs text-text2">{r}</li>)}
            </ul>
          )}
        </div>

        {brief && (brief.last_time || brief.say_now) && (
          <div className="rounded-[10px] bg-surface2 px-3 py-2 text-[13px]">
            <div className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold text-accentText"><Sparkles size={13} aria-hidden />From today’s call brief (AI, check before you use it)</div>
            {brief.last_time && <p className="text-text2"><span className="font-medium text-muted">Last time: </span>{brief.last_time}</p>}
            {brief.say_now && <p className="text-text"><span className="font-medium text-muted">Say: </span>{brief.say_now}</p>}
          </div>
        )}

        <section aria-label="Last calls and notes">
          <h3 className="text-xs font-semibold text-muted">Last calls and notes</h3>
          {lines == null ? <p className="mt-1 text-[13px] text-muted">Loading…</p>
            : lines.length === 0 ? <p className="mt-1 text-[13px] text-text2">No calls or notes yet. This is the first contact.</p>
            : (
              <ul className="mt-1 flex flex-col gap-1">
                {lines.map((l, n) => (
                  <li key={n} className="text-[13px] leading-snug">
                    <span className="text-text">{l.body}</span>
                    <span className="ml-1.5 whitespace-nowrap text-xs text-muted">{[l.by_name, ago(l.at)].filter(Boolean).join(' · ')}</span>
                  </li>
                ))}
              </ul>
            )}
        </section>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="lg" leftIcon={<Phone size={16} />} onClick={dial} disabled={!!lock} title={lock || 'Call on this device'} data-testid="queue-call">
            Call <Kbd onAccent className="ml-1 max-md:hidden">C</Kbd>
          </Button>
          <Link href={liveHref} className="btn inline-flex h-11 items-center gap-2 rounded-[10px] border border-line2 bg-surface px-4 text-sm font-medium text-text hover:bg-surface2"><Sparkles size={16} aria-hidden />Live help</Link>
          <Link href={leadHref} className="btn inline-flex h-11 items-center gap-2 rounded-[10px] px-3 text-sm font-medium text-text2 hover:bg-surface2 hover:text-text"><ExternalLink size={16} aria-hidden />Open lead</Link>
          <span className="ml-auto text-[13px] max-sm:ml-0 max-sm:w-full">
            {lock ? <span className="text-muted">{lock}</span>
              : lead?.mobile_masked ? <span className="inline-flex items-center gap-1 text-text2">Number <Reveal kind="lead" id={item.lead_id} field="mobile" masked={lead.mobile_masked} label="mobile number" onRevealed={() => setCallAt((t) => t ?? Date.now())} /></span>
              : null}
          </span>
        </div>

        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

        {canLog ? (
          <div ref={bar} className="flex flex-col gap-2 rounded-xl border border-line2 bg-surface2 p-2" aria-label="What happened">
            <div className="px-1 text-xs font-semibold text-text2">What happened?</div>
            <div role="group" aria-label="Call outcome" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {outcomes.map((o, n) => (
                <button key={o} type="button" data-outcome={o} aria-pressed={outcome === o} onClick={() => pickOutcome(o)}
                  className={cx('btn flex min-h-[44px] items-center gap-2 rounded-[10px] border px-2.5 text-left text-[13px] font-medium md:min-h-[40px]',
                    outcome === o ? 'border-accent bg-accentSoft text-accentText' : 'border-line2 bg-surface text-text hover:bg-surface2')}>
                  {n < 9 && <Kbd className="max-md:hidden">{n + 1}</Kbd>}
                  <span className="min-w-0 flex-1 truncate">{o}</span>
                </button>
              ))}
            </div>
            {outcome && CALL_TO_STAGE[outcome] === 'Not interested' && item.stage !== 'Not interested' && canEditLead && (
              <label className="flex flex-col gap-1 text-[13px] font-medium text-text2">
                <span>Why not interested <span className="text-badText" aria-hidden>*</span></span>
                <select data-queue-lost="1" aria-required className="h-11 rounded-[10px] border border-line2 bg-surface px-2.5 text-sm md:h-10" value={lostReason} onChange={(e) => { setLostReason(e.target.value); setMsg(null); }}>
                  <option value="">Pick a reason</option>
                  {(s.lists.lost_reason || []).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
            )}
            <textarea data-queue-notes="1" aria-label="Call notes" placeholder="Notes (optional). Enter saves, Shift + Enter for a new line"
              className="min-h-[56px] rounded-[10px] border-line2 bg-surface px-3 py-2 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} />
            {outcome && (
              <div className="flex flex-col gap-1.5 rounded-[10px] bg-surface px-3 py-2 text-[13px]" data-testid="queue-next">
                {next ? (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">Next: {next.title}, {fmtDateTime(next.due)}</span>
                    <span className="text-xs text-muted">{next.note}</span>
                    <span className="ml-auto flex gap-1">
                      <Button size="sm" variant="quiet" onClick={() => setNextOpen((o) => !o)}>{nextOpen ? 'Done' : 'Change'}</Button>
                      <Button size="sm" variant="quiet" onClick={() => { setNext(null); setNextOpen(false); }}>No next call</Button>
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-text2">No next call.{item.due_kind !== 'new_lead' && ' This lead leaves your list unless something else is due.'}</span>
                    {canFollow && <Button size="sm" variant="quiet" className="ml-auto" onClick={() => { setNext({ title: 'Call again', due: new Date(Date.now() + 864e5).toISOString(), note: 'Added by you.' }); setNextOpen(true); }}>Add next call</Button>}
                  </div>
                )}
                {next && nextOpen && (
                  <div className="flex flex-col gap-2 pt-1">
                    <input aria-label="Next step" className="h-11 px-3 text-sm md:h-9" value={next.title} onChange={(e) => setNext({ ...next, title: e.target.value })} />
                    <QuickDate label="When" value={next.due} onChange={(iso) => iso && setNext({ ...next, due: iso, note: 'Changed by you.' })} />
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {(callAt != null || draftSecs > 0) && <span className="px-1 text-xs text-muted">Call time {fmtDuration(callAt != null ? callSecs : draftSecs)} (saved with the call)</span>}
              <Button variant="primary" size="lg" className="ml-auto max-sm:w-full" loading={busy} onClick={save} data-testid="queue-save">Save and next <Kbd onAccent className="ml-1 max-md:hidden">Enter</Kbd></Button>
            </div>
          </div>
        ) : (
          <Notice tone="warn">Your role can’t log calls, so this list can’t record what happened. You can still call, use Live help and move on. An Admin can allow it under Roles &amp; permissions (Call logs: edit).</Notice>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <Button variant="outline" size="lg" leftIcon={<StepForward size={16} />} onClick={onNext} title="Look at the next lead; this one keeps its place">Next <Kbd className="ml-1 max-md:hidden">N</Kbd></Button>
          <Button variant="outline" size="lg" leftIcon={<SkipForward size={16} />} onClick={onSkip} title="Call later: moves to the end of today’s list">Skip <Kbd className="ml-1 max-md:hidden">S</Kbd></Button>
          <Button variant="quiet" size="lg" leftIcon={<Pause size={16} />} onClick={onPause}>Pause <Kbd className="ml-1 max-md:hidden">Esc</Kbd></Button>
        </div>
        <p className="text-[11.5px] text-muted max-md:hidden">
          Keys: <Kbd>1</Kbd>–<Kbd>{Math.min(9, outcomes.length)}</Kbd> what happened · <Kbd>Enter</Kbd> save and next · <Kbd>C</Kbd> call · <Kbd>N</Kbd> next · <Kbd>S</Kbd> skip (goes to the end) · <Kbd>Esc</Kbd> pause. Keys do nothing while you type in a box, except Enter in the notes.
        </p>
      </article>

      {callAt != null && (
        <div role="region" aria-label="Call in progress" data-testid="queue-dock"
          className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-line bg-surface px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-2 md:inset-x-auto md:bottom-4 md:left-1/2 md:w-[min(640px,calc(100%-2rem))] md:-translate-x-1/2 md:rounded-card md:border md:pb-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{item.full_name}</span>
            <span className="num block text-xs text-text2" aria-live="off">On the call · {fmtDuration(callSecs)}</span>
          </span>
          <Link href={liveHref} className="btn inline-flex h-11 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-medium text-text2 hover:bg-surface2 md:h-9"><Sparkles size={15} aria-hidden /><span className="max-sm:sr-only">Live help</span></Link>
          {canLog && <Button variant="secondary" size="md" className="h-11 md:h-9" onClick={focusBar}>Log</Button>}
          <Button variant="outline" size="md" className="h-11 md:h-9" leftIcon={<StepForward size={15} />} onClick={onNext}>Next</Button>
        </div>
      )}
    </main>
  );
}

/** Tomorrow's list, to look ahead. Read only: calls open from each lead. */
function TomorrowList() {
  const now = useNow();
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const tomorrow = indiaDay(1);
  const load = useCallback(async () => {
    const { data, error } = await supabase().rpc('my_call_queue', { p_day: tomorrow });
    if (error) { console.error('my_call_queue tomorrow', error); setErr(friendlyError(error, 'the list', 'Could not load tomorrow’s list. Please try again.')); return; }
    setErr(null); setItems(((data || []) as Item[]).filter((i) => !i.done_today));
  }, [tomorrow]);
  useEffect(() => { load(); }, [load]);
  const label = indiaStart(tomorrow).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  return (
    <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:px-6 md:py-4">
      <PageHeader group="Telecalling" title="Tomorrow’s calls" scope={label}
        description="Leads due by the end of tomorrow, in calling order. Anything still open from today is included."
        actions={<Button variant="outline" size="lg" leftIcon={<ArrowLeft size={16} />} onClick={() => router.push('/p/queue')}>Back to today</Button>} />
      {err && <div className="flex flex-wrap items-center gap-3"><Notice tone="bad">{err}</Notice><Button variant="outline" size="lg" onClick={load}>Try again</Button></div>}
      {!items && !err && <div className="h-48 animate-pulse rounded-card bg-surface shadow-1" aria-hidden />}
      {items && items.length === 0 && <EmptyState kind="done" title="Nothing due tomorrow yet" body="Follow-ups and next calls you add for tomorrow will show here." />}
      {items && items.length > 0 && <QueueList title={`${items.length} to call`} items={items} now={now} />}
    </main>
  );
}
