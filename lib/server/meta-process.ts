import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { saveIncomingLead } from './incoming-lead';
import { appReady, fetchLead, getApp, leadBody, MetaError, type MetaForm } from './meta';

// Turns waiting Meta leads (meta_lead, ids only) into CRM leads: fetch the answers from Meta with the page token, then save
// them through the shared lead door. Called by the webhook right after a lead arrives, by "Fetch missed leads", and every
// minute by the database (call_meta_processor → /api/meta/process) for anything still waiting or stuck.
//
// Claiming (same as the Teams sender): a row is taken by an UPDATE that sets status 'Working' and next_try_at = now(),
// filtered on its id AND the state it was read in (Pending and due, or Working and stuck for 5+ minutes). Postgres re-checks
// that filter after locking each row, so when two runs overlap only one of them gets the row back, and only returned rows
// are processed. Every result is written with "status = Working" in the filter too.
//
// Logs carry the Meta lead id and the kind of problem only: never answers, names, phones or tokens.

export type ProcessCounts = { done: number; duplicate: number; skipped: number; failed: number; retrying: number };
type Claimed = { leadgen_id: string; page_id: string | null; form_id: string | null; attempts: number };

const COLS = 'leadgen_id, page_id, form_id, attempts';
const PARALLEL = 3, MAX_ATTEMPTS = 5, STUCK_MS = 5 * 60_000;
/** Meta's "too many requests" codes, plus its "temporary problem" codes 1 and 2. */
const RATE_LIMITED = new Set([4, 17, 32, 613]);
const TRANSIENT = new Set([1, 2]);

const zero = (): ProcessCounts => ({ done: 0, duplicate: 0, skipped: 0, failed: 0, retrying: 0 });
const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

