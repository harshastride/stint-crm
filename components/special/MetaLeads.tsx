'use client';
import { plainMessage } from '@/lib/plainMessage';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Check, ChevronDown, Copy, ExternalLink, Facebook, RefreshCw, RotateCcw, Unplug } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { PageHeader } from '../kit/PageHeader';
import { EmptyState } from '../kit/EmptyState';
import { Confirm } from '../kit/Confirm';
import { Table, THead, TBody, Th, Td, Tr } from '../kit/Table';
import { Bone } from '../Skeletons';
import { Button, Notice, cx } from '../ui';
import { friendlyError } from '../Fields';
import { useToast } from '../Toasts';

// Admin: "Meta lead forms". Save the Meta app once, connect Facebook, switch a page on, and every lead from its
// Facebook / Instagram lead forms arrives by itself. Tables: meta_app / meta_page / meta_form / meta_field_map /
// meta_lead (migration 20261004000100). The app secret and page tokens are never readable here; saving the app,
// connecting, switching pages and fetching old leads go through /api/meta/*. This page edits only the form switches,
// the form's course, the question mapping, and Retry on a failed lead.

type App = { app_id: string | null; login_config_id: string | null; graph_version: string; webhook_ok: boolean; webhook_error: string | null };
type Page = { page_id: string; name: string; receiving: boolean; connected_at: string; last_error: string | null; last_lead_at: string | null };
type Question = { key: string; label?: string; type?: string; options?: unknown };
type Form = { form_id: string; page_id: string; name: string; status: string | null; questions: Question[]; active: boolean; course: string | null; last_lead_at: string | null };
type LeadStatus = 'Pending' | 'Working' | 'Done' | 'Duplicate' | 'Skipped' | 'Failed';
type MetaLead = { leadgen_id: string; form_id: string | null; status: LeadStatus; attempts: number; lead_id: string | null; last_error: string | null; received_at: string; processed_at: string | null };

const when = (v: string) => new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const field = 'h-11 w-full min-w-0 rounded-[10px] border border-line2 bg-surface px-3 text-[14px] md:h-9 md:text-[13.5px]';
const btn = 'h-11 md:h-9';

// Meta's standard questions, saved straight into the lead (same list as the server's lib/server/meta.ts).
const STANDARD: Record<string, string> = {
  full_name: 'Name', first_name: 'Name', last_name: 'Name', phone_number: 'Mobile', phone: 'Mobile', mobile_number: 'Mobile',
  email: 'Email', work_email: 'Email', city: 'City',
};

const STATUS: Record<LeadStatus, { word: string; tone: string }> = {
  Done: { word: 'Saved', tone: 'bg-goodBg text-goodText' },
  Duplicate: { word: 'Already in CRM', tone: 'bg-accentSoft text-accentText' },
  Skipped: { word: 'Skipped', tone: 'bg-surface2 text-text2' },
  Pending: { word: 'Waiting', tone: 'bg-warnBg text-warnText' },
  Working: { word: 'Working', tone: 'bg-warnBg text-warnText' },
  Failed: { word: 'Failed', tone: 'bg-badBg text-badText' },
};
function StatusWord({ l }: { l: MetaLead }) {
  const s = STATUS[l.status] || { word: l.status, tone: 'bg-surface2 text-text2' };
  return <span className={cx('inline-block whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-semibold', s.tone)}>{s.word}{l.status === 'Failed' && l.attempts > 1 ? ` (${l.attempts} tries)` : ''}</span>;
}

const formStatus = (s: string | null) => {
  const u = (s || '').toUpperCase();
  if (u === 'ACTIVE') return { word: 'Live on Meta', tone: 'bg-goodBg text-goodText' };
  if (u === 'ARCHIVED') return { word: 'Archived on Meta', tone: 'bg-surface2 text-text2' };
  if (u === 'DRAFT') return { word: 'Draft on Meta', tone: 'bg-warnBg text-warnText' };
  if (u === 'DELETED') return { word: 'Deleted on Meta', tone: 'bg-badBg text-badText' };
  return s ? { word: s.charAt(0) + s.slice(1).toLowerCase(), tone: 'bg-surface2 text-text2' } : null;
};

/** POST to one of our /api/meta/* routes; a plain sentence on failure. */
async function callApi<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    if (res.ok && data.ok) return { ok: true, data: data as T };
    const fallback = res.status === 401 ? 'Please sign in again.' : res.status === 403 ? 'Only Admin can change this.'
      : res.status === 429 ? 'Too many tries. Wait a minute and try again.' : 'That did not work. Please try again.';
    return { ok: false, error: plainMessage(data.error, fallback) };
  } catch {
    return { ok: false, error: 'Could not reach the CRM. Check the internet connection and try again.' };
  }
}

function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <h2 className="text-[15px] font-semibold">{children}</h2>
      {aside}
    </div>
  );
}

function Switch({ on, label, disabled, onClick, words = ['On', 'Off'] }: { on: boolean; label: string; disabled?: boolean; onClick: () => void; words?: [string, string] }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick}
      className="flex h-11 shrink-0 items-center gap-2 rounded-[10px] px-1.5 text-[12.5px] font-medium text-text2 hover:bg-surface2 disabled:cursor-default disabled:opacity-50 md:h-9">
      <span className={cx('relative block h-6 w-11 shrink-0 rounded-full transition-colors duration-150 motion-reduce:transition-none', on ? 'bg-accent' : 'bg-line2')}>
        <span className={cx('absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-150 motion-reduce:transition-none', on ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </span>
      <span className="whitespace-nowrap">{on ? words[0] : words[1]}</span>
    </button>
  );
}

