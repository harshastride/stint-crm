import 'server-only';
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { matchOption, norm, str } from './incoming-lead';

// Meta (Facebook) lead forms, connected directly. Server only: the app secret and page tokens never leave the server
// and are never logged. META_GRAPH_URL can point at a stand-in Graph API for tests.
export const GRAPH = (process.env.META_GRAPH_URL || 'https://graph.facebook.com').replace(/\/+$/, '');
export const DIALOG = (process.env.META_DIALOG_URL || 'https://www.facebook.com').replace(/\/+$/, '');
/** Permissions the CRM asks for when the Admin presses "Connect Facebook". */
export const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'pages_manage_ads', 'leads_retrieval', 'ads_management', 'ads_read', 'business_management'];

export type MetaApp = { app_id: string | null; app_secret: string | null; login_config_id: string | null; verify_token: string; graph_version: string; webhook_ok: boolean };
export type MetaQuestion = { key: string; label?: string; type?: string; options?: { key?: string; value?: string }[] };
export type MetaForm = { form_id: string; page_id: string; name: string; active: boolean; course: string | null; questions: MetaQuestion[] };
export type MetaLeadData = {
  id: string; created_time?: string; form_id?: string; ad_id?: string; ad_name?: string; adset_id?: string; adset_name?: string;
  campaign_id?: string; campaign_name?: string; is_organic?: boolean; platform?: string;
  field_data?: { name: string; values?: string[] }[];
  custom_disclaimer_responses?: { checkbox_key?: string; is_checked?: string | boolean }[];
};

/** A Graph API problem in plain words; `code` is Meta's error code (e.g. 190 = token expired). Never contains a token. */
export class MetaError extends Error {
  constructor(message: string, public code?: number, public status?: number) { super(message); }
}

export async function getApp(db: SupabaseClient): Promise<MetaApp> {
  const { data } = await db.from('meta_app').select('app_id, app_secret, login_config_id, verify_token, graph_version, webhook_ok').eq('id', 1).single();
  return data as MetaApp;
}
export const appReady = (a: MetaApp | null) => !!(a?.app_id && a?.app_secret);
export const appToken = (a: MetaApp) => `${a.app_id}|${a.app_secret}`;

/** Call the Graph API. GET puts params in the query; POST/DELETE send them as a form body. */
export async function graph<T = Record<string, unknown>>(a: MetaApp, path: string, opts: { token?: string; method?: 'GET' | 'POST' | 'DELETE'; params?: Record<string, string | number | boolean> } = {}): Promise<T> {
  const method = opts.method || 'GET';
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.params || {})) q.set(k, String(v));
  if (opts.token) q.set('access_token', opts.token);
  if (opts.token && a.app_secret) q.set('appsecret_proof', crypto.createHmac('sha256', a.app_secret).update(opts.token).digest('hex'));
  const url = `${GRAPH}/${a.graph_version}/${path.replace(/^\/+/, '')}`;
  let res: Response;
  try {
    res = await fetch(method === 'GET' ? `${url}?${q}` : url, {
      method, signal: AbortSignal.timeout(15_000),
      ...(method === 'GET' ? {} : { body: q, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }),
    });
  } catch (e) {
    throw new MetaError((e as Error)?.name === 'TimeoutError' ? 'Facebook did not answer in time.' : 'Could not reach Facebook.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) {
    const err = body?.error || {};
    throw new MetaError(plainError(err.code, err.error_subcode, String(err.message || 'HTTP ' + res.status)), err.code, res.status);
  }
  return body as T;
}

/** Meta's error codes, said plainly (the raw message never includes a token, but it is cut short anyway). */
function plainError(code?: number, sub?: number, message = ''): string {
  if (code === 190) return 'The Facebook connection has expired or was removed. Press “Connect Facebook” again.';
  if (code === 10 || code === 200 || code === 299) return 'Facebook refused: a permission is missing. Press “Connect Facebook” again and allow every permission (and check Leads Access in Business Settings).';
  if (code === 100 && sub === 33) return 'Facebook could not find that item, or the app cannot see it.';
  if (code === 4 || code === 17 || code === 32 || code === 613) return 'Facebook is limiting requests right now. It will be retried.';
  return 'Facebook said: ' + message.slice(0, 160);
}

