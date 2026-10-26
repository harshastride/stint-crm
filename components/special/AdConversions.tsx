'use client';
import { plainMessage } from '@/lib/plainMessage';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Copy, KeyRound, Pencil, Plus, RefreshCw, RotateCcw, Send, SkipForward, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { PageHeader } from '../kit/PageHeader';
import { EmptyState } from '../kit/EmptyState';
import { Confirm } from '../kit/Confirm';
import { Table, THead, TBody, Th, Td, Tr } from '../kit/Table';
import { Bone } from '../Skeletons';
import { Button, ButtonGroup, Notice, cx, money } from '../ui';
import { friendlyError } from '../Fields';
import { useToast } from '../Toasts';

// Marketing: "Ad conversions". Tell Meta and Google which leads became students and paid, so their ads find more
// people like them. Tables: ad_settings / ad_conversion_rule / ad_conversion (migration 20261004000101).
// Secrets (Meta access token, Google feed password) are never readable here: they are only set through
// POST /api/ads/settings. Everything else is edited directly; row security allows it only for ads 'w' (Admin).
// The queue is filled by database triggers, never from this page; the page only offers Retry / Skip on a row.

type Settings = {
  meta_enabled: boolean; meta_dataset_id: string | null; meta_test_event_code: string | null; meta_token_set: boolean;
  google_enabled: boolean; google_feed_user: string; google_password_set: boolean; google_feed_days: number; last_feed_at: string | null;
};
type Platform = 'meta' | 'google';
type Trigger = 'arrived' | 'stage' | 'paid';
type Rule = { id: string; platform: Platform; trigger: Trigger; stage: string | null; event_name: string; send_value: boolean; active: boolean; sort: number };
type Status = 'Queued' | 'Sending' | 'Sent' | 'Failed' | 'Skipped';
type Conv = { id: string; lead_id: string; platform: Platform; event_name: string; event_time: string; value: number | null; status: Status; attempts: number; last_error: string | null; sent_at: string | null; created_at: string };
type Draft = { id?: string; platform: Platform; trigger: Trigger; stage: string; event_name: string; send_value: boolean };

const SETTINGS_COLS = 'meta_enabled,meta_dataset_id,meta_test_event_code,meta_token_set,google_enabled,google_feed_user,google_password_set,google_feed_days,last_feed_at';
const PLATFORM: Record<Platform, string> = { meta: 'Meta (Facebook, Instagram)', google: 'Google Ads' };
const SHORT: Record<Platform, string> = { meta: 'Meta', google: 'Google' };
// Meta's own event names (fixed by Meta, not a CRM list): https://developers.facebook.com/docs/meta-pixel/reference
const META_EVENTS = ['Lead', 'Contact', 'Schedule', 'SubmitApplication', 'CompleteRegistration', 'StartTrial', 'Subscribe', 'Purchase'];
const FEED_DAYS = [7, 14, 30, 60, 90];
const LOG_FILTERS: { label: string; status: Status | null }[] = [
  { label: 'All', status: null }, { label: 'Waiting', status: 'Queued' }, { label: 'Failed', status: 'Failed' }, { label: 'Sent', status: 'Sent' }, { label: 'Skipped', status: 'Skipped' },
];

const when = (v: string) => new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const field = 'h-11 w-full min-w-0 rounded-[10px] border border-line2 bg-surface px-3 text-[14px] md:h-9 md:text-[13.5px]';
const btn = 'h-11 md:h-9';
const clean = (v: string | null | undefined) => (v || '').trim();

const momentText = (r: { trigger: Trigger; stage: string | null }) =>
  r.trigger === 'arrived' ? 'A lead arrives' : r.trigger === 'paid' ? 'First fee is received' : `Lead moves to ${r.stage || '—'}`;

function statusLook(c: Conv): { word: string; tone: string } {
  if (c.status === 'Queued') return { word: c.platform === 'google' ? 'Waiting for Google' : 'Waiting to send', tone: 'bg-warnBg text-warnText' };
  if (c.status === 'Sending') return { word: 'Sending', tone: 'bg-warnBg text-warnText' };
  if (c.status === 'Sent') return { word: c.platform === 'google' ? 'Read by Google' : 'Sent', tone: 'bg-goodBg text-goodText' };
  if (c.status === 'Failed') return { word: c.attempts > 1 ? `Failed (${c.attempts} tries)` : 'Failed', tone: 'bg-badBg text-badText' };
  return { word: 'Skipped', tone: 'bg-surface2 text-text2' };
}
function StatusWord({ c }: { c: Conv }) {
  const s = statusLook(c);
  return <span className={cx('inline-block whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-semibold', s.tone)}>{s.word}</span>;
}

/** POST to /api/ads/*; a plain sentence on failure. */
async function callApi(url: string, body: unknown): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    if (res.ok && data.ok) return { ok: true, message: typeof data.message === 'string' ? data.message : '' };
    const fallback = res.status === 401 ? 'Please sign in again.' : res.status === 403 ? 'Only Admin can change this.' : res.status === 404 ? 'This part of the CRM is not ready yet. Try again later.'
      : res.status === 429 ? 'Too many tries. Wait a minute and try again.' : 'That did not work. Please try again.';
    return { ok: false, message: plainMessage(data.message || data.error, fallback) };
  } catch {
    return { ok: false, message: 'Could not reach the CRM. Check the internet connection and try again.' };
  }
}

/** A password Google can be given: 24 letters and digits, made in this browser. */
function makePassword() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const a = new Uint32Array(24); crypto.getRandomValues(a);
  return Array.from(a, (n) => abc[n % abc.length]).join('');
}

function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="min-w-0 text-[15px] font-semibold">{children}</h2>
      {aside}
    </div>
  );
}