export async function processDue(db: SupabaseClient, opts: { ids?: string[]; limit?: number; budgetMs?: number } = {}): Promise<ProcessCounts> {
  const started = Date.now();
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 200));
  const budgetMs = opts.budgetMs ?? 90_000;
  const counts = zero();

  // ---- 1. Claim ----
  const rows = await claim(db, opts.ids, limit, started);
  if (!rows.length) return counts;
  const ids = rows.map((r) => r.leadgen_id);

  /** Give rows back to the queue without counting an attempt. */
  const putBack = async (keys: string[], patch: Record<string, unknown> = {}) => {
    if (!keys.length) return;
    const { error } = await db.from('meta_lead').update({ status: 'Pending', next_try_at: new Date().toISOString(), ...patch })
      .in('leadgen_id', keys).eq('status', 'Working');
    if (error) console.error('[meta] put back failed', error.code || '');
  };

  // ---- 2. The app, pages, forms and question maps, read once for the whole batch ----
  const app = await getApp(db).catch(() => null);
  if (!appReady(app)) {
    await putBack(ids, { next_try_at: minutesFromNow(10), last_error: 'The Meta app is not saved yet.' });
    counts.retrying += ids.length;
    return counts;
  }
  const pageIds = [...new Set(rows.map((r) => r.page_id).filter((x): x is string => !!x))];
  const formIds = [...new Set(rows.map((r) => r.form_id).filter((x): x is string => !!x))];
  const [pagesRes, formsRes, mapsRes] = await Promise.all([
    pageIds.length ? db.from('meta_page').select('page_id, access_token').in('page_id', pageIds) : Promise.resolve({ data: [], error: null }),
    formIds.length ? db.from('meta_form').select('form_id, page_id, name, active, course, questions').in('form_id', formIds) : Promise.resolve({ data: [], error: null }),
    formIds.length ? db.from('meta_field_map').select('form_id, meta_key, target').in('form_id', formIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (pagesRes.error || formsRes.error || mapsRes.error) {
    // could not read the settings: hand the rows back untouched rather than failing them
    console.error('[meta] read settings failed', pagesRes.error?.code || formsRes.error?.code || mapsRes.error?.code || '');
    await putBack(ids);
    counts.retrying += ids.length;
    return counts;
  }
  const pages = new Map(((pagesRes.data || []) as { page_id: string; access_token: string | null }[]).map((p) => [p.page_id, p]));
  const forms = new Map(((formsRes.data || []) as MetaForm[]).map((f) => [f.form_id, f]));
  const maps = new Map<string, Record<string, string>>();
  for (const m of (mapsRes.data || []) as { form_id: string; meta_key: string; target: string }[]) {
    const one = maps.get(m.form_id) || {};
    one[m.meta_key] = m.target;
    maps.set(m.form_id, one);
  }

  // ---- 3. Each lead ----
  const touchedPages = new Set<string>(), touchedForms = new Set<string>(), expiredPages = new Map<string, string>();
  const settle = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await db.from('meta_lead').update(patch).eq('leadgen_id', id).eq('status', 'Working');
    if (error) console.error(`[meta] lead ${id}: save result failed`, error.code || '');
  };
  const finish = (id: string, status: 'Done' | 'Duplicate' | 'Skipped' | 'Failed', extra: Record<string, unknown> = {}) =>
    settle(id, { status, processed_at: new Date().toISOString(), last_error: null, ...extra });
  const retryOrFail = async (r: Claimed, reason: string) => {
    const attempts = (r.attempts || 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      counts.failed++;
      return finish(r.leadgen_id, 'Failed', { attempts, last_error: reason });
    }
    counts.retrying++;
    return settle(r.leadgen_id, { status: 'Pending', attempts, last_error: reason, next_try_at: minutesFromNow(2 ** attempts) });
  };

  async function handle(r: Claimed) {
    const page = r.page_id ? pages.get(r.page_id) : undefined;
    if (!page?.access_token) {
      counts.failed++;
      return finish(r.leadgen_id, 'Failed', { last_error: 'This page is no longer connected.' });
    }
    const form = r.form_id ? forms.get(r.form_id) || null : null;   // a form we have not synced yet counts as switched on
    if (form && form.active === false) {
      counts.skipped++;
      return finish(r.leadgen_id, 'Skipped', { last_error: 'Form switched off.' });
    }
    const map = (r.form_id && maps.get(r.form_id)) || {};

    let lead;
    try {
      lead = await fetchLead(app!, r.leadgen_id, page.access_token);
    } catch (e) {
      if (!(e instanceof MetaError)) {
        console.error(`[meta] lead ${r.leadgen_id}: fetch failed (unexpected)`);
        return retryOrFail(r, 'Could not read the lead from Facebook.');
      }
      if (e.code === 190) {
        console.error(`[meta] lead ${r.leadgen_id}: page token expired (190)`);
        expiredPages.set(page.page_id, e.message);
        counts.failed++;
        return finish(r.leadgen_id, 'Failed', { last_error: e.message });
      }
      const transient = (e.code != null && (RATE_LIMITED.has(e.code) || TRANSIENT.has(e.code)))
        || e.code == null && (e.status == null || e.status >= 500);   // timeout, network, or Meta's own server error
      console.error(`[meta] lead ${r.leadgen_id}: fetch failed (${e.code ?? e.status ?? 'network'}${transient ? ', will retry' : ''})`);
      if (transient) return retryOrFail(r, e.message);
      counts.failed++;
      return finish(r.leadgen_id, 'Failed', { last_error: e.message });
    }

    const saved = await saveIncomingLead(db, leadBody(lead, form, map));
    if (!saved.ok) {
      // bad input (e.g. no 10-digit mobile): retrying will not change Meta's answer
      console.error(`[meta] lead ${r.leadgen_id}: not saved (rejected)`);
      counts.failed++;
      return finish(r.leadgen_id, 'Failed', { last_error: saved.error });
    }
    if (saved.duplicate) counts.duplicate++; else counts.done++;
    touchedPages.add(page.page_id);
    if (r.form_id) touchedForms.add(r.form_id);
    return finish(r.leadgen_id, saved.duplicate ? 'Duplicate' : 'Done', { lead_id: saved.lead_id || null });
  }

  // A few at a time; stop starting new ones once the time budget is spent and give those back untouched.
  const notStarted: string[] = [];
  let next = 0;
  async function worker() {
    while (next < rows.length) {
      const r = rows[next++];
      if (Date.now() - started > budgetMs) { notStarted.push(r.leadgen_id); continue; }
      try { await handle(r); }
      catch {
        console.error(`[meta] lead ${r.leadgen_id}: failed (unexpected)`);
        await retryOrFail(r, 'Something went wrong while saving the lead.').catch(() => {});
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, rows.length) }, worker));

  if (notStarted.length) {
    await putBack(notStarted);
    counts.retrying += notStarted.length;
  }

  // ---- 4. Page and form status for the Admin page ----
  const now = new Date().toISOString();
  const updates: PromiseLike<unknown>[] = [];
  for (const [pageId, message] of expiredPages) updates.push(db.from('meta_page').update({ last_error: message, receiving: false }).eq('page_id', pageId));
  if (touchedPages.size) updates.push(db.from('meta_page').update({ last_lead_at: now }).in('page_id', [...touchedPages]));
  if (touchedForms.size) updates.push(db.from('meta_form').update({ last_lead_at: now }).in('form_id', [...touchedForms]));
  const results = await Promise.all(updates) as { error?: { code?: string } | null }[];
  for (const res of results) if (res?.error) console.error('[meta] page/form status update failed', res.error.code || '');

  return counts;
}