/** Webhook calls are signed by Meta with the app secret: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(raw body). */
export function signatureOk(raw: string, header: string | null, secret: string | null): boolean {
  if (!header || !secret) return false;
  const want = Buffer.from('sha256=' + crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex'));
  const got = Buffer.from(header);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/** The "Connect Facebook" address. Business apps use Facebook Login for Business: with a configuration id Meta takes the
 *  permissions from that configuration (no scope). Without one, the classic scope list is sent. */
export function loginUrl(a: MetaApp, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: String(a.app_id), redirect_uri: redirectUri, state, response_type: 'code' });
  if (a.login_config_id) q.set('config_id', a.login_config_id);
  else q.set('scope', SCOPES.join(','));
  return `${DIALOG}/${a.graph_version}/dialog/oauth?${q}`;
}

/** code → short-lived user token → long-lived user token (pages read with it get tokens that do not expire). */
export async function userTokenFromCode(a: MetaApp, code: string, redirectUri: string): Promise<string> {
  const short = await graph<{ access_token: string }>(a, 'oauth/access_token', { params: { client_id: String(a.app_id), client_secret: String(a.app_secret), redirect_uri: redirectUri, code } });
  const long = await graph<{ access_token: string }>(a, 'oauth/access_token', { params: { grant_type: 'fb_exchange_token', client_id: String(a.app_id), client_secret: String(a.app_secret), fb_exchange_token: short.access_token } });
  return long.access_token;
}

/** Pages the person manages, each with its own page token. */
type PageRow = { id: string; name: string; access_token: string };

/** Pages the person manages, each with its own page token. Facebook Login for Business often leaves /me/accounts empty
 *  (pages owned by a Business portfolio, or chosen in the "which Pages" step), so two more places are asked:
 *  1. the pages this sign-in was granted (debug_token → granular_scopes target ids), each read for its own token;
 *  2. pages owned by, or shared with, the person's businesses. Only pages that come back with a token are kept. */
export async function listPages(a: MetaApp, userToken: string): Promise<PageRow[]> {
  const found = new Map<string, PageRow>();
  const keep = (rows: Partial<PageRow>[] | undefined) => { for (const r of rows || []) if (r.id && r.access_token) found.set(r.id, { id: r.id, name: r.name || r.id, access_token: r.access_token }); };

  let after = '';
  for (let i = 0; i < 10; i++) {
    const r = await graph<{ data: PageRow[]; paging?: { cursors?: { after?: string }; next?: string } }>(a, 'me/accounts', { token: userToken, params: { fields: 'id,name,access_token', limit: 100, ...(after ? { after } : {}) } });
    keep(r.data);
    if (!r.paging?.next || !r.paging.cursors?.after) break;
    after = r.paging.cursors.after;
  }
  if (found.size) return [...found.values()];

  // 1. pages granted in this sign-in
  try {
    const dbg = await graph<{ data?: { granular_scopes?: { scope: string; target_ids?: string[] }[] } }>(a, 'debug_token', { token: appToken(a), params: { input_token: userToken } });
    const ids = new Set<string>();
    for (const g of dbg.data?.granular_scopes || []) if (/^pages_|^leads_retrieval$/.test(g.scope)) for (const t of g.target_ids || []) if (/^\d{1,30}$/.test(t)) ids.add(t);
    for (const id of [...ids].slice(0, 50)) {
      try { keep([await graph<PageRow>(a, id, { token: userToken, params: { fields: 'id,name,access_token' } })]); } catch { /* not a page, or no access */ }
    }
  } catch { /* debug_token not allowed: try businesses */ }
  if (found.size) return [...found.values()];

  // 2. pages of the person's businesses
  try {
    const biz = await graph<{ data?: { id: string }[] }>(a, 'me/businesses', { token: userToken, params: { fields: 'id', limit: 25 } });
    for (const b of (biz.data || []).slice(0, 10)) {
      for (const edge of ['owned_pages', 'client_pages']) {
        try { keep((await graph<{ data?: PageRow[] }>(a, `${b.id}/${edge}`, { token: userToken, params: { fields: 'id,name,access_token', limit: 100 } })).data); } catch { /* no access to this edge */ }
      }
    }
  } catch { /* no business access */ }
  return [...found.values()];
}