function Switch({ on, label, disabled, onClick }: { on: boolean; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick}
      className="flex h-11 shrink-0 items-center gap-2 rounded-[10px] px-1.5 text-[12.5px] font-medium text-text2 hover:bg-surface2 disabled:cursor-default disabled:opacity-50 md:h-9">
      <span className={cx('relative block h-6 w-11 shrink-0 rounded-full transition-colors duration-150 motion-reduce:transition-none', on ? 'bg-accent' : 'bg-line2')}>
        <span className={cx('absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-150 motion-reduce:transition-none', on ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </span>
      <span className="w-6">{on ? 'On' : 'Off'}</span>
    </button>
  );
}

function Steps({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <details className="group rounded-[12px] border border-line bg-bg" data-testid={id}>
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3 text-[13.5px] font-medium text-accentText md:min-h-[36px] [&::-webkit-details-marker]:hidden">
        <span className="flex-1">{label}</span>
        <ChevronDown size={18} aria-hidden className="text-muted transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <ol className="list-decimal space-y-1.5 border-t border-line pb-3 pl-8 pr-3 pt-2 text-[13.5px] text-text2">{children}</ol>
    </details>
  );
}

/** One label + value line for the read-only view and for saved secrets. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[32px] flex-wrap items-center gap-x-2 text-[13.5px]">
      <span className="w-[150px] shrink-0 text-text2">{label}</span>
      <span className="min-w-0 break-words font-medium">{children}</span>
    </div>
  );
}

/** Write-only secret: shows only whether it is saved; Set / Replace / Remove go through /api/ads/settings. */
function Secret({ label, name, isSet, canEdit, onSaved, generate, hint }: {
  label: string; name: 'meta_capi_token' | 'google_feed_password'; isSet: boolean; canEdit: boolean; onSaved: () => Promise<void>; generate?: boolean; hint?: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const errId = `ads-${name}-err`;
  const save = async (v: string) => {
    if (busy) return;
    if (v && v.trim().length < 8) { setErr('That looks too short. Paste the whole value.'); return; }
    setBusy(true); setErr('');
    const r = await callApi('/api/ads/settings', { [name]: v.trim() });
    setBusy(false);
    if (!r.ok) { setErr(r.message); return; }
    await onSaved();
    setOpen(false); setVal(''); setShow(false);
    toast(v ? `${label} saved.${generate ? ' Paste the same password in Google Ads.' : ''}` : `${label} removed.`);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-h-[32px] flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px]">
        <span className="w-[150px] shrink-0 text-text2">{label}</span>
        {isSet ? <span className="inline-flex items-center gap-1.5 font-medium text-goodText"><Check size={14} aria-hidden />Saved <span className="font-normal text-muted">(never shown)</span></span>
          : <span className="font-medium text-warnText">Not set</span>}
        {canEdit && !open && (
          <span className="flex flex-wrap gap-1">
            <Button size="sm" variant={isSet ? 'quiet' : 'secondary'} className={btn} leftIcon={<KeyRound size={14} />} onClick={() => { setOpen(true); setErr(''); }}>{isSet ? 'Replace' : 'Set'}</Button>
            {isSet && (
              <Confirm title={`Remove the ${label.toLowerCase()}?`} yes="Remove" onYes={() => save('')} disabled={busy} ariaLabel={`Remove the ${label.toLowerCase()}`}
                body="Nothing more can be sent until a new one is saved."
                className="inline-flex h-11 items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] font-medium text-badText hover:bg-badBg disabled:opacity-50 md:h-9">
                <Trash2 size={14} aria-hidden />Remove
              </Confirm>
            )}
          </span>
        )}
      </div>
      {open && (
        <form className="flex flex-col gap-2 rounded-[12px] border border-line bg-bg p-3" aria-label={`${isSet ? 'Replace' : 'Set'} the ${label.toLowerCase()}`}
          onSubmit={(e) => { e.preventDefault(); if (!val.trim()) { setErr(`Paste the ${label.toLowerCase()} first.`); return; } save(val); }}>
          <label className="flex min-w-0 flex-col gap-1 text-[13px] font-medium">{label}
            <input className={cx(field, 'font-mono', err && 'border-badText')} type={show ? 'text' : 'password'} value={val} autoComplete="new-password" spellCheck={false} autoFocus maxLength={500}
              aria-invalid={!!err || undefined} aria-describedby={err ? errId : undefined} onChange={(e) => { setVal(e.target.value); if (err) setErr(''); }} />
          </label>
          {hint && <p className="text-[12px] text-muted">{hint}</p>}
          {err && <p id={errId} role="alert" className="text-[12.5px] font-medium text-badText">{err}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" className={btn} loading={busy}>Save</Button>
            {generate && <Button variant="outline" className={btn} disabled={busy} onClick={() => { setVal(makePassword()); setShow(true); setErr(''); }}>Make one for me</Button>}
            {generate && show && val && (
              <Button variant="outline" className={btn} leftIcon={<Copy size={14} />} disabled={busy}
                onClick={async () => { try { await navigator.clipboard.writeText(val); toast('Password copied. Paste it in Google Ads too.'); } catch { toast('Could not copy. Select it and copy by hand.', { tone: 'bad' }); } }}>Copy</Button>
            )}
            <Button variant="outline" className={btn} disabled={busy} onClick={() => { setOpen(false); setVal(''); setShow(false); setErr(''); }}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function AdConversions() {
  const s = useSession();
  const toast = useToast();
  const canEdit = s.can('ads', 'w');
  const stages = s.lists.lead_stage || [];

  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const [set, setSet] = useState<Settings | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [log, setLog] = useState<Conv[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [counts, setCounts] = useState({ waitMeta: 0, waitGoogle: 0, failed: 0, lastSent: null as string | null });
  const [filter, setFilter] = useState<Status | null>(null);
  // only platforms that are switched on will ever send what is waiting
  const waiting = (set?.meta_enabled ? counts.waitMeta : 0) + (set?.google_enabled ? counts.waitGoogle : 0);
  const [refreshing, setRefreshing] = useState(false);
  const [origin, setOrigin] = useState('');
  useEffect(() => { setOrigin(window.location.origin); }, []);

  // editable copies of the non-secret settings
  const [meta, setMeta] = useState({ dataset: '', test: '' });
  const [google, setGoogle] = useState({ user: '', days: 60 });
  const [savingMeta, setSavingMeta] = useState(false);
  const [savingGoogle, setSavingGoogle] = useState(false);
  const [switching, setSwitching] = useState<Platform | null>(null);
  const [testing, setTesting] = useState<Platform | null>(null);
  const [testResult, setTestResult] = useState<Record<Platform, { ok: boolean; text: string } | null>>({ meta: null, google: null });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftErr, setDraftErr] = useState('');
  const [savingRule, setSavingRule] = useState(false);
  const [ruleBusy, setRuleBusy] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    const { data, error } = await supabase().from('ad_settings').select(SETTINGS_COLS).eq('id', 1).maybeSingle();
    if (error) return error;
    const v = data as Settings | null;
    setSet(v);
    if (v) { setMeta({ dataset: v.meta_dataset_id || '', test: v.meta_test_event_code || '' }); setGoogle({ user: v.google_feed_user || '', days: v.google_feed_days || 60 }); }
    return null;
  }, []);

  const loadRules = useCallback(async () => {
    const { data, error } = await supabase().from('ad_conversion_rule').select('id,platform,trigger,stage,event_name,send_value,active,sort').order('sort').order('created_at');
    if (error) return error;
    setRules((data || []) as Rule[]);
    return null;
  }, []);

  const loadLog = useCallback(async (st: Status | null) => {
    const db = supabase();
    let q = db.from('ad_conversion').select('id,lead_id,platform,event_name,event_time,value,status,attempts,last_error,sent_at,created_at').order('created_at', { ascending: false }).limit(50);
    if (st) q = q.eq('status', st);
    const [l, w, wg, f, ls] = await Promise.all([
      q,
      db.from('ad_conversion').select('id', { count: 'exact', head: true }).eq('status', 'Queued').eq('platform', 'meta'),
      db.from('ad_conversion').select('id', { count: 'exact', head: true }).eq('status', 'Queued').eq('platform', 'google'),
      db.from('ad_conversion').select('id', { count: 'exact', head: true }).eq('status', 'Failed'),
      db.from('ad_conversion').select('sent_at').eq('status', 'Sent').not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(1),
    ]);
    const err = l.error || w.error || wg.error || f.error || ls.error;
    if (err) return err;
    const rows = (l.data || []) as Conv[];
    setLog(rows);
    setCounts({ waitMeta: w.count || 0, waitGoogle: wg.count || 0, failed: f.count || 0, lastSent: (ls.data?.[0] as { sent_at: string } | undefined)?.sent_at || null });
    // names through lead_list (the screen-safe copy of a lead); a lead this role cannot see shows as "A lead"
    const ids = [...new Set(rows.map((r) => r.lead_id))];
    if (ids.length) {
      const n = await db.from('lead_list').select('id,full_name').in('id', ids);
      if (!n.error) setNames(Object.fromEntries((n.data || []).map((x: { id: string; full_name: string }) => [x.id, x.full_name])));
    }
    return null;
  }, []);

  const load = useCallback(async () => {
    setLoadErr('');
    const [a, b, c] = await Promise.all([loadSettings(), loadRules(), loadLog(null)]);
    const err = a || b || c;
    if (err) setLoadErr(friendlyError(err, 'ad conversions'));
    setLoaded(true);
  }, [loadSettings, loadRules, loadLog]);
  useEffect(() => { load(); }, [load]);

  const pickFilter = async (st: Status | null) => {
    setFilter(st); setRefreshing(true);
    const err = await loadLog(st);
    setRefreshing(false);
    if (err) toast(friendlyError(err), { tone: 'bad' });
  };
  const refresh = () => pickFilter(filter);
  const showInLog = (st: Status) => {
    pickFilter(st);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('ads-log')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

  // ── Settings ────────────────────────────────────────────────────────────────
  const updateSettings = async (patch: Partial<Settings>) => {
    const { error } = await supabase().from('ad_settings').update(patch).eq('id', 1);
    return error;
  };

  const metaDirty = !!set && (clean(meta.dataset) !== clean(set.meta_dataset_id) || clean(meta.test) !== clean(set.meta_test_event_code));
  const saveMeta = async () => {
    if (!set || savingMeta) return;
    const dataset = clean(meta.dataset);
    if (dataset && !/^\d{6,20}$/.test(dataset)) { toast('The dataset ID is only digits. Copy it from Events Manager.', { tone: 'bad' }); return; }
    setSavingMeta(true);
    const before = { meta_dataset_id: set.meta_dataset_id, meta_test_event_code: set.meta_test_event_code };
    const err = await updateSettings({ meta_dataset_id: dataset || null, meta_test_event_code: clean(meta.test) || null });
    setSavingMeta(false);
    if (err) { toast(friendlyError(err, 'ad settings'), { tone: 'bad' }); return; }
    await loadSettings();
    toast('Meta settings saved.', { undo: async () => { await updateSettings(before); await loadSettings(); toast('Put back as it was.'); } });
  };

  const googleDirty = !!set && (clean(google.user) !== clean(set.google_feed_user) || google.days !== set.google_feed_days);
  const saveGoogle = async () => {
    if (!set || savingGoogle) return;
    const user = clean(google.user);
    if (!user) { toast('Type a user name for Google, for example google-ads.', { tone: 'bad' }); return; }
    if (/[:\s]/.test(user)) { toast('The user name cannot have spaces or a colon.', { tone: 'bad' }); return; }
    setSavingGoogle(true);
    const before = { google_feed_user: set.google_feed_user, google_feed_days: set.google_feed_days };
    const err = await updateSettings({ google_feed_user: user, google_feed_days: google.days });
    setSavingGoogle(false);
    if (err) { toast(friendlyError(err, 'ad settings'), { tone: 'bad' }); return; }
    await loadSettings();
    toast('Google settings saved.', { undo: async () => { await updateSettings(before); await loadSettings(); toast('Put back as it was.'); } });
  };

  const missing = (p: Platform): string | null => {
    if (!set) return null;
    if (p === 'meta') return !set.meta_dataset_id ? 'Save the dataset ID first.' : !set.meta_token_set ? 'Save the access token first.' : null;
    return !set.google_password_set ? 'Set the password first.' : !set.google_feed_user ? 'Save a user name first.' : null;
  };
  const toggle = async (p: Platform) => {
    if (!set || switching) return;
    const key = p === 'meta' ? 'meta_enabled' : 'google_enabled';
    const next = !set[key];
    if (next) { const m = missing(p); if (m) { toast(m, { tone: 'bad' }); return; } }
    setSwitching(p);
    setSet({ ...set, [key]: next });
    const err = await updateSettings({ [key]: next } as Partial<Settings>);
    setSwitching(null);
    if (err) { setSet({ ...set }); toast(friendlyError(err, 'ad settings'), { tone: 'bad' }); return; }
    toast(next ? `${PLATFORM[p]}: on.` : `${PLATFORM[p]}: off. Nothing is reported to ${SHORT[p]} until you switch it back on.`);
  };

  const runTest = async (p: Platform) => {
    if (testing) return;
    setTesting(p); setTestResult((t) => ({ ...t, [p]: null }));
    const r = await callApi('/api/ads/test', { platform: p });
    setTesting(null);
    setTestResult((t) => ({ ...t, [p]: { ok: r.ok, text: r.message || (r.ok ? (p === 'meta' ? 'Test event sent. Open Events Manager → Test events to see it.' : 'The feed works.') : 'The test did not work.') } }));
  };

  // ── Rules ───────────────────────────────────────────────────────────────────
  const openRule = (p: Platform, r?: Rule) => {
    setDraftErr('');
    setDraft(r ? { id: r.id, platform: r.platform, trigger: r.trigger, stage: r.stage || '', event_name: r.event_name, send_value: r.send_value }
      : { platform: p, trigger: 'stage', stage: '', event_name: '', send_value: false });
  };
  const saveRule = async () => {
    if (!draft || savingRule) return;
    const name = draft.event_name.trim();
    if (draft.trigger === 'stage' && !draft.stage) { setDraftErr('Choose the stage.'); return; }
    if (!name) { setDraftErr(draft.platform === 'meta' ? 'Choose the Meta event.' : 'Type the conversion name exactly as it is in Google Ads.'); return; }
    if (name.length > 100) { setDraftErr('The name is too long (100 letters at most).'); return; }
    if (/^\s*[=+@-]/.test(name)) { setDraftErr('The name cannot start with = + - or @.'); return; }
    if (draft.platform === 'meta' && name === 'Purchase' && draft.trigger !== 'paid') { setDraftErr('Meta “Purchase” needs an amount, so use it only for “First fee received”.'); return; }
    const clash = rules.find((r) => r.id !== draft.id && r.platform === draft.platform && r.trigger === draft.trigger && (r.stage || '') === (draft.trigger === 'stage' ? draft.stage : ''));
    if (clash) { setDraftErr(`${SHORT[draft.platform]} already has a rule for “${momentText(clash)}”. Change that one instead.`); return; }
    setSavingRule(true); setDraftErr('');
    const row = { platform: draft.platform, trigger: draft.trigger, stage: draft.trigger === 'stage' ? draft.stage : null, event_name: name, send_value: draft.trigger === 'paid' && (draft.send_value || (draft.platform === 'meta' && name === 'Purchase')) };
    const db = supabase();
    const sort = Math.max(0, ...rules.filter((r) => r.platform === draft.platform).map((r) => r.sort)) + 1;
    const { error } = draft.id ? await db.from('ad_conversion_rule').update(row).eq('id', draft.id) : await db.from('ad_conversion_rule').insert({ ...row, sort });
    setSavingRule(false);
    if (error) { setDraftErr(error.code === '23505' ? 'There is already a rule for this moment.' : friendlyError(error, 'rules')); return; }
    setDraft(null);
    await loadRules();
    toast(draft.id ? 'Rule saved. It applies to what happens from now on.' : 'Rule added. It applies to what happens from now on.');
  };
  const setRuleActive = async (r: Rule) => {
    if (ruleBusy) return;
    setRuleBusy(r.id);
    setRules((l) => l.map((x) => (x.id === r.id ? { ...x, active: !r.active } : x)));
    const { error } = await supabase().from('ad_conversion_rule').update({ active: !r.active }).eq('id', r.id);
    setRuleBusy(null);
    if (error) { setRules((l) => l.map((x) => (x.id === r.id ? { ...x, active: r.active } : x))); toast(friendlyError(error, 'rules'), { tone: 'bad' }); }
  };
  const removeRule = async (r: Rule) => {
    setRuleBusy(r.id);
    const { error } = await supabase().from('ad_conversion_rule').delete().eq('id', r.id);
    setRuleBusy(null);
    if (error) { toast(friendlyError(error, 'rules'), { tone: 'bad' }); return; }
    if (draft?.id === r.id) setDraft(null);
    await loadRules();
    toast('Rule removed. It can be restored from the Recycle bin.');
  };

  // ── Log ─────────────────────────────────────────────────────────────────────
  const setRowStatus = async (c: Conv, to: 'Queued' | 'Skipped') => {
    if (rowBusy) return;
    setRowBusy(c.id);
    const patch = to === 'Queued' ? { status: 'Queued', attempts: 0, next_try_at: new Date().toISOString(), last_error: null } : { status: 'Skipped' };
    const { data, error } = await supabase().from('ad_conversion').update(patch).eq('id', c.id).eq('status', c.status).select('id');
    setRowBusy(null);
    if (error) { toast(friendlyError(error, 'ad conversions'), { tone: 'bad' }); return; }
    if (!data?.length) { toast('This row changed meanwhile. Showing the latest.'); refresh(); return; }
    await loadLog(filter);
    const who = names[c.lead_id] || 'this lead';
    if (to === 'Skipped') {
      toast(`Skipped: ${c.event_name} for ${who}. It will not be reported.`, c.status === 'Queued' ? {
        undo: async () => { await supabase().from('ad_conversion').update({ status: 'Queued' }).eq('id', c.id).eq('status', 'Skipped'); await loadLog(filter); toast('Put back in the queue.'); },
      } : undefined);
    } else {
      toast(c.platform === 'meta' ? 'Queued again. It goes to Meta within a minute.' : 'Queued again. Google picks it up the next time it reads the feed.');
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const header = (
    <PageHeader title="Ad conversions" group="Marketing"
      description="Tell Meta and Google which leads became students and paid, so your ads find more people like them." />
  );

  if (!loaded) {
    return (
      <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:px-6 md:py-4" aria-busy="true">
        {header}
        <span className="sr-only" role="status">Loading…</span>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Bone key={i} className="h-16 w-full" />)}</div>
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1].map((k) => <div key={k} className="flex flex-col gap-3 rounded-[14px] bg-surface p-4 shadow-1"><Bone className="h-5 w-40" />{[0, 1, 2].map((i) => <Bone key={i} className="h-10 w-full" />)}</div>)}
        </div>
      </main>
    );
  }

  if (loadErr || !set) {
    return (
      <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:px-6 md:py-4">
        {header}
        <div className="flex flex-col items-start gap-3 rounded-[14px] bg-surface p-4 shadow-1">
          <Notice tone="bad">Could not load ad conversions. {loadErr || 'The settings row is missing.'}</Notice>
          <Button variant="primary" className={btn} onClick={() => { setLoaded(false); load(); }}>Try again</Button>
        </div>
      </main>
    );
  }

  const feedUrl = `${origin}/api/ads/google-feed`;
  const metaReady = !missing('meta');
  const googleReady = !missing('google');
  const tiles: { label: string; value: string; sub: string; tone: 'good' | 'warn' | 'bad' | 'plain'; onClick?: () => void }[] = [
    { label: 'Meta', value: set.meta_enabled ? 'On' : 'Off', tone: set.meta_enabled ? 'good' : 'plain',
      sub: set.meta_enabled ? (set.meta_test_event_code ? 'Test mode: only under Test events' : 'Reporting') : metaReady ? 'Ready, switched off' : 'Not set up' },
    { label: 'Google Ads', value: set.google_enabled ? 'On' : 'Off', tone: set.google_enabled ? 'good' : 'plain',
      sub: set.last_feed_at ? `Google last read ${when(set.last_feed_at)}` : set.google_enabled ? 'Google has not read it yet' : googleReady ? 'Ready, switched off' : 'Not set up' },
    { label: 'Waiting', value: String(waiting), tone: waiting ? 'warn' : 'plain', sub: !set?.meta_enabled && !set?.google_enabled ? 'Meta and Google are off' : counts.lastSent ? `Last sent ${when(counts.lastSent)}` : 'Nothing sent yet', onClick: () => showInLog('Queued') },
    { label: 'Failed', value: String(counts.failed), tone: counts.failed ? 'bad' : 'plain', sub: counts.failed ? 'Open the list to retry' : 'None', onClick: () => showInLog('Failed') },
  ];
  const toneCls = { good: 'text-goodText', warn: 'text-warnText', bad: 'text-badText', plain: 'text-text' };

  const ruleForm = (p: Platform) => draft && draft.platform === p && (
    <form className="flex flex-col gap-3 rounded-[12px] border border-line bg-bg p-3" aria-label={draft.id ? 'Change rule' : `New ${SHORT[p]} rule`}
      onSubmit={(e) => { e.preventDefault(); saveRule(); }} data-testid="ads-rule-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1 text-[13px] font-medium">When
          <select className={field} value={draft.trigger} onChange={(e) => { setDraft({ ...draft, trigger: e.target.value as Trigger }); setDraftErr(''); }}>
            <option value="arrived">A lead arrives</option>
            <option value="stage">Lead moves to a stage</option>
            <option value="paid">First fee is received</option>
          </select>
        </label>
        {draft.trigger === 'stage' && (
          <label className="flex min-w-0 flex-col gap-1 text-[13px] font-medium">Stage
            <select className={field} value={draft.stage} onChange={(e) => { setDraft({ ...draft, stage: e.target.value }); setDraftErr(''); }}>
              <option value="">Choose…</option>
              {[...stages, ...(draft.stage && !stages.includes(draft.stage) ? [draft.stage] : [])].map((st) => <option key={st} value={st}>{st}</option>)}
            </select>
          </label>
        )}
        <label className="flex min-w-0 flex-col gap-1 text-[13px] font-medium">{p === 'meta' ? 'Meta event' : 'Conversion name in Google Ads'}
          {p === 'meta' ? (
            <select className={field} value={draft.event_name} onChange={(e) => { setDraft({ ...draft, event_name: e.target.value }); setDraftErr(''); }}>
              <option value="">Choose…</option>
              {[...META_EVENTS, ...(draft.event_name && !META_EVENTS.includes(draft.event_name) ? [draft.event_name] : [])].map((ev) => <option key={ev} value={ev}>{ev}</option>)}
            </select>
          ) : (
            <input className={field} value={draft.event_name} maxLength={100} placeholder="e.g. Enrolment" onChange={(e) => { setDraft({ ...draft, event_name: e.target.value }); setDraftErr(''); }} />
          )}
        </label>
      </div>
      {p === 'google' && <p className="-mt-1 text-[12px] text-muted">Type it exactly as the conversion action is named in Google Ads (Goals → Conversions).</p>}
      {draft.trigger === 'paid' && (
        <label className="flex min-h-[44px] items-center gap-2 text-[13.5px] md:min-h-[32px]">
          <input type="checkbox" className="h-5 w-5" checked={draft.send_value || (p === 'meta' && draft.event_name === 'Purchase')} disabled={p === 'meta' && draft.event_name === 'Purchase'} onChange={(e) => setDraft({ ...draft, send_value: e.target.checked })} />
          Send the fee amount, so {SHORT[p]} can tell high-value students apart
        </label>
      )}
      {draftErr && <p role="alert" className="text-[12.5px] font-medium text-badText">{draftErr}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" className={btn} loading={savingRule}>{draft.id ? 'Save rule' : 'Add rule'}</Button>
        <Button variant="outline" className={btn} disabled={savingRule} onClick={() => { setDraft(null); setDraftErr(''); }}>Cancel</Button>
      </div>
    </form>
  );

  const ruleList = (p: Platform) => {
    const list = rules.filter((r) => r.platform === p);
    return (
      <div className="flex flex-col gap-2" data-testid={`ads-rules-${p}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">{PLATFORM[p]}</h3>
          {canEdit && !(draft && !draft.id && draft.platform === p) && (
            <Button size="sm" variant="quiet" className={btn} leftIcon={<Plus size={14} />} onClick={() => openRule(p)}>Add rule</Button>
          )}
        </div>
        {draft && !draft.id && ruleForm(p)}
        {list.length === 0 ? (
          <p className="rounded-[12px] bg-surface px-3 py-3 text-[13px] text-muted shadow-1">No rules. Nothing is reported to {SHORT[p]}.</p>
        ) : (
          <ul className="flex flex-col rounded-[14px] bg-surface shadow-1" aria-label={`${PLATFORM[p]} rules`}>
            {list.map((r) => (
              <li key={r.id} data-testid="ads-rule" className="flex flex-col gap-2 border-b border-line px-3 py-2.5 last:border-b-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div className={cx('min-w-0 flex-1 basis-[220px]', !r.active && 'opacity-60')}>
                    <div className="text-[14px] font-medium">{momentText(r)}</div>
                    <div className="text-[12.5px] text-text2">
                      Report as <b className="font-semibold text-text">{r.event_name}</b>
                      {r.trigger === 'paid' && (r.send_value ? ' · with the fee amount' : ' · without the amount')}
                      {!r.active && ' · switched off'}
                    </div>
                  </div>
                  {canEdit ? (
                    <div className="flex flex-wrap items-center gap-1">
                      <Switch on={r.active} label={`${momentText(r)} → ${r.event_name}, on or off`} disabled={ruleBusy === r.id} onClick={() => setRuleActive(r)} />
                      <Button size="sm" variant="quiet" className={btn} leftIcon={<Pencil size={14} />} onClick={() => openRule(p, r)} aria-label={`Change rule: ${momentText(r)}`}>Change</Button>
                      <Confirm title="Remove this rule?" yes="Remove" onYes={() => removeRule(r)} disabled={ruleBusy === r.id} ariaLabel={`Remove rule: ${momentText(r)}`}
                        body={`${momentText(r)} will no longer be reported to ${SHORT[p]}. What was already sent stays sent.`}
                        className="inline-flex h-11 items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] font-medium text-badText hover:bg-badBg disabled:opacity-50 md:h-9">
                        <Trash2 size={14} aria-hidden />Remove
                      </Confirm>
                    </div>
                  ) : (
                    <span className={cx('rounded-full px-2 py-[2px] text-[11.5px] font-semibold', r.active ? 'bg-goodBg text-goodText' : 'bg-surface2 text-text2')}>{r.active ? 'On' : 'Off'}</span>
                  )}
                </div>
                {draft?.id === r.id && ruleForm(p)}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  const rowActions = (c: Conv, mobile?: boolean) => {
    if (!canEdit) return null;
    const cls = mobile ? 'h-11' : undefined;
    return (
      <div className="flex flex-wrap justify-end gap-1">
        {(c.status === 'Failed' || c.status === 'Skipped') && (
          <Button size="sm" variant="outline" className={cls} leftIcon={<RotateCcw size={14} />} loading={rowBusy === c.id} disabled={!!rowBusy && rowBusy !== c.id} onClick={() => setRowStatus(c, 'Queued')}>
            {c.status === 'Failed' ? 'Retry' : 'Send after all'}
          </Button>
        )}
        {(c.status === 'Failed' || c.status === 'Queued') && (
          <Button size="sm" variant="quiet" className={cls} leftIcon={<SkipForward size={14} />} disabled={!!rowBusy} onClick={() => setRowStatus(c, 'Skipped')}>Skip</Button>
        )}
      </div>
    );
  };
  const errText = (c: Conv) => (c.status === 'Failed' ? plainMessage(c.last_error, `${SHORT[c.platform]} did not accept it`)
    : c.status === 'Skipped' && c.last_error ? plainMessage(c.last_error, 'Skipped') : null);

  return (
    <main className="flex flex-1 flex-col gap-5 overflow-y-auto p-4 md:px-6 md:py-4">
      {header}
      {!canEdit && <Notice tone="warn">View only. Only Admin can change these settings and rules.</Notice>}

      {/* Status */}
      <section aria-label="Status" className="flex flex-col gap-2" data-testid="ads-status">
        <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {tiles.map((t) => {
            const inner = (
              <>
                <span className="block text-[12px] font-medium text-text2">{t.label}</span>
                <span className={cx('num block text-[20px] font-semibold leading-tight', toneCls[t.tone])}>{t.value}</span>
                <span className="block truncate text-[12px] text-muted" title={t.sub}>{t.sub}</span>
              </>
            );
            return (
              <li key={t.label} className="min-w-0">
                {t.onClick ? (
                  <button type="button" onClick={t.onClick} aria-label={`${t.label}: ${t.value}. Show these in the list below`}
                    className="block w-full rounded-[12px] bg-surface px-3 py-2.5 text-left shadow-1 hover:bg-surface2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">{inner}</button>
                ) : <div className="rounded-[12px] bg-surface px-3 py-2.5 shadow-1">{inner}</div>}
              </li>
            );
          })}
        </ul>
        <p className="text-[12.5px] text-text2">
          Only leads who allowed ad cookies on the website are reported, plus leads from Meta lead forms (to Meta only). Email and phone leave the CRM only scrambled, so they cannot be read.
        </p>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {/* Meta */}
        <section aria-labelledby="ads-meta" className="flex min-w-0 flex-col gap-3 rounded-[14px] bg-surface p-4 shadow-1" data-testid="ads-meta">
          <SectionTitle aside={canEdit ? <Switch on={set.meta_enabled} label="Report to Meta, on or off" disabled={switching === 'meta'} onClick={() => toggle('meta')} /> : undefined}>
            <span id="ads-meta">Meta (Facebook, Instagram)</span>
          </SectionTitle>
          {canEdit ? (
            <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); saveMeta(); }} aria-label="Meta settings">
              <label className="flex min-w-0 flex-col gap-1 text-[13px] font-medium">Dataset ID (Pixel ID)
                <input className={cx(field, 'font-mono')} value={meta.dataset} inputMode="numeric" maxLength={20} placeholder="e.g. 123456789012345" spellCheck={false}
                  onChange={(e) => setMeta({ ...meta, dataset: e.target.value })} />
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-[13px] font-medium"><span>Test event code <span className="font-normal text-muted">(optional)</span></span>
                <input className={cx(field, 'font-mono')} value={meta.test} maxLength={40} placeholder="e.g. TEST12345" spellCheck={false}
                  onChange={(e) => setMeta({ ...meta, test: e.target.value })} />
                <span className="text-[12px] font-normal text-muted">While this is filled, Meta shows events only under Test events and does not use them for ads. Empty it when you are done testing.</span>
              </label>
              {metaDirty && (
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" variant="primary" className={btn} loading={savingMeta}>Save</Button>
                  <Button variant="outline" className={btn} disabled={savingMeta} onClick={() => setMeta({ dataset: set.meta_dataset_id || '', test: set.meta_test_event_code || '' })}>Cancel</Button>
                </div>
              )}
            </form>
          ) : (
            <div className="flex flex-col">
              <Line label="Dataset ID"><span className="font-mono">{set.meta_dataset_id || '—'}</span></Line>
              <Line label="Test event code">{set.meta_test_event_code ? <span className="font-mono">{set.meta_test_event_code}</span> : 'None'}</Line>
              <Line label="Reporting">{set.meta_enabled ? 'On' : 'Off'}</Line>
            </div>
          )}
          <Secret label="Access token" name="meta_capi_token" isSet={set.meta_token_set} canEdit={canEdit} onSaved={async () => { await loadSettings(); }}
            hint="From Events Manager → your dataset → Settings → Conversions API → Generate access token." />
          {canEdit && (
            <div className="flex flex-col gap-2">
              <Button size="sm" variant="outline" className={cx(btn, 'self-start')} leftIcon={<Send size={14} />} loading={testing === 'meta'} disabled={!metaReady || (!!testing && testing !== 'meta')}
                onClick={() => runTest('meta')}>Send test event</Button>
              {!metaReady && <span className="text-[12px] text-muted">{missing('meta')}</span>}
              {testResult.meta && <Notice tone={testResult.meta.ok ? 'good' : 'bad'}>{testResult.meta.text}</Notice>}
            </div>
          )}
          <Steps id="ads-meta-howto" label="How to set up Meta (about 5 minutes)">
            <li>Open <b className="text-text">business.facebook.com</b> → <b className="text-text">Events Manager</b> and choose the dataset (Pixel) your ads use.</li>
            <li>Copy its <b className="text-text">Dataset ID</b> (the number under the name) and paste it above. Save.</li>
            <li><b className="text-text">Settings</b> → <b className="text-text">Conversions API</b> → <b className="text-text">Generate access token</b>. Copy it, press <b className="text-text">Set</b> next to Access token above, paste and save.</li>
            <li>To check it: open <b className="text-text">Test events</b>, copy the test code, paste it above, save, then press <b className="text-text">Send test event</b>. It shows there within a minute.</li>
            <li>Empty the test code, save, and switch Meta <b className="text-text">On</b>.</li>
          </Steps>
        </section>

        {/* Google */}
        <section aria-labelledby="ads-google" className="flex min-w-0 flex-col gap-3 rounded-[14px] bg-surface p-4 shadow-1" data-testid="ads-google">
          <SectionTitle aside={canEdit ? <Switch on={set.google_enabled} label="Report to Google Ads, on or off" disabled={switching === 'google'} onClick={() => toggle('google')} /> : undefined}>
            <span id="ads-google">Google Ads</span>
          </SectionTitle>
          <p className="-mt-1 text-[12.5px] text-text2">Google reads a list of conversions from the CRM on a schedule you set in Google Ads (for example every day).</p>
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-medium">Link for Google</span>
            <div className="flex min-w-0 items-center gap-2">
              <input readOnly value={feedUrl} aria-label="Link for Google" onFocus={(e) => e.currentTarget.select()} className={cx(field, 'flex-1 bg-bg font-mono text-[12.5px] md:text-[12.5px]')} />
              <Button size="sm" variant="outline" className={btn} leftIcon={<Copy size={14} />}
                onClick={async () => { try { await navigator.clipboard.writeText(feedUrl); toast('Link copied.'); } catch { toast('Could not copy. Select the link and copy it by hand.', { tone: 'bad' }); } }}>Copy</Button>
            </div>
            <span className="text-[12px] text-muted">This must be the CRM’s public address (the one Google can reach), not localhost.</span>
          </div>
          {canEdit ? (
            <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); saveGoogle(); }} aria-label="Google settings">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex min-w-0 flex-col gap-1 text-[13px] font-medium">User name
                  <input className={cx(field, 'font-mono')} value={google.user} maxLength={60} spellCheck={false} autoComplete="off" onChange={(e) => setGoogle({ ...google, user: e.target.value })} />
                </label>
                <label className="flex min-w-0 flex-col gap-1 text-[13px] font-medium">Look back
                  <select className={field} value={google.days} onChange={(e) => setGoogle({ ...google, days: Number(e.target.value) })}>
                    {[...FEED_DAYS, ...(FEED_DAYS.includes(google.days) ? [] : [google.days])].map((d) => <option key={d} value={d}>Last {d} days</option>)}
                  </select>
                </label>
              </div>
              {googleDirty && (
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" variant="primary" className={btn} loading={savingGoogle}>Save</Button>
                  <Button variant="outline" className={btn} disabled={savingGoogle} onClick={() => setGoogle({ user: set.google_feed_user || '', days: set.google_feed_days || 60 })}>Cancel</Button>
                </div>
              )}
            </form>
          ) : (
            <div className="flex flex-col">
              <Line label="User name"><span className="font-mono">{set.google_feed_user || '—'}</span></Line>
              <Line label="Look back">Last {set.google_feed_days} days</Line>
              <Line label="Reporting">{set.google_enabled ? 'On' : 'Off'}</Line>
            </div>
          )}
          <Secret label="Password" name="google_feed_password" isSet={set.google_password_set} canEdit={canEdit} onSaved={async () => { await loadSettings(); }} generate
            hint="Use “Make one for me”, copy it, save, and paste the same password in Google Ads. It is not shown again after saving." />
          <Line label="Last read by Google">{set.last_feed_at ? when(set.last_feed_at) : 'Not yet'}</Line>
          {canEdit && (
            <div className="flex flex-col gap-2">
              <Button size="sm" variant="outline" className={cx(btn, 'self-start')} leftIcon={<Check size={14} />} loading={testing === 'google'} disabled={!!testing && testing !== 'google'} onClick={() => runTest('google')}>Check the list</Button>
              {testResult.google && <Notice tone={testResult.google.ok ? 'good' : 'bad'}>{testResult.google.text}</Notice>}
            </div>
          )}
          <Steps id="ads-google-howto" label="How to set up Google Ads (about 5 minutes)">
            <li>Set a <b className="text-text">Password</b> above (use “Make one for me” and copy it), and save.</li>
            <li>In Google Ads: <b className="text-text">Goals</b> → <b className="text-text">Conversions</b> → make one conversion action per rule below (source <b className="text-text">“Import” → “Other data sources or CRMs”</b>), named exactly like the rule.</li>
            <li><b className="text-text">Goals</b> → <b className="text-text">Conversions</b> → <b className="text-text">Uploads</b> → <b className="text-text">Schedules</b> → <b className="text-text">+</b>. Source: <b className="text-text">HTTPS</b>.</li>
            <li>Paste the <b className="text-text">Link for Google</b>, the <b className="text-text">User name</b> and the same <b className="text-text">Password</b>. Choose <b className="text-text">every day</b>. Save.</li>
            <li>Switch Google <b className="text-text">On</b> here. “Last read by Google” fills in after its first visit.</li>
          </Steps>
        </section>
      </div>

      {/* Rules */}
      <section aria-labelledby="ads-rules" className="flex flex-col gap-3" data-testid="ads-rules">
        <SectionTitle><span id="ads-rules">What is reported</span></SectionTitle>
        <p className="-mt-2 text-[12.5px] text-text2">Each moment is reported once per lead. A change here applies to what happens from now on.</p>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {ruleList('meta')}
          {ruleList('google')}
        </div>
      </section>

      {/* Log */}
      <section aria-labelledby="ads-log" className="flex flex-col gap-2" data-testid="ads-log">
        <SectionTitle aside={<Button size="sm" variant="outline" className={btn} leftIcon={<RefreshCw size={14} />} loading={refreshing} onClick={refresh}>Refresh</Button>}>
          <span id="ads-log">Recent conversions</span>
        </SectionTitle>
        <div className="-mx-1 overflow-x-auto px-1">
          <ButtonGroup label="Show">
            {LOG_FILTERS.map((f) => (
              <Button key={f.label} size="sm" variant="quiet" active={filter === f.status} className="h-11 md:h-9" onClick={() => pickFilter(f.status)}>{f.label}</Button>
            ))}
          </ButtonGroup>
        </div>
        <p className="text-[12.5px] text-text2">Meta gets them within a minute. Google picks them up when it next reads the list. Failed ones retry by themselves up to five times. Showing the latest 50.</p>
        {log.length === 0 ? (
          filter ? <EmptyState kind="search" title={`No ${LOG_FILTERS.find((f) => f.status === filter)?.label.toLowerCase()} conversions`} body="Choose All to see everything." action={{ label: 'Show all', onClick: () => pickFilter(null) }} />
            : <EmptyState title="Nothing reported yet" body="When a website lead who allowed ad cookies arrives, moves stage or pays, it shows up here." />
        ) : (
          <>
            <ul className="flex flex-col gap-2 md:hidden" aria-label="Recent conversions">
              {log.map((c) => (
                <li key={c.id} data-testid="ads-conv" className="rounded-[12px] bg-surface p-3 shadow-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{names[c.lead_id] || 'A lead'}</div>
                      <div className="text-[12.5px] text-text2">{SHORT[c.platform]} · {c.event_name}{c.value != null ? ` · ${money(c.value)}` : ''}</div>
                      <div className="text-[12px] text-muted">{when(c.event_time)}</div>
                    </div>
                    <StatusWord c={c} />
                  </div>
                  {errText(c) && <div className={`mt-1 break-words text-[12.5px] ${c.status === 'Failed' ? 'text-badText' : 'text-muted'}`}>{errText(c)}</div>}
                  <div className="mt-2">{rowActions(c, true)}</div>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table label="Recent conversions">
                <THead><Th>When</Th><Th>Lead</Th><Th>Sent to</Th><Th>Reported as</Th><Th numeric>Value</Th><Th>Status</Th><Th className="w-48" /></THead>
                <TBody>
                  {log.map((c) => (
                    <Tr key={c.id} data-testid="ads-conv">
                      <Td className="whitespace-nowrap text-text2">{when(c.event_time)}</Td>
                      <Td className="max-w-[220px] truncate font-medium" title={names[c.lead_id]}>{names[c.lead_id] || 'A lead'}</Td>
                      <Td className="whitespace-nowrap text-text2">{SHORT[c.platform]}</Td>
                      <Td>{c.event_name}</Td>
                      <Td numeric className="num">{c.value != null ? money(c.value) : '—'}</Td>
                      <Td>
                        <div className="py-1.5">
                          <StatusWord c={c} />
                          {errText(c) && <div className={`mt-1 max-w-[320px] break-words text-[12px] ${c.status === 'Failed' ? 'text-badText' : 'text-muted'}`}>{errText(c)}</div>}
                          {c.status === 'Sent' && c.sent_at && <div className="mt-0.5 text-[12px] text-muted">{when(c.sent_at)}</div>}
                        </div>
                      </Td>
                      <Td>{rowActions(c)}</Td>
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