/** Take rows for this run (see the note at the top). Only rows the UPDATE returned are ours. */
async function claim(db: SupabaseClient, ids: string[] | undefined, limit: number, started: number): Promise<Claimed[]> {
  const claimAt = new Date().toISOString();
  if (ids) {
    const want = [...new Set(ids.filter((x) => typeof x === 'string' && x))].slice(0, limit);
    if (!want.length) return [];
    const { data, error } = await db.from('meta_lead').update({ status: 'Working', next_try_at: claimAt })
      .in('leadgen_id', want).eq('status', 'Pending').select(COLS);
    if (error) console.error('[meta] claim failed', error.code || '');
    return (data || []) as Claimed[];
  }

  const nowIso = new Date(started).toISOString();
  const stuckIso = new Date(started - STUCK_MS).toISOString();
  const { data: due, error } = await db.from('meta_lead').select('leadgen_id, status')
    .or(`and(status.eq.Pending,next_try_at.lte."${nowIso}"),and(status.eq.Working,next_try_at.lt."${stuckIso}")`)
    .order('next_try_at').limit(limit);
  if (error) { console.error('[meta] read queue failed', error.code || ''); return []; }
  if (!due?.length) return [];

  const pendingIds = due.filter((r) => r.status === 'Pending').map((r) => r.leadgen_id as string);
  const stuckIds = due.filter((r) => r.status === 'Working').map((r) => r.leadgen_id as string);
  const empty = Promise.resolve({ data: [] as Claimed[], error: null });
  const [a, b] = await Promise.all([
    pendingIds.length
      ? db.from('meta_lead').update({ status: 'Working', next_try_at: claimAt })
        .in('leadgen_id', pendingIds).eq('status', 'Pending').lte('next_try_at', nowIso).select(COLS)
      : empty,
    stuckIds.length
      ? db.from('meta_lead').update({ status: 'Working', next_try_at: claimAt })
        .in('leadgen_id', stuckIds).eq('status', 'Working').lt('next_try_at', stuckIso).select(COLS)
      : empty,
  ]);
  if (a.error || b.error) console.error('[meta] claim failed', a.error?.code || b.error?.code || '');
  return [...((a.data || []) as Claimed[]), ...((b.data || []) as Claimed[])];
}