/** Ask Meta to send this page's new leads to the app (and stop). */
export const subscribePage = (a: MetaApp, pageId: string, pageToken: string) =>
  graph(a, `${pageId}/subscribed_apps`, { method: 'POST', token: pageToken, params: { subscribed_fields: 'leadgen' } });
export const unsubscribePage = (a: MetaApp, pageId: string, pageToken: string) =>
  graph(a, `${pageId}/subscribed_apps`, { method: 'DELETE', token: pageToken });

/** Point the app's webhook (object page, field leadgen) at this CRM, so the Admin never edits it in the Meta dashboard. */
export const setupWebhook = (a: MetaApp, callbackUrl: string) =>
  graph(a, `${a.app_id}/subscriptions`, { method: 'POST', token: appToken(a), params: { object: 'page', callback_url: callbackUrl, fields: 'leadgen', verify_token: a.verify_token, include_values: true } });

/** Lead forms on a page with their questions. */
export async function listForms(a: MetaApp, pageId: string, pageToken: string): Promise<{ id: string; name: string; status?: string; questions?: MetaQuestion[] }[]> {
  const r = await graph<{ data: { id: string; name: string; status?: string; questions?: MetaQuestion[] }[] }>(a, `${pageId}/leadgen_forms`, { token: pageToken, params: { fields: 'id,name,status,questions{key,label,type,options}', limit: 100 } });
  return r.data || [];
}

export const LEAD_FIELDS = 'id,created_time,form_id,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,is_organic,platform,field_data,custom_disclaimer_responses';
/** One lead with its answers. Ad, ad set and campaign names can be missing (organic or test leads, or no ad-account access):
 *  then they are looked up from the ad once, and left blank if that is not allowed. */
export async function fetchLead(a: MetaApp, leadgenId: string, pageToken: string): Promise<MetaLeadData> {
  const lead = await graph<MetaLeadData>(a, leadgenId, { token: pageToken, params: { fields: LEAD_FIELDS } });
  if (lead.ad_id && (!lead.campaign_name || !lead.adset_name || !lead.ad_name)) {
    try {
      const ad = await graph<{ name?: string; adset?: { name?: string }; campaign?: { name?: string } }>(a, lead.ad_id, { token: pageToken, params: { fields: 'name,adset{name},campaign{name}' } });
      lead.ad_name ||= ad.name; lead.adset_name ||= ad.adset?.name; lead.campaign_name ||= ad.campaign?.name;
    } catch { /* names stay blank; the lead is still saved */ }
  }
  return lead;
}

/** Lead ids on a form since a time (for "Fetch missed leads"). */
export async function formLeadIds(a: MetaApp, formId: string, pageToken: string, sinceUnix: number): Promise<string[]> {
  const ids: string[] = [];
  let after = '';
  for (let i = 0; i < 20; i++) {
    const r = await graph<{ data: { id: string }[]; paging?: { cursors?: { after?: string }; next?: string } }>(a, `${formId}/leads`, {
      token: pageToken, params: { fields: 'id', limit: 100, filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: sinceUnix }]), ...(after ? { after } : {}) } });
    ids.push(...(r.data || []).map((x) => x.id));
    if (!r.paging?.next || !r.paging.cursors?.after) break;
    after = r.paging.cursors.after;
  }
  return ids;
}

// ---- Mapping form answers to the CRM ----

/** Meta's standard question keys, saved straight into the lead. */
const STANDARD: Record<string, 'full_name' | 'first_name' | 'last_name' | 'mobile' | 'email' | 'city'> = {
  full_name: 'full_name', first_name: 'first_name', last_name: 'last_name', phone_number: 'mobile', phone: 'mobile', mobile_number: 'mobile',
  email: 'email', work_email: 'email', city: 'city',
};
export const isStandard = (key: string) => key in STANDARD;

