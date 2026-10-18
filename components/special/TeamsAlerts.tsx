'use client';
import { plainMessage } from '@/lib/plainMessage';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Link2, RefreshCw, RotateCcw, Send, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { TEAMS_EVENTS, TEAMS_EVENT_LABEL, EVERYONE, teamsUrlProblem } from '@/lib/teams-events';
import { PageHeader } from '../kit/PageHeader';
import { EmptyState } from '../kit/EmptyState';
import { Confirm } from '../kit/Confirm';
import { Table, THead, TBody, Th, Td, Tr } from '../kit/Table';
import { Bone } from '../Skeletons';
import { Button, Notice, cx } from '../ui';
import { friendlyError } from '../Fields';
import { useToast } from '../Toasts';

// Admin: "Teams alerts". One Teams channel per role (or Everyone), which events each role hears, and what was sent.
// Tables: teams_channel / teams_rule / teams_message (migration 084). The link is a secret: the page keeps only its
// last 6 characters in memory and never shows it. Messages are sent by the background sender, never from here.

type Channel = { id: string; audience: string; name: string; tail: string; active: boolean };
type Msg = { id: string; event: string; audience: string; channel_id: string | null; person_name: string | null; status: 'Pending' | 'Sending' | 'Sent' | 'Failed'; attempts: number; last_error: string | null; created_at: string; sent_at: string | null };
type Last = { status: 'Sent' | 'Failed'; at: string; error: string | null };

const GROUPS = ['Students', 'Leads and sales', 'Money', 'For the owner'];
const who = (a: string) => (a === 'Admin' ? 'Admin (owner)' : a);
const defaultName = (a: string) => (a === EVERYONE ? 'Whole team' : `${a} team`);
const when = (v: string) => new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const mask = (tail: string) => `…/workflows/…${tail}`;
const ruleKey = (event: string, audience: string) => `${event}|${audience}`;
const field = 'h-11 w-full min-w-0 rounded-[10px] border border-line2 bg-surface px-3 text-[14px] md:h-9 md:text-[13.5px]';
const btn = 'h-11 md:h-9';

/** A failure from Teams, in words a founder can act on. */
function failText(e: string | null) {
  if (!e) return 'Teams did not accept it';
  if (/\b(400|401|403|404)\b/.test(e)) return 'Teams did not accept it — check the link';
  return plainMessage(e, 'Teams did not accept it');
}

const STATUS: Record<Msg['status'], { word: string; tone: string }> = {
  Pending: { word: 'Waiting to send', tone: 'bg-warnBg text-warnText' },
  Sending: { word: 'Sending', tone: 'bg-warnBg text-warnText' },
  Sent: { word: 'Sent', tone: 'bg-goodBg text-goodText' },
  Failed: { word: 'Failed', tone: 'bg-badBg text-badText' },
};
function StatusWord({ m }: { m: Msg }) {
  const s = STATUS[m.status] || { word: m.status, tone: 'bg-surface2 text-text2' };
  return <span className={cx('inline-block whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-semibold', s.tone)}>{s.word}{m.status === 'Failed' && m.attempts > 1 ? ` (${m.attempts} tries)` : ''}</span>;
}

function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <h2 className="text-[15px] font-semibold">{children}</h2>
      {aside}
    </div>
  );
}

