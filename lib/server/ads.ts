import 'server-only';
import crypto from 'node:crypto';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { GRAPH } from './meta';
import { asCaller } from './recordings';

// Ad conversions (contract: docs/ads-tracking-contract.md, migration 20261004000101).
// The database queues one ad_conversion row per lead and rule (triggers only). This file:
//   - sends due Meta rows to the Meta Conversions API (/api/ads/send, every minute),
//   - builds the Google Ads scheduled-upload CSV (/api/ads/google-feed),
//   - hashes email and phone (SHA-256 of the normalised value) — they never leave the server in plain text.
// Logs and last_error never carry an email, phone, token or IP: only row ids and the kind of problem.

export type AdSettings = {
  meta_enabled: boolean; meta_dataset_id: string | null; meta_capi_token: string | null; meta_test_event_code: string | null;
  google_enabled: boolean; google_feed_user: string; google_feed_password: string | null; google_feed_days: number; last_feed_at: string | null;
};

export async function getSettings(db: SupabaseClient): Promise<AdSettings | null> {
  const { data, error } = await db.from('ad_settings')
    .select('meta_enabled, meta_dataset_id, meta_capi_token, meta_test_event_code, google_enabled, google_feed_user, google_feed_password, google_feed_days, last_feed_at')
    .eq('id', 1).maybeSingle();
  if (error) console.error('[ads] read settings failed', error.code || '');
  return (data as AdSettings) || null;
}
export const metaReady = (s: AdSettings | null) => !!(s?.meta_dataset_id?.trim() && s?.meta_capi_token?.trim());

/** Signed in (401) and allowed to change "Ad conversions" (403); otherwise the person. */
export async function requireAdsWriter(): Promise<{ user: User } | NextResponse> {
  const caller = await asCaller();
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const { data: allowed } = await caller.rpc('can_page', { p: 'ads', need: 'w' });
  if (allowed !== true) return NextResponse.json({ error: 'Only someone who can change Ad conversions can do this.' }, { status: 403 });
  return { user };
}

// ---------- Hashing ----------
export const sha256 = (v: string) => crypto.createHash('sha256').update(v, 'utf8').digest('hex');

/** Email: trimmed, lower case. Null when it is not an email. */
export function normEmail(v: unknown): string | null {
  const e = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}
/** Phone: digits only with the country code (91 added to a 10-digit Indian number, a leading 0 dropped). */
export function normPhone(v: unknown): string | null {
  let d = typeof v === 'string' ? v.replace(/\D/g, '') : '';
  if (/^0\d{10}$/.test(d)) d = d.slice(1);
  if (/^\d{10}$/.test(d)) d = '91' + d;
  return /^\d{11,15}$/.test(d) ? d : null;
}
/** Google: phone in E.164 (+91…), gmail addresses without dots before the @ (Google's own normalising rules). */
const googleEmail = (v: unknown) => {
  const e = normEmail(v);
  if (!e) return null;
  const [local, domain] = e.split('@');
  return /^(gmail|googlemail)\.com$/.test(domain) ? local.replace(/\./g, '').replace(/\+.*$/, '') + '@' + domain : e;
};
const googlePhone = (v: unknown) => { const p = normPhone(v); return p ? '+' + p : null; };

/** Never store something that looks like an email, phone, token or IP in last_error. */
export function cleanError(msg: string, secrets: (string | null | undefined)[] = []): string {
  let m = String(msg || '');
  for (const s of secrets) if (s) m = m.split(s).join('…');
  return m.replace(/[^\s@]+@[^\s@]+/g, '[email]').replace(/\d[\d\s-]{6,}\d/g, '[number]').replace(/\b[0-9a-f]{32,}\b/gi, '[id]').slice(0, 200);
}

// ---------- Meta Conversions API ----------
type Row = { id: string; lead_id: string; rule_id: string | null; event_name: string; event_id: string; event_time: string; value: number | string | null; currency: string; attempts: number };
type Click = { lead_id: string; ad_consent: boolean; fbc: string | null; fbp: string | null; client_ip: string | null; user_agent: string | null; landing_url: string | null; web_event_id: string | null };
type LeadRow = { id: string; email: string | null; mobile: string | null };