/** Best guess for a custom question, from its wording. Admin can change it on the page. */
export function suggestTarget(q: { key: string; label?: string }, customKeys: string[]): string {
  const t = norm(`${q.label || ''} ${q.key}`).replace(/_/g, ' ');
  const has = (k: string) => customKeys.includes(k);
  // fee first: "The course fee is ₹3.5 Lakhs…" is about paying, not about which course
  if (/\bfees?\b|\bpay(ing|ment)?\b|upfront|lakh|emi\b|instal/.test(t)) return has('fee_plan') ? 'custom:fee_plan' : 'notes';
  if (/\b(program|programme|course)\b/.test(t)) return 'course';
  if (/\b(city|location|where do you live)\b/.test(t)) return 'city';
  if (/experience/.test(t) && has('experience')) return 'custom:experience';
  if (/background|profession|occupation|currently/.test(t) && has('background')) return 'custom:background';
  const byLabel = customKeys.find((k) => t.includes(k.replace(/_/g, ' ')));
  return byLabel ? 'custom:' + byLabel : 'notes';
}

/** Turn one Meta lead into the body the shared lead door expects. `map` is meta_key → target for this form. */
export function leadBody(lead: MetaLeadData, form: Pick<MetaForm, 'name' | 'course' | 'questions'> | null, map: Record<string, string>): Record<string, unknown> {
  const answers: Record<string, string> = {};
  // a choice answer arrives as the option's code ("it_professional"); show it as the option's words when the form lists them,
  // otherwise as the code with spaces ("it professional")
  const readable = (key: string, v: string) => {
    const opt = form?.questions?.find((q) => q.key === key)?.options?.find((o) => o.key === v || norm(String(o.key || '')) === norm(v));
    if (opt?.value) return String(opt.value);
    return /_/.test(v) && !/\s/.test(v) ? v.replace(/_/g, ' ') : v;
  };
  for (const f of lead.field_data || []) answers[f.name] = (f.values || []).map((v) => str(v)).filter(Boolean).map((v) => (isStandard(f.name) ? v : readable(f.name, v))).join(', ');
  const labelOf = (k: string) => form?.questions?.find((q) => q.key === k)?.label || k.replace(/_/g, ' ');
  const body: Record<string, unknown> = { source: 'Meta lead form' };
  const custom: Record<string, string> = {};
  const notes: string[] = [];
  let first = '', last = '';
  for (const [k, v] of Object.entries(answers)) {
    if (!v) continue;
    const std = STANDARD[k];
    if (std === 'first_name') { first = v; continue; }
    if (std === 'last_name') { last = v; continue; }
    if (std) { body[std] = v; continue; }
    const target = map[k] || 'notes';
    if (target === 'ignore') continue;
    if (target === 'course') body.course = v;
    else if (target === 'city') body.city = v;
    else if (target.startsWith('custom:')) custom[target.slice(7)] = v;
    else notes.push(`${labelOf(k)}: ${v}`);
  }
  if (!body.full_name && (first || last)) body.full_name = `${first} ${last}`.trim();
  if (!body.course && form?.course) body.course = form.course;
  if (lead.campaign_name) body.campaign = lead.campaign_name;
  if (lead.adset_name) body.adset_name = lead.adset_name;
  if (lead.ad_name) body.ad_name = lead.ad_name;
  if (Object.keys(custom).length) body.custom = custom;
  const extra = [form?.name ? `Form: ${form.name}` : '', lead.is_organic ? 'Organic (not from an ad)' : '', ...notes].filter(Boolean);
  if (extra.length) body.notes = extra.join(' · ');
  // a ticked consent box on the form counts as marketing consent
  if ((lead.custom_disclaimer_responses || []).some((d) => d.is_checked === true || d.is_checked === 'true' || d.is_checked === '1')) body.marketing_consent = true;
  return body;
}

/** Choice answers are matched later by the shared door; this is for showing a preview on the Admin page. */
export const previewChoice = matchOption;