export function TeamsAlerts() {
  const s = useSession();
  const toast = useToast();
  const canEdit = s.can('teams', 'w');
  const audiences = [...s.roles, EVERYONE];

  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [rules, setRules] = useState<Record<string, boolean>>({});
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [last, setLast] = useState<Record<string, Last>>({});
  const [refreshing, setRefreshing] = useState(false);

  // per-audience action state
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', link: '' });
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  // rule chips being saved (a ref so a fast double tap can't send two writes)
  const pending = useRef(new Set<string>());
  const [, bump] = useState(0);

  const loadMessages = useCallback(async () => {
    const db = supabase();
    const [m, l] = await Promise.all([
      db.from('teams_message').select('id,event,audience,channel_id,person_name,status,attempts,last_error,created_at,sent_at').order('created_at', { ascending: false }).limit(50),
      // newest finished message per channel, for "Last sent …" / "Last failed …"
      db.from('teams_message').select('channel_id,status,last_error,created_at,sent_at').in('status', ['Sent', 'Failed']).not('channel_id', 'is', null).order('created_at', { ascending: false }).limit(500),
    ]);
    if (m.error || l.error) return m.error || l.error;
    setMsgs((m.data || []) as Msg[]);
    const byChannel: Record<string, Last> = {};
    for (const r of (l.data || []) as Msg[]) {
      if (r.channel_id && !byChannel[r.channel_id]) byChannel[r.channel_id] = { status: r.status as Last['status'], at: r.sent_at || r.created_at, error: r.last_error };
    }
    setLast(byChannel);
    return null;
  }, []);

  const loadChannels = useCallback(async () => {
    const { data, error } = await supabase().from('teams_channel').select('id,audience,name,webhook_url_secret,active');
    if (error) return error;
    // keep only the last 6 characters of the secret link in memory
    setChannels((data || []).map((c: { id: string; audience: string; name: string; webhook_url_secret: string; active: boolean }) =>
      ({ id: c.id, audience: c.audience, name: c.name, tail: String(c.webhook_url_secret || '').slice(-6), active: c.active })));
    return null;
  }, []);

  const load = useCallback(async () => {
    setLoadErr('');
    const [c, r, m] = await Promise.all([
      loadChannels(),
      supabase().from('teams_rule').select('event,audience,active'),
      loadMessages(),
    ]);
    const err = c || r.error || m;
    if (err) { setLoadErr(friendlyError(err, 'Teams alerts')); setLoaded(true); return; }
    setRules(Object.fromEntries((r.data || []).map((x: { event: string; audience: string; active: boolean }) => [ruleKey(x.event, x.audience), !!x.active])));
    setLoaded(true);
  }, [loadChannels, loadMessages]);
  useEffect(() => { load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    const err = await loadMessages();
    setRefreshing(false);
    if (err) toast(friendlyError(err), { tone: 'bad' });
  };

  const byAudience = Object.fromEntries(channels.map((c) => [c.audience, c]));
  // a channel saved for a role that was later renamed or removed still shows, so it can be removed
  const rows = [...audiences, ...channels.map((c) => c.audience).filter((a) => !audiences.includes(a))];
  const live = (a: string) => !!byAudience[a]?.active;

  // ── Channels ────────────────────────────────────────────────────────────────
  const openForm = (a: string) => {
    setEditing(a); setFormErr(''); setJustSaved(null);
    setForm({ name: byAudience[a]?.name || defaultName(a), link: '' });
  };
  const save = async (a: string) => {
    const existing = byAudience[a];
    const name = form.name.trim() || defaultName(a);
    const link = form.link.trim();
    if (!existing && !link) { setFormErr('Paste the channel link from Teams.'); return; }
    if (link) { const p = teamsUrlProblem(link); if (p) { setFormErr(p); return; } }
    setSaving(true); setFormErr('');
    const db = supabase();
    const { error } = link
      ? await db.from('teams_channel').upsert({ audience: a, name, webhook_url_secret: link }, { onConflict: 'audience' })
      : await db.from('teams_channel').update({ name }).eq('id', existing!.id);
    if (error) { setSaving(false); setFormErr(friendlyError(error, 'Teams channels')); return; }
    await loadChannels();
    setSaving(false); setEditing(null); setForm({ name: '', link: '' });
    setJustSaved(a);
    toast(`Saved the ${who(a)} channel.`);
  };

  const sendTest = async (a: string) => {
    if (testing) return;
    setTesting(a);
    try {
      const res = await fetch('/api/teams/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audience: a }) });
      const body = await res.json().catch(() => ({} as { ok?: boolean; error?: string }));
      if (res.ok && body.ok) { toast(`Test card sent to ${byAudience[a]?.name || who(a)}. Check the channel in Teams.`); setJustSaved(null); }
      else {
        const fallback = res.status === 401 ? 'Please sign in again.' : res.status === 403 ? 'Only Admin can send a test.' : res.status === 404 ? 'Save a channel link for this role first.'
          : res.status === 429 ? 'Too many tests. Wait a minute and try again.' : res.status === 502 ? 'Teams did not accept the test. Check the link.' : 'The test could not be sent.';
        toast(plainMessage(body.error, fallback), { tone: 'bad' });
      }
    } catch {
      toast('Could not reach the CRM. Check the internet connection and try again.', { tone: 'bad' });
    }
    setTesting(null);
    loadMessages();
  };

  const setActive = async (c: Channel) => {
    if (switching) return;
    setSwitching(c.audience);
    const next = !c.active;
    setChannels((l) => l.map((x) => (x.id === c.id ? { ...x, active: next } : x)));
    const { error } = await supabase().from('teams_channel').update({ active: next }).eq('id', c.id);
    setSwitching(null);
    if (error) { setChannels((l) => l.map((x) => (x.id === c.id ? { ...x, active: c.active } : x))); toast(friendlyError(error, 'Teams channels'), { tone: 'bad' }); return; }
    toast(next ? `${c.name} is on.` : `${c.name} is off. Nothing is sent to it until you switch it back on.`);
  };

  const remove = async (c: Channel) => {
    setRemoving(c.audience);
    const { error } = await supabase().from('teams_channel').delete().eq('id', c.id);
    setRemoving(null);
    if (error) { toast(friendlyError(error, 'Teams channels'), { tone: 'bad' }); return; }
    if (editing === c.audience) setEditing(null);
    if (justSaved === c.audience) setJustSaved(null);
    toast(`Removed ${c.name}. It can be restored from the Recycle bin.`);
    await Promise.all([loadChannels(), loadMessages()]);
  };

  // ── Who hears what ──────────────────────────────────────────────────────────
  const toggleRule = async (event: string, audience: string) => {
    const k = ruleKey(event, audience);
    if (pending.current.has(k)) return;
    pending.current.add(k); bump((n) => n + 1);
    const was = !!rules[k];
    setRules((r) => ({ ...r, [k]: !was }));
    const { error } = await supabase().from('teams_rule').upsert({ event, audience, active: !was }, { onConflict: 'event,audience' });
    pending.current.delete(k); bump((n) => n + 1);
    if (error) {
      setRules((r) => ({ ...r, [k]: was }));
      toast(`Could not change “${TEAMS_EVENT_LABEL[event] || event}” for ${who(audience)}. ${friendlyError(error, 'Teams alerts')}`, { tone: 'bad' });
    }
  };

  // ── Recent messages ─────────────────────────────────────────────────────────
  const retry = async (m: Msg) => {
    if (retrying) return;
    setRetrying(m.id);
    const { data, error } = await supabase().from('teams_message')
      .update({ status: 'Pending', attempts: 0, next_try_at: new Date().toISOString(), last_error: null })
      .eq('id', m.id).eq('status', 'Failed').select('id');
    setRetrying(null);
    if (error) { toast(friendlyError(error, 'Teams messages'), { tone: 'bad' }); return; }
    if (!data?.length) { toast('This message is already being sent again.'); loadMessages(); return; }
    setMsgs((l) => l.map((x) => (x.id === m.id ? { ...x, status: 'Pending', attempts: 0, last_error: null } : x)));
    toast('Queued again. It goes out within a minute.');
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const header = (
    <>
      <PageHeader title="Teams alerts" group="Admin settings"
        description="Post CRM news to Microsoft Teams. Give each role its own channel, then choose what each role hears about." />
      <details className="group rounded-[12px] bg-surface shadow-1" data-testid="teams-howto">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3 text-[13.5px] font-medium text-accentText [&::-webkit-details-marker]:hidden">
          <Link2 size={16} aria-hidden />
          <span className="flex-1">How to get a channel link</span>
          <ChevronDown size={18} aria-hidden className="text-muted transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="border-t border-line px-3 pb-3 pt-2 text-[13.5px]">
          <ol className="list-decimal space-y-1 pl-5 text-text2">
            <li>In Teams, open the channel.</li>
            <li>Click <b className="text-text">⋯</b> (More options) → <b className="text-text">Workflows</b>.</li>
            <li>Choose <b className="text-text">“Post to a channel when a webhook request is received”</b>.</li>
            <li>Give it a name, then <b className="text-text">Next</b> → <b className="text-text">Add workflow</b>.</li>
            <li>Copy the link it shows, and paste it here.</li>
          </ol>
          <p className="mt-2 text-[12.5px] text-muted">Anyone with the link can post to that channel. Keep it private; only Admin can see links here.</p>
        </div>
      </details>
    </>
  );

  if (!loaded) {
    return (
      <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:px-6 md:py-4" aria-busy="true">
        {header}
        <span className="sr-only" role="status">Loading…</span>
        <div className="flex flex-col gap-2 rounded-[14px] bg-surface p-4 shadow-1">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="flex items-center gap-3"><Bone className="h-4 w-32" /><Bone className="h-4 flex-1" /><Bone className="h-8 w-24" /></div>)}
        </div>
        <div className="flex flex-col gap-2 rounded-[14px] bg-surface p-4 shadow-1">
          {[0, 1, 2].map((i) => <Bone key={i} className="h-10 w-full" />)}
        </div>
      </main>
    );
  }

  if (loadErr) {
    return (
      <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:px-6 md:py-4">
        {header}
        <div className="flex flex-col items-start gap-3 rounded-[14px] bg-surface p-4 shadow-1">
          <Notice tone="bad">Could not load Teams alerts. {loadErr}</Notice>
          <Button variant="primary" className={btn} onClick={() => { setLoaded(false); load(); }}>Try again</Button>
        </div>
      </main>
    );
  }

  const connected = channels.filter((c) => c.active).length;

  return (
    <main className="flex flex-1 flex-col gap-5 overflow-y-auto p-4 md:px-6 md:py-4">
      {header}
      {!canEdit && <Notice tone="warn">View only. Only Admin can add channels or change who hears what.</Notice>}

      {/* 1. Channels */}
      <section aria-labelledby="teams-channels" className="flex flex-col gap-2" data-testid="teams-channels">
        <SectionTitle aside={<span className="text-[12.5px] text-muted">{connected} of {rows.length} connected</span>}>
          <span id="teams-channels">Channels</span>
        </SectionTitle>
        <p className="-mt-1 text-[12.5px] text-muted">Nothing is sent to a role until you add its channel.</p>
        <ul className="flex flex-col rounded-[14px] bg-surface shadow-1" aria-label="Teams channels by role">
          {rows.map((a) => {
            const c = byAudience[a];
            const res = c ? last[c.id] : undefined;
            const state = !c ? 'No channel yet' : c.active ? 'Connected' : 'Switched off';
            const stateTone = !c ? 'bg-surface2 text-text2' : c.active ? 'bg-goodBg text-goodText' : 'bg-warnBg text-warnText';
            const isEditing = editing === a;
            const errId = `teams-link-err-${a.replace(/\W+/g, '-')}`;
            return (
              <li key={a} data-audience={a} className="flex flex-col gap-2 border-b border-line px-3 py-3 last:border-b-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1 basis-[240px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold">{who(a)}</span>
                      <span className={cx('rounded-full px-2 py-[2px] text-[11.5px] font-semibold', stateTone)} data-testid="teams-channel-state">{state}</span>
                      {!audiences.includes(a) && <span className="text-[12px] text-muted">(role no longer exists)</span>}
                    </div>
                    {c && (
                      <div className="mt-0.5 text-[12.5px] text-text2">
                        <span className="break-words">{c.name}</span>
                        <span className="mx-1.5 text-muted" aria-hidden>·</span>
                        <span className="font-mono text-[12px] text-muted" title="Only the end of the link is shown">{mask(c.tail)}</span>
                      </div>
                    )}
                    {c && (
                      <div className={cx('mt-0.5 text-[12.5px]', res?.status === 'Failed' ? 'text-badText' : 'text-muted')} data-testid="teams-last-result">
                        {!res ? 'Nothing sent yet' : res.status === 'Sent' ? `Last sent ${when(res.at)}` : `Last failed: ${failText(res.error)}`}
                      </div>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {c && (
                        <button type="button" role="switch" aria-checked={c.active} aria-label={`${who(a)} channel on or off`} disabled={switching === a} onClick={() => setActive(c)}
                          className="flex h-11 items-center gap-2 rounded-[10px] px-1.5 text-[12.5px] font-medium text-text2 hover:bg-surface2 disabled:opacity-50 md:h-9">
                          <span className={cx('relative block h-6 w-11 shrink-0 rounded-full transition-colors duration-150 motion-reduce:transition-none', c.active ? 'bg-accent' : 'bg-line2')}>
                            <span className={cx('absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-150 motion-reduce:transition-none', c.active ? 'translate-x-[22px]' : 'translate-x-0.5')} />
                          </span>
                          <span className="w-6">{c.active ? 'On' : 'Off'}</span>
                        </button>
                      )}
                      {c && (
                        <Button size="sm" variant="outline" className={btn} leftIcon={<Send size={14} />} loading={testing === a} disabled={!!testing && testing !== a} onClick={() => sendTest(a)}>
                          Send test
                        </Button>
                      )}
                      {!isEditing && (
                        <Button size="sm" variant={c ? 'quiet' : 'secondary'} className={btn} onClick={() => openForm(a)}>{c ? 'Change link' : 'Add channel'}</Button>
                      )}
                      {c && (
                        <Confirm title={`Remove the ${who(a)} channel?`} yes="Remove" onYes={() => remove(c)} disabled={removing === a} ariaLabel={`Remove the ${who(a)} channel`}
                          body="Nothing more is sent to it. Its past messages stay in the list below, and the channel can be restored from the Recycle bin."
                          className="inline-flex h-11 items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] font-medium text-badText hover:bg-badBg disabled:opacity-50 md:h-9">
                          <Trash2 size={14} aria-hidden />{removing === a ? 'Removing…' : 'Remove'}
                        </Confirm>
                      )}
                    </div>
                  )}
                </div>

                {justSaved === a && c && !isEditing && (
                  <div className="flex flex-wrap items-center gap-2 rounded-[10px] bg-goodBg px-3 py-2 text-[13px] text-goodText" role="status">
                    <Check size={16} aria-hidden />
                    <span className="min-w-0 flex-1">Saved. Send a test card to check it reaches the channel.</span>
                    <Button size="sm" variant="primary" className={btn} leftIcon={<Send size={14} />} loading={testing === a} disabled={!!testing && testing !== a} onClick={() => sendTest(a)}>Send test</Button>
                    <Button size="sm" variant="quiet" className={btn} onClick={() => setJustSaved(null)}>Later</Button>
                  </div>
                )}

                {isEditing && (
                  <form className="flex flex-col gap-3 rounded-[12px] border border-line bg-bg p-3" aria-label={`${c ? 'Change' : 'Add'} the ${who(a)} channel`}
                    onSubmit={(e) => { e.preventDefault(); save(a); }}>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
                      <label className="flex min-w-0 flex-col gap-1 text-[13px] font-medium">Channel name
                        <input className={field} value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                      </label>
                      <label className="flex min-w-0 flex-col gap-1 text-[13px] font-medium">Channel link from Teams
                        <input className={cx(field, formErr && 'border-badText')} value={form.link} type="url" inputMode="url" autoComplete="off" spellCheck={false} autoFocus
                          placeholder={c ? 'Leave empty to keep the current link' : 'https://…'} aria-invalid={!!formErr || undefined} aria-describedby={formErr ? errId : undefined}
                          onChange={(e) => { setForm({ ...form, link: e.target.value }); if (formErr) setFormErr(''); }} />
                      </label>
                    </div>
                    {formErr && <p id={errId} role="alert" className="text-[12.5px] font-medium text-badText">{formErr}</p>}
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" variant="primary" className={btn} loading={saving}>Save</Button>
                      <Button variant="outline" className={btn} disabled={saving} onClick={() => { setEditing(null); setFormErr(''); }}>Cancel</Button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* 2. Who hears what */}
      <section aria-labelledby="teams-rules" className="flex flex-col gap-2" data-testid="teams-rules">
        <SectionTitle><span id="teams-rules">Who hears what</span></SectionTitle>
        <p className="text-[12.5px] text-text2">Tap a role to switch it on or off for that news. Roles shown faded have no channel yet, so nothing is sent to them.</p>
        <div className="flex flex-col gap-4">
          {GROUPS.map((g) => {
            const events = TEAMS_EVENTS.filter((e) => e.group === g);
            if (!events.length) return null;
            return (
              <div key={g} className="flex flex-col">
                <h3 className="pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{g}</h3>
                <ul className="flex flex-col rounded-[14px] bg-surface shadow-1" aria-label={g}>
                  {events.map((ev) => {
                    const heard = audiences.filter((a) => rules[ruleKey(ev.event, a)] && live(a)).length;
                    return (
                      <li key={ev.event} data-event={ev.event} className="flex flex-col gap-2 border-b border-line px-3 py-3 last:border-b-0 lg:flex-row lg:items-start lg:gap-4">
                        <div className="min-w-0 lg:w-[260px] lg:shrink-0">
                          <div className="text-[14px] font-semibold">{ev.label}</div>
                          <div className="text-[12.5px] text-text2">{ev.about}</div>
                          <div className="mt-0.5 text-[12px] text-muted">{heard === 0 ? 'Not sent to any channel' : `Sent to ${heard} channel${heard === 1 ? '' : 's'}`}</div>
                        </div>
                        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5" role="group" aria-label={`Who hears “${ev.label}”`}>
                          {audiences.map((a) => {
                            const k = ruleKey(ev.event, a);
                            const on = !!rules[k];
                            const busy = pending.current.has(k);
                            const noChannel = !live(a);
                            return (
                              <button key={a} type="button" aria-pressed={on} disabled={!canEdit} aria-busy={busy || undefined}
                                title={noChannel ? 'No channel for this role yet — nothing is sent' : undefined}
                                onClick={() => toggleRule(ev.event, a)}
                                className={cx('inline-flex h-11 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors duration-150 motion-reduce:transition-none md:h-8 md:text-[12.5px]',
                                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default',
                                  on ? 'border-accent bg-accentSoft font-semibold text-accentText' : 'border-line2 bg-surface font-medium text-text2 hover:bg-surface2',
                                  noChannel && 'opacity-55', busy && 'cursor-wait')}>
                                {on ? <Check size={14} strokeWidth={2.5} aria-hidden /> : <span aria-hidden className="h-3.5 w-3.5 rounded-full border border-line2" />}
                                {who(a)}
                                {noChannel && <span className="sr-only"> (no channel yet, nothing is sent)</span>}
                              </button>
                            );
                          })}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. Recent messages */}
      <section aria-labelledby="teams-log" className="flex flex-col gap-2" data-testid="teams-log">
        <SectionTitle aside={<Button size="sm" variant="outline" className={btn} leftIcon={<RefreshCw size={14} />} loading={refreshing} onClick={refresh}>Refresh</Button>}>
          <span id="teams-log">Recent messages</span>
        </SectionTitle>
        <p className="text-[12.5px] text-text2">Messages go out within a minute. Failed ones retry by themselves up to five times.</p>
        {msgs.length === 0 ? (
          <EmptyState title="Nothing sent yet" body="Add a channel, then a new student, fee or alert will show up here." />
        ) : (
          <>
            <ul className="flex flex-col gap-2 md:hidden" aria-label="Recent Teams messages">
              {msgs.map((m) => (
                <li key={m.id} data-testid="teams-msg" className="rounded-[12px] bg-surface p-3 shadow-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium">{TEAMS_EVENT_LABEL[m.event] || m.event}{m.person_name ? <span className="font-normal text-text2"> · {m.person_name}</span> : null}</div>
                      <div className="text-[12.5px] text-muted">{who(m.audience)} · {when(m.created_at)}</div>
                    </div>
                    <StatusWord m={m} />
                  </div>
                  {m.status === 'Failed' && <div className="mt-1 break-words text-[12.5px] text-badText">{failText(m.last_error)}</div>}
                  {m.status === 'Failed' && canEdit && (
                    <Button size="sm" variant="outline" className="mt-2 h-11" leftIcon={<RotateCcw size={14} />} loading={retrying === m.id} onClick={() => retry(m)}>Retry</Button>
                  )}
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table label="Recent Teams messages">
                <THead><Th>When</Th><Th>News</Th><Th>About</Th><Th>Channel</Th><Th>Status</Th><Th className="w-28" /></THead>
                <TBody>
                  {msgs.map((m) => (
                    <Tr key={m.id} data-testid="teams-msg">
                      <Td className="whitespace-nowrap text-text2">{when(m.created_at)}</Td>
                      <Td className="font-medium">{TEAMS_EVENT_LABEL[m.event] || m.event}</Td>
                      <Td className="max-w-[200px] truncate text-text2" title={m.person_name || undefined}>{m.person_name || '—'}</Td>
                      <Td className="whitespace-nowrap text-text2">{who(m.audience)}</Td>
                      <Td>
                        <div className="py-1.5">
                          <StatusWord m={m} />
                          {m.status === 'Failed' && <div className="mt-1 max-w-[320px] break-words text-[12px] text-badText">{failText(m.last_error)}</div>}
                          {m.status === 'Sent' && m.sent_at && <div className="mt-0.5 text-[12px] text-muted">{when(m.sent_at)}</div>}
                        </div>
                      </Td>
                      <Td>
                        {m.status === 'Failed' && canEdit && (
                          <Button size="sm" variant="outline" leftIcon={<RotateCcw size={14} />} loading={retrying === m.id} onClick={() => retry(m)}>Retry</Button>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