const ROW_COLS = 'id, lead_id, rule_id, event_name, event_id, event_time, value, currency, attempts';
const BACKOFF_MIN = [1, 5, 30, 120];
const MAX_ATTEMPTS = 5, STUCK_MS = 5 * 60_000, PARALLEL = 4, WEEK_MS = 7 * 86_400_000;

export class AdsError extends Error { constructor(message: string, public code?: number, public status?: number) { super(message); } }

async function graphVersion(db: SupabaseClient) {
  const { data } = await db.from('meta_app').select('graph_version').eq('id', 1).maybeSingle();
  return String(data?.graph_version || 'v25.0');
}

/** POST events to the dataset. Throws AdsError with a plain message (never the token). */
export async function postEvents(s: AdSettings, version: string, events: Record<string, unknown>[]) {
  const token = s.meta_capi_token!.trim();
  const url = `${GRAPH}/${version}/${encodeURIComponent(s.meta_dataset_id!.trim())}/events?access_token=${encodeURIComponent(token)}`;
  const body: Record<string, unknown> = { data: events };
  if (s.meta_test_event_code?.trim()) body.test_event_code = s.meta_test_event_code.trim();
  let res: Response;
  try {
    // Meta wants the lead form id as a number: written into the JSON as digits, so it is never rounded
    const json = JSON.stringify(body).replace(/"lead_id":"(\d{1,20})"/g, '"lead_id":$1');
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new AdsError((e as Error)?.name === 'TimeoutError' ? 'Meta did not answer in time.' : 'Could not reach Meta.');
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out?.error) {
    const err = out?.error || {};
    const code = typeof err.code === 'number' ? err.code : undefined;
    let msg: string;
    if (code === 190) msg = 'Meta refused the access token (expired or removed). Make a new Conversions API token and save it.';
    else if (code === 10 || code === 200) msg = 'Meta refused: the token has no permission for this dataset.';
    else if (code === 4 || code === 17 || code === 32 || code === 613) msg = 'Meta is limiting requests right now. It will be retried.';
    else if (code === 100 && /does not exist|cannot be loaded|Unsupported post request/i.test(String(err.message))) msg = 'Meta cannot find that dataset id, or the token cannot use it.';
    else msg = 'Meta said: ' + String(err.error_user_msg || err.message || 'HTTP ' + res.status);
    throw new AdsError(cleanError(msg, [token]), code, res.status);
  }
  return out as { events_received?: number; fbtrace_id?: string };
}

/** One Meta event for a queued row. Null with a reason when it must not be sent. */
function buildEvent(r: Row, lead: LeadRow | undefined, click: Click | undefined, leadgenId: string | undefined, arrived: boolean, now: number): { event: Record<string, unknown> } | { skip: string } {
  if (!lead) return { skip: 'The lead was removed.' };
  if (!click?.ad_consent && !leadgenId) return { skip: 'No ad consent for this lead.' };
  let t = Date.parse(r.event_time);
  if (!Number.isFinite(t) || t > now) t = now;
  if (now - t > WEEK_MS) return { skip: 'Older than 7 days: Meta does not accept it.' };

  const em = normEmail(lead.email), ph = normPhone(lead.mobile);
  const user_data: Record<string, unknown> = { external_id: [sha256(lead.id)] };
  if (em) user_data.em = [sha256(em)];
  if (ph) user_data.ph = [sha256(ph)];
  if (click?.fbc) user_data.fbc = click.fbc;
  if (click?.fbp) user_data.fbp = click.fbp;
  if (click?.client_ip) user_data.client_ip_address = click.client_ip;
  if (click?.user_agent) user_data.client_user_agent = click.user_agent;
  if (leadgenId && /^\d{1,20}$/.test(leadgenId)) user_data.lead_id = leadgenId;   // sent as a number (see postEvents)

  // Meta needs the browser name for 'website' events; without it (lead-form lead, or cleared after 90 days) the CRM reports it.
  const website = !leadgenId && !!click?.user_agent;
  const event: Record<string, unknown> = {
    event_name: r.event_name,
    event_time: Math.floor(t / 1000),
    event_id: arrived && click?.web_event_id ? click.web_event_id : r.event_id,
    action_source: website ? 'website' : 'system_generated',
    user_data,
  };
  if (website && click?.landing_url) event.event_source_url = click.landing_url;
  const custom: Record<string, unknown> = {};
  if (r.value != null && Number(r.value) > 0) { custom.value = Number(r.value); custom.currency = r.currency || 'INR'; }
  else if (r.event_name === 'Purchase') return { skip: 'Purchase needs the fee amount, and this one has none.' };
  if (!website) { custom.lead_event_source = 'Stint CRM'; custom.event_source = 'crm'; }
  if (Object.keys(custom).length) event.custom_data = custom;
  return { event };
}