/** A button that opens and closes a block below it. */
function Fold({ label, open, onToggle, id, icon }: { label: ReactNode; open: boolean; onToggle: () => void; id: string; icon?: ReactNode }) {
  return (
    <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle}
      className="flex min-h-[44px] w-full items-center gap-2 rounded-[10px] px-1 text-left text-[13.5px] font-medium text-accentText hover:bg-surface2 md:min-h-[36px]">
      {icon}
      <span className="flex-1">{label}</span>
      <ChevronDown size={18} aria-hidden className={cx('shrink-0 text-muted transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-180')} />
    </button>
  );
}

function CopyLine({ label, value, note }: { label: string; value: string; note?: string }) {
  const toast = useToast();
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); toast(`${label} copied.`); }
    catch { toast('Could not copy. Select the address and copy it by hand.', { tone: 'bad' }); }
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[13px] font-medium">{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()}
          className={cx(field, 'flex-1 bg-bg font-mono text-[12.5px] md:text-[12.5px]')} />
        <Button size="sm" variant="outline" className={btn} leftIcon={<Copy size={14} />} onClick={copy}>Copy</Button>
      </div>
      {note && <span className="text-[12px] text-muted">{note}</span>}
    </div>
  );
}

export function MetaLeads() {
  const s = useSession();
  const toast = useToast();
  const canEdit = s.can('meta', 'w');
  const courses = (s.refs.program || []).map((p) => p.label);
  const customFields = s.custom.filter((c) => c.page_id === 'lead');

  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const [app, setApp] = useState<App | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [forms, setForms] = useState<Form[]>([]);
  const [maps, setMaps] = useState<Record<string, string>>({}); // `${form_id}|${meta_key}` → target
  const [leads, setLeads] = useState<MetaLead[]>([]);
  const [origin, setOrigin] = useState('');
  const [connectNote, setConnectNote] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  // step 1
  const [editingApp, setEditingApp] = useState(false);
  const [howOpen, setHowOpen] = useState(true);
  const [addrOpen, setAddrOpen] = useState(false);
  const [appForm, setAppForm] = useState({ app_id: '', app_secret: '', login_config_id: '' });
  const [changeSecret, setChangeSecret] = useState(false);
  const [appErr, setAppErr] = useState('');
  const [savingApp, setSavingApp] = useState(false);
  const [appResult, setAppResult] = useState<{ ok: boolean; text: string } | null>(null);
  // step 2 + pages
  const [connecting, setConnecting] = useState(false);
  const [pageBusy, setPageBusy] = useState<Record<string, string>>({}); // page_id → action
  // forms
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [formBusy, setFormBusy] = useState<Record<string, boolean>>({});
  const [backfilling, setBackfilling] = useState<string | null>(null);
  const mapPending = useRef(new Set<string>());
  const [, bump] = useState(0);
  // log
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);

  const loadApp = useCallback(async () => {
    const { data, error } = await supabase().from('meta_app').select('app_id,login_config_id,graph_version,webhook_ok,webhook_error').maybeSingle();
    if (error) return error;
    setApp((data as App) || null);
    return null;
  }, []);

  const loadPagesForms = useCallback(async () => {
    const db = supabase();
    const [p, f, m] = await Promise.all([
      db.from('meta_page').select('page_id,name,receiving,connected_at,last_error,last_lead_at').order('name'),
      db.from('meta_form').select('form_id,page_id,name,status,questions,active,course,last_lead_at').order('name'),
      db.from('meta_field_map').select('form_id,meta_key,target'),
    ]);
    const err = p.error || f.error || m.error;
    if (err) return err;
    setPages((p.data || []) as Page[]);
    setForms(((f.data || []) as Form[]).map((x) => ({ ...x, questions: Array.isArray(x.questions) ? x.questions.filter((q) => q && typeof q.key === 'string') : [] })));
    setMaps(Object.fromEntries((m.data || []).map((r: { form_id: string; meta_key: string; target: string }) => [`${r.form_id}|${r.meta_key}`, r.target])));
    return null;
  }, []);

  const loadLeads = useCallback(async () => {
    const { data, error } = await supabase().from('meta_lead')
      .select('leadgen_id,form_id,status,attempts,lead_id,last_error,received_at,processed_at').order('received_at', { ascending: false }).limit(50);
    if (error) return error;
    setLeads((data || []) as MetaLead[]);
    return null;
  }, []);

  const load = useCallback(async () => {
    setLoadErr('');
    const [a, pf, l] = await Promise.all([loadApp(), loadPagesForms(), loadLeads()]);
    const err = a || pf || l;
    if (err) setLoadErr(friendlyError(err, 'Meta lead forms'));
    setLoaded(true);
  }, [loadApp, loadPagesForms, loadLeads]);

  useEffect(() => {
    setOrigin(window.location.origin);
    // Facebook sends Admin back here with the result of "Connect Facebook"
    const q = new URLSearchParams(window.location.search);
    const meta = q.get('meta');
    if (meta === 'connected') {
      const n = Number(q.get('pages') || 0);
      setConnectNote({ tone: 'good', text: n > 0 ? `Connected. ${n} page${n === 1 ? '' : 's'} found. Switch on “Receiving leads” for the page you advertise from.` : 'Connected, but no pages were found. Check that you picked your page when Facebook asked, then connect again.' });
    } else if (meta === 'error') {
      setConnectNote({ tone: 'bad', text: plainMessage(q.get('reason'), 'Facebook did not finish connecting. Please try again.') });
    }
    if (meta) {
      ['meta', 'pages', 'reason'].forEach((k) => q.delete(k));
      const rest = q.toString();
      window.history.replaceState(window.history.state, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
    }
    load();
    // coming back from Facebook with the browser's Back button: the "Connect" button must work again
    const back = (e: PageTransitionEvent) => { if (e.persisted) setConnecting(false); };
    window.addEventListener('pageshow', back);
    return () => window.removeEventListener('pageshow', back);
  }, [load]);

  const appSaved = !!app?.app_id;
  const receivingCount = pages.filter((p) => p.receiving).length;

  // ── Step 1: Meta app ────────────────────────────────────────────────────────
  const openAppForm = () => {
    setAppForm({ app_id: app?.app_id || '', app_secret: '', login_config_id: app?.login_config_id || '' });
    setChangeSecret(!appSaved); setAppErr(''); setAppResult(null); setEditingApp(true);
  };
  const saveApp = async () => {
    if (savingApp) return;
    const app_id = appForm.app_id.trim();
    const secret = appForm.app_secret.trim();
    if (!/^\d{5,}$/.test(app_id)) { setAppErr('The App ID is the long number at the top of App settings → Basic.'); return; }
    if (!appSaved && !secret) { setAppErr('Paste the App secret too (App settings → Basic → App secret → Show).'); return; }
    setSavingApp(true); setAppErr(''); setAppResult(null);
    const body: Record<string, string> = { app_id, login_config_id: appForm.login_config_id.trim() };
    if (secret) body.app_secret = secret;
    const r = await callApi<{ app_name?: string; webhook_ok?: boolean; webhook_error?: string | null }>('/api/meta/app', body);
    setSavingApp(false);
    if (!r.ok) { setAppErr(r.error); return; }
    await loadApp();
    setEditingApp(false); setAppForm({ app_id: '', app_secret: '', login_config_id: '' });
    setAppResult(r.data.webhook_ok
      ? { ok: true, text: 'Webhook ready ✓ Meta will tell the CRM about every new lead.' }
      : { ok: false, text: plainMessage(r.data.webhook_error, 'The app is saved, but Meta did not accept the webhook. Check the steps above and save again.') });
    toast(r.data.app_name ? `Saved the Meta app “${r.data.app_name}”.` : 'Saved the Meta app.');
  };

  // ── Step 2 + pages ──────────────────────────────────────────────────────────
  const connect = () => { if (!appSaved || connecting) return; setConnecting(true); window.location.href = '/api/meta/connect'; };

  const setBusy = (id: string, v: string | null) => setPageBusy((b) => { const n = { ...b }; if (v) n[id] = v; else delete n[id]; return n; });

  const toggleReceiving = async (p: Page) => {
    if (pageBusy[p.page_id]) return;
    const next = !p.receiving;
    setBusy(p.page_id, 'receive');
    setPages((l) => l.map((x) => (x.page_id === p.page_id ? { ...x, receiving: next } : x)));
    const r = await callApi('/api/meta/pages', { page_id: p.page_id, action: next ? 'receive' : 'stop' });
    setBusy(p.page_id, null);
    if (!r.ok) {
      setPages((l) => l.map((x) => (x.page_id === p.page_id ? { ...x, receiving: p.receiving } : x)));
      toast(r.error, { tone: 'bad' }); return;
    }
    toast(next ? `${p.name}: new leads now come into the CRM.` : `${p.name}: stopped. New leads from this page stay only in Meta.`);
    loadPagesForms();
  };

  const syncPage = async (p: Page) => {
    if (pageBusy[p.page_id]) return;
    setBusy(p.page_id, 'sync');
    const r = await callApi<{ forms?: number }>('/api/meta/pages', { page_id: p.page_id, action: 'sync' });
    if (r.ok) await loadPagesForms();
    setBusy(p.page_id, null);
    if (!r.ok) { toast(r.error, { tone: 'bad' }); return; }
    const n = r.data.forms;
    toast(typeof n === 'number' ? `${p.name}: ${n} lead form${n === 1 ? '' : 's'} found.` : `${p.name}: forms refreshed.`);
  };

  const disconnect = async (p: Page) => {
    if (pageBusy[p.page_id]) return;
    setBusy(p.page_id, 'disconnect');
    const r = await callApi('/api/meta/pages', { page_id: p.page_id, action: 'disconnect' });
    if (r.ok) await loadPagesForms();
    setBusy(p.page_id, null);
    if (!r.ok) { toast(r.error, { tone: 'bad' }); return; }
    toast(`Disconnected ${p.name}. The leads already in the CRM stay.`);
  };

  // ── Forms ───────────────────────────────────────────────────────────────────
  const updateForm = async (f: Form, patch: Partial<Pick<Form, 'active' | 'course'>>, okText: string) => {
    if (formBusy[f.form_id]) return;
    setFormBusy((b) => ({ ...b, [f.form_id]: true }));
    setForms((l) => l.map((x) => (x.form_id === f.form_id ? { ...x, ...patch } : x)));
    const { error } = await supabase().from('meta_form').update(patch).eq('form_id', f.form_id);
    setFormBusy((b) => ({ ...b, [f.form_id]: false }));
    if (error) {
      setForms((l) => l.map((x) => (x.form_id === f.form_id ? { ...x, active: f.active, course: f.course } : x)));
      toast(friendlyError(error, 'lead forms'), { tone: 'bad' }); return;
    }
    toast(okText);
  };

  const setTarget = async (f: Form, key: string, target: string) => {
    const k = `${f.form_id}|${key}`;
    if (mapPending.current.has(k)) return;
    mapPending.current.add(k); bump((n) => n + 1);
    const had = Object.prototype.hasOwnProperty.call(maps, k);
    const was = maps[k];
    setMaps((m) => ({ ...m, [k]: target }));
    const { error } = await supabase().from('meta_field_map').upsert({ form_id: f.form_id, meta_key: key, target }, { onConflict: 'form_id,meta_key' });
    mapPending.current.delete(k); bump((n) => n + 1);
    if (error) {
      setMaps((m) => { const n = { ...m }; if (had) n[k] = was; else delete n[k]; return n; });
      toast(friendlyError(error, 'where answers go'), { tone: 'bad' });
    }
  };

  const backfill = async (f: Form) => {
    if (backfilling) return;
    setBackfilling(f.form_id);
    const r = await callApi<{ found?: number; queued?: number }>('/api/meta/backfill', { form_id: f.form_id, days: 7 });
    setBackfilling(null);
    if (!r.ok) { toast(r.error, { tone: 'bad' }); return; }
    const found = r.data.found ?? 0, queued = r.data.queued ?? 0;
    toast(found === 0 ? 'No leads in the last 7 days on this form.'
      : `Found ${found}, added ${queued}.${queued ? ' They appear in Recent leads within a minute.' : ' The rest were already here.'}`);
    loadLeads();
    // the leads are saved in the background: look again shortly so they show without pressing Refresh
    if (queued) { setTimeout(() => { load(); }, 5000); setTimeout(() => { load(); }, 15000); }
  };

  // ── Recent leads ────────────────────────────────────────────────────────────
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    const [l, pf] = await Promise.all([loadLeads(), loadPagesForms()]);
    setRefreshing(false);
    const err = l || pf;
    if (err) toast(friendlyError(err), { tone: 'bad' });
  };

  const retry = async (l: MetaLead) => {
    if (retrying) return;
    setRetrying(l.leadgen_id);
    const { data, error } = await supabase().from('meta_lead')
      .update({ status: 'Pending', attempts: 0, next_try_at: new Date().toISOString(), last_error: null })
      .eq('leadgen_id', l.leadgen_id).eq('status', 'Failed').select('leadgen_id');
    setRetrying(null);
    if (error) { toast(friendlyError(error, 'Meta leads'), { tone: 'bad' }); return; }
    if (!data?.length) { toast('This lead is already being tried again.'); loadLeads(); return; }
    setLeads((ls) => ls.map((x) => (x.leadgen_id === l.leadgen_id ? { ...x, status: 'Pending', attempts: 0, last_error: null } : x)));
    toast('Trying again. It should appear within a minute.');
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const header = (
    <PageHeader title="Meta lead forms" group="Admin settings"
      description="Leads from your Facebook and Instagram lead forms arrive here by themselves, within seconds." />
  );

  if (!loaded) {
    return (
      <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:px-6 md:py-4" aria-busy="true">
        {header}
        <span className="sr-only" role="status">Loading…</span>
        <div className="grid gap-2 sm:grid-cols-3">{[0, 1, 2].map((i) => <Bone key={i} className="h-14 w-full" />)}</div>
        <div className="flex flex-col gap-3 rounded-[14px] bg-surface p-4 shadow-1">
          <Bone className="h-5 w-40" />{[0, 1, 2].map((i) => <Bone key={i} className="h-10 w-full" />)}
        </div>
        <div className="flex flex-col gap-2 rounded-[14px] bg-surface p-4 shadow-1">
          {[0, 1, 2].map((i) => <div key={i} className="flex items-center gap-3"><Bone className="h-4 w-32" /><Bone className="h-4 flex-1" /><Bone className="h-8 w-24" /></div>)}
        </div>
      </main>
    );
  }

  if (loadErr) {
    return (
      <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:px-6 md:py-4">
        {header}
        <div className="flex flex-col items-start gap-3 rounded-[14px] bg-surface p-4 shadow-1">
          <Notice tone="bad">Could not load Meta lead forms. {loadErr}</Notice>
          <Button variant="primary" className={btn} onClick={() => { setLoaded(false); load(); }}>Try again</Button>
        </div>
      </main>
    );
  }

  const steps = [
    { n: 1, label: 'Meta app saved', done: appSaved },
    { n: 2, label: 'Facebook connected', done: pages.length > 0 },
    { n: 3, label: 'Receiving leads', done: receivingCount > 0 && !!app?.webhook_ok },
  ];
  const next = !appSaved ? 'Next: make the Meta app and save it in step 1.'
    : !pages.length ? 'Next: press “Connect Facebook” in step 2.'
    : !receivingCount ? 'Next: switch on “Receiving leads” for your page below.'
    : !app?.webhook_ok ? 'Not yet: Meta cannot send leads to the CRM (see the webhook note in step 1). Leads can still be fetched with “Fetch leads from the last 7 days”.'
    : 'All set. New leads arrive by themselves. Check “Recent leads from Meta” after your next ad lead.';

  const formName = Object.fromEntries(forms.map((f) => [f.form_id, f.name]));
  const callbackUrl = `${origin}/api/meta/callback`;
  const webhookUrl = `${origin}/api/meta/webhook`;
  const showForm = canEdit && (editingApp || !appSaved);

  const targetOptions = (current: string | undefined) => {
    const opts: { value: string; label: string }[] = [
      { value: 'course', label: 'Course' },
      { value: 'city', label: 'City' },
      ...customFields.map((c) => ({ value: `custom:${c.key}`, label: c.label })),
      { value: 'notes', label: 'Add to notes' },
      { value: 'ignore', label: 'Don’t save' },
    ];
    if (current && !opts.some((o) => o.value === current)) opts.splice(opts.length - 2, 0, { value: current, label: `${current.replace(/^custom:/, '')} (field removed)` });
    return opts;
  };

  return (
    <main className="flex flex-1 flex-col gap-5 overflow-y-auto p-4 md:px-6 md:py-4">
      {header}
      {!canEdit && <Notice tone="warn">View only. Only Admin can change Meta lead forms.</Notice>}

      {/* Progress */}
      <section aria-label="Setup progress" className="flex flex-col gap-2" data-testid="meta-progress">
        <ol className="grid gap-2 sm:grid-cols-3">
          {steps.map((st) => (
            <li key={st.n} className={cx('flex items-center gap-3 rounded-[12px] px-3 py-2.5 shadow-1', st.done ? 'bg-goodBg' : 'bg-surface')}>
              <span aria-hidden className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold', st.done ? 'bg-goodText text-white dark:text-[#14301F]' : 'border border-line2 text-text2')}>
                {st.done ? <Check size={15} strokeWidth={3} /> : st.n}
              </span>
              <span className="min-w-0">
                <span className={cx('block text-[13.5px] font-semibold', st.done ? 'text-goodText' : 'text-text')}>{st.label}</span>
                <span className={cx('block text-[12px]', st.done ? 'text-goodText' : 'text-muted')}>{st.done ? 'Done' : 'Not yet'}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="text-[13px] font-medium text-text2" role="status">{next}</p>
      </section>

      {/* Step 1: Meta app */}
      <section aria-labelledby="meta-step1" className="flex flex-col gap-3 rounded-[14px] bg-surface p-4 shadow-1" data-testid="meta-app">
        <SectionTitle aside={appSaved && canEdit && !editingApp ? <Button size="sm" variant="quiet" className={btn} onClick={openAppForm}>Change</Button> : undefined}>
          <span id="meta-step1">Step 1 · Meta app</span>
        </SectionTitle>

        {appSaved && !editingApp && (
          <div className="flex flex-col gap-1.5 text-[13.5px]">
            <div><span className="text-text2">App ID</span> <span className="ml-1 font-mono font-medium">{app!.app_id}</span></div>
            <div><span className="text-text2">App secret</span> <span className="ml-1 font-medium">Saved</span> <span className="text-[12px] text-muted">(never shown)</span></div>
            {app!.login_config_id && <div><span className="text-text2">Configuration ID</span> <span className="ml-1 font-mono font-medium">{app!.login_config_id}</span></div>}
            <div data-testid="meta-webhook-state">
              {app!.webhook_ok ? <span className="inline-flex items-center gap-1.5 rounded-full bg-goodBg px-2.5 py-[3px] text-[12.5px] font-semibold text-goodText"><Check size={14} aria-hidden />Webhook ready</span>
                : app!.webhook_error ? <span className="text-[13px] font-medium text-badText">Webhook not working: {plainMessage(app!.webhook_error, 'Meta did not accept it.')} Press Change and save again.</span>
                : <span className="text-[13px] text-warnText">Webhook not set up yet. Press Change and save again.</span>}
            </div>
          </div>
        )}
        {appResult && !editingApp && <Notice tone={appResult.ok ? 'good' : 'bad'}>{appResult.text}</Notice>}

        {!appSaved && (
          <div className="rounded-[12px] border border-line bg-bg px-3 py-1">
            <Fold id="meta-howto" open={howOpen} onToggle={() => setHowOpen(!howOpen)} label="How to make the app (once, about 10 minutes)" />
            {howOpen && (
              <ol id="meta-howto" className="list-decimal space-y-1.5 pb-3 pl-6 pr-1 text-[13.5px] text-text2">
                <li>Open <b className="text-text">developers.facebook.com</b> → <b className="text-text">My Apps</b> → <b className="text-text">Create app</b>. Choose the use case <b className="text-text">“Capture &amp; manage ad leads”</b>, app type <b className="text-text">Business</b>, name it <b className="text-text">“Stint CRM”</b>, and connect your Business portfolio.</li>
                <li><b className="text-text">Facebook Login for Business</b> is added by itself. Open it → <b className="text-text">Settings</b> → <b className="text-text">Valid OAuth Redirect URIs</b>: paste the <b className="text-text">Sign-in return address</b> shown below → Save.</li>
                <li>Facebook Login for Business → <b className="text-text">Configurations</b> → <b className="text-text">Create configuration</b>: login type <b className="text-text">“User access token”</b>; tick pages_show_list, pages_read_engagement, pages_manage_metadata, pages_manage_ads, leads_retrieval, ads_management, ads_read and business_management; choose your page; Save, then copy the <b className="text-text">Configuration ID</b>.</li>
                <li>Add the product <b className="text-text">Webhooks</b>. The CRM fills in the address for you.</li>
                <li><b className="text-text">App settings</b> → <b className="text-text">Basic</b>: copy the <b className="text-text">App ID</b> and <b className="text-text">App secret</b>.</li>
                <li>Paste the App ID, App secret and Configuration ID below, and press Save.</li>
                <li>Only if lead access was customised: <b className="text-text">Business Settings</b> → <b className="text-text">Integrations</b> → <b className="text-text">Leads Access</b> → your page → <b className="text-text">CRMs</b>: add “Stint CRM”.</li>
              </ol>
            )}
          </div>
        )}

        {(showForm || (appSaved && !editingApp)) && origin && (
          showForm ? (
            <div className="flex flex-col gap-3">
              <CopyLine label="Sign-in return address" value={callbackUrl} />
              <CopyLine label="Webhook address" value={webhookUrl} note="The CRM sets the webhook up for you; it is shown only in case Meta asks." />
            </div>
          ) : (
            <div className="rounded-[12px] border border-line bg-bg px-3 py-1">
              <Fold id="meta-addresses" open={addrOpen} onToggle={() => setAddrOpen(!addrOpen)} label="Addresses for Meta" />
              {addrOpen && (
                <div id="meta-addresses" className="flex flex-col gap-3 pb-3">
                  <CopyLine label="Sign-in return address" value={callbackUrl} />
                  <CopyLine label="Webhook address" value={webhookUrl} note="The CRM sets the webhook up for you; it is shown only in case Meta asks." />
                </div>
              )}
            </div>
          )
        )}

        {showForm && (
          <form className="flex flex-col gap-3 rounded-[12px] border border-line bg-bg p-3" aria-label="Save the Meta app" onSubmit={(e) => { e.preventDefault(); saveApp(); }}>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="flex min-w-0 flex-col gap-1 text-[13px] font-medium">App ID
                <input className={field} value={appForm.app_id} inputMode="numeric" autoComplete="off" spellCheck={false} placeholder="e.g. 1234567890123456"
                  aria-invalid={!!appErr || undefined} aria-describedby={appErr ? 'meta-app-err' : undefined}
                  onChange={(e) => { setAppForm({ ...appForm, app_id: e.target.value }); if (appErr) setAppErr(''); }} />
              </label>
              <div className="flex min-w-0 flex-col gap-1 text-[13px] font-medium">
                {changeSecret || !appSaved ? (
                  <label className="flex min-w-0 flex-col gap-1">App secret
                    <input className={field} type="password" value={appForm.app_secret} autoComplete="new-password" spellCheck={false}
                      placeholder={appSaved ? 'Leave empty to keep the saved one' : 'Paste the App secret'}
                      onChange={(e) => { setAppForm({ ...appForm, app_secret: e.target.value }); if (appErr) setAppErr(''); }} />
                  </label>
                ) : (
                  <>
                    <span>App secret</span>
                    <div className="flex h-11 items-center gap-2 md:h-9">
                      <span className="inline-flex items-center gap-1 text-[13.5px] font-medium text-goodText"><Check size={14} aria-hidden />Saved</span>
                      <Button size="sm" variant="link" className={btn} onClick={() => setChangeSecret(true)}>Change</Button>
                    </div>
                  </>
                )}
              </div>
              <label className="flex min-w-0 flex-col gap-1 text-[13px] font-medium">Configuration ID (from step 3)
                <input className={field} value={appForm.login_config_id} inputMode="numeric" autoComplete="off" spellCheck={false} aria-describedby="meta-config-hint"
                  onChange={(e) => setAppForm({ ...appForm, login_config_id: e.target.value })} />
                <span id="meta-config-hint" className="text-[12px] font-normal text-muted">Leave empty only if Meta did not ask you to create a configuration.</span>
              </label>
            </div>
            {appErr && <p id="meta-app-err" role="alert" className="text-[12.5px] font-medium text-badText">{appErr}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" className={btn} loading={savingApp}>Save</Button>
              {appSaved && <Button variant="outline" className={btn} disabled={savingApp} onClick={() => { setEditingApp(false); setAppErr(''); }}>Cancel</Button>}
            </div>
          </form>
        )}
        {!canEdit && !appSaved && <p className="text-[13px] text-muted">Not set up yet.</p>}
      </section>

      {/* Step 2: Connect Facebook */}
      <section aria-labelledby="meta-step2" className="flex flex-col gap-3 rounded-[14px] bg-surface p-4 shadow-1" data-testid="meta-connect">
        <SectionTitle><span id="meta-step2">Step 2 · Connect Facebook</span></SectionTitle>
        {connectNote && <Notice tone={connectNote.tone}>{connectNote.text}</Notice>}
        <p className="text-[13px] text-text2">
          {pages.length ? 'Connected. Connect again to add another page or to fix a page that stopped working.'
            : 'Sign in with the Facebook account that manages your page, and pick the page you advertise from.'}
        </p>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" size="lg" className="h-11" leftIcon={<Facebook size={16} />} loading={connecting} disabled={!appSaved} onClick={connect}>
              {pages.length ? 'Connect Facebook again' : 'Connect Facebook'}
            </Button>
            {!appSaved && <span className="text-[12.5px] text-muted">Save the Meta app in step 1 first.</span>}
          </div>
        )}
      </section>

      {/* Pages and their forms */}
      <section aria-labelledby="meta-pages" className="flex flex-col gap-2" data-testid="meta-pages">
        <SectionTitle aside={pages.length ? <span className="text-[12.5px] text-muted">{receivingCount} of {pages.length} receiving leads</span> : undefined}>
          <span id="meta-pages">Pages and lead forms</span>
        </SectionTitle>
        {pages.length === 0 ? (
          <EmptyState title="No pages connected yet" body="After step 2, your Facebook pages and their lead forms show here." />
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Connected Facebook pages">
            {pages.map((p) => {
              const busy = pageBusy[p.page_id];
              const pageForms = forms.filter((f) => f.page_id === p.page_id);
              return (
                <li key={p.page_id} data-page={p.page_id} className="flex flex-col rounded-[14px] bg-surface shadow-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-3">
                    <div className="min-w-0 flex-1 basis-[220px]">
                      <div className="break-words text-[14.5px] font-semibold">{p.name}</div>
                      <div className="text-[12.5px] text-muted">{p.last_lead_at ? `Last lead ${when(p.last_lead_at)}` : 'No leads yet'}</div>
                      {p.last_error && (
                        <div className="mt-1 text-[12.5px] text-badText" role="alert">
                          {plainMessage(p.last_error, 'Meta stopped sending leads from this page.')} Fix it with “Connect Facebook again” above.
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Switch on={p.receiving} words={['Receiving leads', 'Not receiving']} label={`Receive leads from ${p.name}`} disabled={!canEdit || !!busy} onClick={() => toggleReceiving(p)} />
                      {canEdit && (
                        <>
                          <Button size="sm" variant="outline" className={btn} leftIcon={<RefreshCw size={14} />} loading={busy === 'sync'} disabled={!!busy && busy !== 'sync'} onClick={() => syncPage(p)}>Refresh forms</Button>
                          <Confirm title={`Disconnect ${p.name}?`} yes="Disconnect" onYes={() => disconnect(p)} disabled={!!busy} ariaLabel={`Disconnect ${p.name}`}
                            body="Leads from this page will stop. The leads already in the CRM stay."
                            className="inline-flex h-11 items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] font-medium text-badText hover:bg-badBg disabled:opacity-50 md:h-9">
                            <Unplug size={14} aria-hidden />{busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
                          </Confirm>
                        </>
                      )}
                    </div>
                  </div>

                  {pageForms.length === 0 ? (
                    <p className="px-3 py-3 text-[13px] text-text2">No lead forms found on this page. Make one in Meta, then press “Refresh forms”.</p>
                  ) : (
                    <ul className="flex flex-col" aria-label={`Lead forms on ${p.name}`}>
                      {pageForms.map((f) => {
                        const st = formStatus(f.status);
                        const open = !!openMap[f.form_id];
                        const mapId = `meta-map-${f.form_id}`;
                        const courseId = `meta-course-${f.form_id}`;
                        const custom = f.questions.filter((q) => !(q.key in STANDARD));
                        const courseMissing = f.course && !courses.includes(f.course);
                        return (
                          <li key={f.form_id} data-form={f.form_id} className={cx('flex flex-col gap-2 border-b border-line px-3 py-3 last:border-b-0', !f.active && 'bg-bg')}>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                              <div className="min-w-0 flex-1 basis-[200px]">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="break-words text-[14px] font-medium">{f.name}</span>
                                  {st && <span className={cx('rounded-full px-2 py-[2px] text-[11.5px] font-semibold', st.tone)}>{st.word}</span>}
                                </div>
                                <div className="text-[12.5px] text-muted">
                                  {!f.active ? 'Off: leads from this form are skipped' : f.last_lead_at ? `Last lead ${when(f.last_lead_at)}` : 'No leads yet'}
                                </div>
                              </div>
                              <Switch on={f.active} label={`Take leads from the form ${f.name}`} disabled={!canEdit || !!formBusy[f.form_id]}
                                onClick={() => updateForm(f, { active: !f.active }, f.active ? `${f.name} is off. Its leads are skipped.` : `${f.name} is on.`)} />
                            </div>

                            <div className="flex flex-wrap items-end gap-2">
                              <label htmlFor={courseId} className="flex min-w-0 flex-1 basis-[240px] flex-col gap-1 text-[12.5px] font-medium text-text2">Every lead from this form is for
                                <select id={courseId} className={field} value={f.course || ''} disabled={!canEdit || !!formBusy[f.form_id]}
                                  onChange={(e) => { const v = e.target.value || null; updateForm(f, { course: v }, v ? `Leads from ${f.name} are now for ${v}.` : `Leads from ${f.name} use the course they pick on the form.`); }}>
                                  <option value="">The course they pick on the form</option>
                                  {courses.map((c) => <option key={c} value={c}>{c}</option>)}
                                  {courseMissing && <option value={f.course!}>{f.course} (not in the course list)</option>}
                                </select>
                              </label>
                              {canEdit && (
                                <Button size="sm" variant="outline" className={btn} loading={backfilling === f.form_id} disabled={!!backfilling && backfilling !== f.form_id} onClick={() => backfill(f)}>
                                  Fetch leads from the last 7 days
                                </Button>
                              )}
                            </div>

                            <div className="rounded-[10px] border border-line px-2">
                              <Fold id={mapId} open={open} onToggle={() => setOpenMap((m) => ({ ...m, [f.form_id]: !open }))}
                                label={<>Where each answer goes <span className="font-normal text-muted">({f.questions.length} question{f.questions.length === 1 ? '' : 's'})</span></>} />
                              {open && (
                                <div id={mapId} className="pb-2">
                                  {f.questions.length === 0 ? (
                                    <p className="px-1 pb-1 text-[13px] text-text2">No questions found. Press “Refresh forms” on the page above.</p>
                                  ) : (
                                    <ul className="flex flex-col" aria-label={`Questions on ${f.name}`}>
                                      {f.questions.map((q) => {
                                        const k = `${f.form_id}|${q.key}`;
                                        const std = STANDARD[q.key];
                                        const selId = `meta-q-${f.form_id}-${q.key}`.replace(/[^\w-]+/g, '-');
                                        const current = maps[k] || 'notes';
                                        return (
                                          <li key={q.key} className="flex flex-col gap-1 border-t border-line py-2 first:border-t-0 sm:flex-row sm:items-center sm:gap-3">
                                            <label htmlFor={std ? undefined : selId} className="min-w-0 flex-1 break-words text-[13px]">{q.label || q.key.replace(/_/g, ' ')}</label>
                                            {std ? (
                                              <span className="text-[12.5px] text-muted sm:w-[240px] sm:shrink-0">Saved automatically as {std}</span>
                                            ) : (
                                              <select id={selId} className={cx(field, 'sm:w-[240px] sm:shrink-0')} value={current} disabled={!canEdit || mapPending.current.has(k)}
                                                aria-busy={mapPending.current.has(k) || undefined} onChange={(e) => setTarget(f, q.key, e.target.value)}>
                                                {targetOptions(current).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                              </select>
                                            )}
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  )}
                                  {custom.length > 0 && <p className="px-1 pt-1 text-[12px] text-muted">Changes apply to new leads. Answers you don’t place go into the lead’s notes.</p>}
                                </div>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Recent leads */}
      <section aria-labelledby="meta-log" className="flex flex-col gap-2" data-testid="meta-log">
        <SectionTitle aside={<Button size="sm" variant="outline" className={btn} leftIcon={<RefreshCw size={14} />} loading={refreshing} onClick={refresh}>Refresh</Button>}>
          <span id="meta-log">Recent leads from Meta</span>
        </SectionTitle>
        <p className="text-[12.5px] text-text2">New leads usually appear within seconds. Anything that fails is retried by itself up to five times.</p>
        {leads.length === 0 ? (
          <EmptyState title="No leads yet" body="Send a test lead with Meta’s Lead Ads Testing Tool (developers.facebook.com/tools/lead-ads-testing)." />
        ) : (
          <>
            <ul className="flex flex-col gap-2 md:hidden" aria-label="Recent leads from Meta">
              {leads.map((l) => (
                <li key={l.leadgen_id} data-testid="meta-lead" className="rounded-[12px] bg-surface p-3 shadow-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="break-words font-medium">{(l.form_id && formName[l.form_id]) || 'A lead form'}</div>
                      <div className="text-[12.5px] text-muted">{when(l.received_at)}</div>
                    </div>
                    <StatusWord l={l} />
                  </div>
                  {l.last_error && l.status !== 'Done' && <div className={cx('mt-1 break-words text-[12.5px]', l.status === 'Failed' ? 'text-badText' : 'text-text2')}>{plainMessage(l.last_error, 'The CRM could not save this lead.')}</div>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {l.lead_id && <Link href={`/p/lead?person=lead:${l.lead_id}`} className="inline-flex h-11 items-center gap-1.5 rounded-[10px] border border-line2 px-3 text-[13px] font-medium hover:bg-surface2"><ExternalLink size={14} aria-hidden />Open lead</Link>}
                    {l.status === 'Failed' && canEdit && <Button size="sm" variant="outline" className="h-11" leftIcon={<RotateCcw size={14} />} loading={retrying === l.leadgen_id} onClick={() => retry(l)}>Retry</Button>}
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table label="Recent leads from Meta">
                <THead><Th>When</Th><Th>Form</Th><Th>Status</Th><Th className="w-[220px]" /></THead>
                <TBody>
                  {leads.map((l) => (
                    <Tr key={l.leadgen_id} data-testid="meta-lead">
                      <Td className="whitespace-nowrap text-text2">{when(l.received_at)}</Td>
                      <Td className="max-w-[260px] truncate font-medium" title={(l.form_id && formName[l.form_id]) || undefined}>{(l.form_id && formName[l.form_id]) || 'A lead form'}</Td>
                      <Td>
                        <div className="py-1.5">
                          <StatusWord l={l} />
                          {l.last_error && l.status !== 'Done' && <div className={cx('mt-1 max-w-[360px] break-words text-[12px]', l.status === 'Failed' ? 'text-badText' : 'text-text2')}>{plainMessage(l.last_error, 'The CRM could not save this lead.')}</div>}
                        </div>
                      </Td>
                      <Td>
                        <div className="flex items-center justify-end gap-1.5">
                          {l.lead_id && <Link href={`/p/lead?person=lead:${l.lead_id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-accentText hover:bg-surface2"><ExternalLink size={14} aria-hidden />Open lead</Link>}
                          {l.status === 'Failed' && canEdit && <Button size="sm" variant="outline" leftIcon={<RotateCcw size={14} />} loading={retrying === l.leadgen_id} onClick={() => retry(l)}>Retry</Button>}
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          </>
        )}
        <p className="text-[12.5px] text-muted">
          Test with Meta’s Lead Ads Testing Tool. If leads from the public do not arrive but your test leads do, Meta wants the app reviewed — ask for help.
        </p>
      </section>
    </main>
  );
}