export type SendCounts = { sent: number; retrying: number; failed: number; skipped: number };

/** Send due Meta rows. Does nothing (rows stay Queued) when Meta is off or not set up. */
export async function sendDueMeta(db: SupabaseClient, opts: { limit?: number; budgetMs?: number } = {}): Promise<SendCounts & { off?: boolean }> {
  const counts: SendCounts = { sent: 0, retrying: 0, failed: 0, skipped: 0 };
  const started = Date.now(), budgetMs = opts.budgetMs ?? 90_000;
  const s = await getSettings(db);
  if (!s?.meta_enabled || !metaReady(s)) return { ...counts, off: true };

  const rows = await claim(db, Math.max(1, Math.min(opts.limit ?? 100, 100)), started);
  if (!rows.length) return counts;
  const leadIds = [...new Set(rows.map((r) => r.lead_id))];
  const ruleIds = [...new Set(rows.map((r) => r.rule_id).filter((x): x is string => !!x))];
  const [leadsRes, clicksRes, metaRes, rulesRes] = await Promise.all([
    db.from('lead').select('id, email, mobile').in('id', leadIds),
    db.from('lead_click').select('lead_id, ad_consent, fbc, fbp, client_ip, user_agent, landing_url, web_event_id').in('lead_id', leadIds),
    db.from('meta_lead').select('lead_id, leadgen_id').in('lead_id', leadIds),
    ruleIds.length ? db.from('ad_conversion_rule').select('id, trigger').in('id', ruleIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const ids = rows.map((r) => r.id);
  if (leadsRes.error || clicksRes.error || metaRes.error || rulesRes.error) {
    console.error('[ads] read leads failed', leadsRes.error?.code || clicksRes.error?.code || metaRes.error?.code || rulesRes.error?.code || '');
    await db.from('ad_conversion').update({ status: 'Queued', next_try_at: new Date(Date.now() + 60_000).toISOString() }).in('id', ids).eq('status', 'Sending');
    counts.retrying += ids.length;
    return counts;
  }
  const leads = new Map(((leadsRes.data || []) as LeadRow[]).map((l) => [l.id, l]));
  const clicks = new Map(((clicksRes.data || []) as Click[]).map((c) => [c.lead_id, c]));
  const leadgen = new Map(((metaRes.data || []) as { lead_id: string; leadgen_id: string }[]).map((m) => [m.lead_id, m.leadgen_id]));
  const arrivedRules = new Set(((rulesRes.data || []) as { id: string; trigger: string }[]).filter((r) => r.trigger === 'arrived').map((r) => r.id));
  const version = await graphVersion(db);

  const settle = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await db.from('ad_conversion').update(patch).eq('id', id).eq('status', 'Sending');
    if (error) console.error(`[ads] row ${id}: save result failed`, error.code || '');
  };

  async function handle(r: Row) {
    const built = buildEvent(r, leads.get(r.lead_id), clicks.get(r.lead_id), leadgen.get(r.lead_id), !!r.rule_id && arrivedRules.has(r.rule_id), Date.now());
    if ('skip' in built) {
      counts.skipped++;
      return settle(r.id, { status: 'Skipped', last_error: built.skip });
    }
    try {
      await postEvents(s!, version, [built.event]);
      counts.sent++;
      return settle(r.id, { status: 'Sent', sent_at: new Date().toISOString(), attempts: (r.attempts || 0) + 1, last_error: null });
    } catch (e) {
      const msg = e instanceof AdsError ? e.message : 'Something went wrong while sending.';
      const attempts = (r.attempts || 0) + 1;
      console.error(`[ads] row ${r.id}: send failed (${e instanceof AdsError ? e.code ?? e.status ?? 'network' : 'unexpected'})`);
      if (attempts >= MAX_ATTEMPTS) { counts.failed++; return settle(r.id, { status: 'Failed', attempts, last_error: msg }); }
      counts.retrying++;
      return settle(r.id, { status: 'Queued', attempts, last_error: msg, next_try_at: new Date(Date.now() + BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60_000).toISOString() });
    }
  }

  const notStarted: string[] = [];
  let next = 0;
  async function worker() {
    while (next < rows.length) {
      const r = rows[next++];
      if (Date.now() - started > budgetMs) { notStarted.push(r.id); continue; }
      try { await handle(r); } catch { console.error(`[ads] row ${r.id}: failed (unexpected)`); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, rows.length) }, worker));
  if (notStarted.length) {
    await db.from('ad_conversion').update({ status: 'Queued', next_try_at: new Date().toISOString() }).in('id', notStarted).eq('status', 'Sending');
    counts.retrying += notStarted.length;
  }
  return counts;
}

/** Take due rows (Queued and due, or Sending and stuck 5+ minutes). Only rows the UPDATE returned are ours, so two
 *  overlapping runs never send the same row (same claiming rule as /api/meta/process). */
async function claim(db: SupabaseClient, limit: number, started: number): Promise<Row[]> {
  const nowIso = new Date(started).toISOString(), stuckIso = new Date(started - STUCK_MS).toISOString();
  const { data: due, error } = await db.from('ad_conversion').select('id, status').eq('platform', 'meta')
    .or(`and(status.eq.Queued,next_try_at.lte."${nowIso}"),and(status.eq.Sending,next_try_at.lt."${stuckIso}")`)
    .order('next_try_at').limit(limit);
  if (error) { console.error('[ads] read queue failed', error.code || ''); return []; }
  if (!due?.length) return [];
  const queued = due.filter((r) => r.status === 'Queued').map((r) => r.id as string);
  const stuck = due.filter((r) => r.status === 'Sending').map((r) => r.id as string);
  const claimAt = new Date().toISOString();
  const empty = Promise.resolve({ data: [] as Row[], error: null });
  const [a, b] = await Promise.all([
    queued.length ? db.from('ad_conversion').update({ status: 'Sending', next_try_at: claimAt }).in('id', queued).eq('status', 'Queued').lte('next_try_at', nowIso).select(ROW_COLS) : empty,
    stuck.length ? db.from('ad_conversion').update({ status: 'Sending', next_try_at: claimAt }).in('id', stuck).eq('status', 'Sending').lt('next_try_at', stuckIso).select(ROW_COLS) : empty,
  ]);
  if (a.error || b.error) console.error('[ads] claim failed', a.error?.code || b.error?.code || '');
  return [...((a.data || []) as Row[]), ...((b.data || []) as Row[])];
}

/** "Send test event": one TestEvent to the dataset. Works while Meta is switched off, so the Admin can check first. */
export async function sendMetaTest(db: SupabaseClient): Promise<{ ok: boolean; message: string }> {
  const s = await getSettings(db);
  if (!metaReady(s)) return { ok: false, message: 'Enter the dataset id and save the Conversions API token first.' };
  const event = {
    event_name: 'TestEvent', event_time: Math.floor(Date.now() / 1000), event_id: 'test' + crypto.randomUUID().replace(/-/g, ''),
    action_source: 'system_generated', user_data: { external_id: [sha256('stint-crm-test')] },
    custom_data: { lead_event_source: 'Stint CRM', event_source: 'crm' },
  };
  try {
    const out = await postEvents(s!, await graphVersion(db), [event]);
    const where = s!.meta_test_event_code?.trim() ? 'Open Events Manager → your dataset → Test events to see it.' : 'Tip: set a test event code so it shows under Test events.';
    return { ok: true, message: `Meta received the test event (${out.events_received ?? 1}). ${where}` };
  } catch (e) {
    return { ok: false, message: e instanceof AdsError ? e.message : 'Could not send the test event.' };
  }
}

// ---------- Google Ads scheduled upload ----------
export const FEED_HEADER = 'Google Click ID,GBRAID,WBRAID,Email,Phone Number,Conversion Name,Conversion Time,Conversion Value,Conversion Currency,Order ID';
type GRow = { id: string; lead_id: string; rule_id: string | null; event_name: string; event_id: string; event_time: string; value: number | string | null; currency: string; status: string };

const csv = (v: unknown) => { const t = v == null ? '' : String(v); return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
/** yyyy-MM-dd HH:mm:ss in India time (the feed says TimeZone=Asia/Calcutta). */
const istTime = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3600_000).toISOString().replace('T', ' ').slice(0, 19);

/** The feed rows for the last `days` days. Only leads that gave ad consent, with a click id or an email/phone. */
export async function googleFeedRows(db: SupabaseClient, days: number) {
  const since = new Date(Date.now() - Math.max(1, Math.min(days, 90)) * 86_400_000).toISOString();
  const { data, error } = await db.from('ad_conversion').select('id, lead_id, rule_id, event_name, event_id, event_time, value, currency, status')
    .eq('platform', 'google').in('status', ['Queued', 'Sending', 'Sent']).gte('created_at', since).order('event_time', { ascending: false }).limit(10_000);
  if (error) throw new AdsError('Could not read the conversions.');
  const rows = (data || []) as GRow[];
  const leadIds = [...new Set(rows.map((r) => r.lead_id))];
  // the website's own Google Ads tag reports the lead with the browser's event id as its order id; reuse it so Google counts it once
  const arrived = new Set((((await db.from('ad_conversion_rule').select('id').eq('platform', 'google').eq('trigger', 'arrived')).data) || []).map((x: { id: string }) => x.id));
  const leads = new Map<string, LeadRow>(), clicks = new Map<string, { ad_consent: boolean; gclid: string | null; gbraid: string | null; wbraid: string | null; web_event_id: string | null }>();
  for (let i = 0; i < leadIds.length; i += 200) {
    const part = leadIds.slice(i, i + 200);
    const [l, c] = await Promise.all([
      db.from('lead').select('id, email, mobile').in('id', part),
      db.from('lead_click').select('lead_id, ad_consent, gclid, gbraid, wbraid, web_event_id').in('lead_id', part),
    ]);
    if (l.error || c.error) throw new AdsError('Could not read the leads.');
    for (const x of (l.data || []) as LeadRow[]) leads.set(x.id, x);
    for (const x of (c.data || []) as { lead_id: string; ad_consent: boolean; gclid: string | null; gbraid: string | null; wbraid: string | null; web_event_id: string | null }[]) clicks.set(x.lead_id, x);
  }
  const out: { id: string; status: string; line: string }[] = [];
  for (const r of rows) {
    const lead = leads.get(r.lead_id), click = clicks.get(r.lead_id);
    if (!lead || !click?.ad_consent) continue;
    const gclid = click.gclid || '', gbraid = gclid ? '' : click.gbraid || '', wbraid = gclid || gbraid ? '' : click.wbraid || '';
    const em = googleEmail(lead.email), ph = googlePhone(lead.mobile);
    if (!gclid && !gbraid && !wbraid && !em && !ph) continue;
    const value = r.value != null && Number(r.value) > 0 ? Number(r.value).toFixed(2) : '';
    out.push({ id: r.id, status: r.status, line: [gclid, gbraid, wbraid, em ? sha256(em) : '', ph ? sha256(ph) : '', r.event_name, istTime(r.event_time), value, value ? r.currency || 'INR' : '', (r.rule_id && arrived.has(r.rule_id) && click.web_event_id) || r.event_id].map(csv).join(',') });
  }
  return out;
}

export const feedCsv = (rows: { line: string }[]) => ['Parameters:TimeZone=Asia/Calcutta', FEED_HEADER, ...rows.map((r) => r.line)].join('\r\n') + '\r\n';
