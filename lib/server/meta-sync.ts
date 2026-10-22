import 'server-only';
import { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { asCaller } from './recordings';
import { isStandard, listForms, MetaError, suggestTarget, type MetaApp, type MetaQuestion } from './meta';

// Shared by the Meta admin routes: who may change the connection, and copying a page's lead forms into the CRM.
// `db` is the service client (it writes meta_form / meta_field_map); page tokens are never logged.

type Caller = Awaited<ReturnType<typeof asCaller>>;

/** Signed in (401) and allowed to change "Meta lead forms" (403); otherwise the person and their client. */
export async function requireMetaAdmin(): Promise<{ user: User; caller: Caller } | NextResponse> {
  const caller = await asCaller();
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const { data: allowed } = await caller.rpc('can_page', { p: 'meta', need: 'w' });
  if (allowed !== true) return NextResponse.json({ error: 'Only someone who can change Meta lead forms can do this.' }, { status: 403 });
  return { user, caller };
}

/** Read the page's lead forms from Meta and save them. Keeps each form's "active" switch and course as the Admin set
 *  them, and adds a suggested destination only for questions that have none yet. Returns how many forms the page has. */
export async function syncForms(db: SupabaseClient, app: MetaApp, page: { page_id: string; access_token: string | null }): Promise<number> {
  if (!page.access_token) throw new MetaError('This page has no Facebook connection. Press Connect Facebook again.');
  const forms = await listForms(app, page.page_id, page.access_token);
  if (!forms.length) return 0;

  const now = new Date().toISOString();
  const rows = forms.map((f) => ({
    form_id: String(f.id),
    page_id: page.page_id,
    name: String(f.name || 'Untitled form').slice(0, 200),
    status: f.status ? String(f.status) : null,
    questions: cleanQuestions(f.questions),
    synced_at: now,
  }));
  // Only these columns are sent, so an existing form keeps its `active` and `course`.
  const { error: formErr } = await db.from('meta_form').upsert(rows, { onConflict: 'form_id' });
  if (formErr) throw new Error('Could not save the lead forms.');

  const [{ data: custom }, { data: mapped }] = await Promise.all([
    db.from('custom_field').select('key').eq('page_id', 'lead'),
    db.from('meta_field_map').select('form_id, meta_key').in('form_id', rows.map((r) => r.form_id)),
  ]);
  const customKeys = (custom || []).map((c) => String(c.key));
  const have = new Set((mapped || []).map((m) => `${m.form_id}\u0000${m.meta_key}`));

  const add: { form_id: string; meta_key: string; target: string }[] = [];
  for (const r of rows) {
    for (const q of r.questions) {
      const id = `${r.form_id}\u0000${q.key}`;
      if (isStandard(q.key) || have.has(id)) continue;
      have.add(id);
      add.push({ form_id: r.form_id, meta_key: q.key, target: suggestTarget(q, customKeys) });
    }
  }
  if (add.length) {
    const { error: mapErr } = await db.from('meta_field_map').upsert(add, { onConflict: 'form_id,meta_key', ignoreDuplicates: true });
    if (mapErr) throw new Error('Could not save where the form answers go.');
  }
  return forms.length;
}

/** Keep only what the page needs from each question: key, label, type and choices. */
function cleanQuestions(qs: MetaQuestion[] | undefined): MetaQuestion[] {
  return (qs || [])
    .filter((q) => q && typeof q.key === 'string' && q.key.trim())
    .map((q) => ({
      key: q.key,
      ...(q.label ? { label: String(q.label) } : {}),
      ...(q.type ? { type: String(q.type) } : {}),
      ...(Array.isArray(q.options) && q.options.length
        ? { options: q.options.map((o) => ({ ...(o?.key ? { key: String(o.key) } : {}), ...(o?.value ? { value: String(o.value) } : {}) })) }
        : {}),
    }));
}

/** One-time "state" for the Facebook sign-in, kept in a short-lived cookie scoped to /api/meta. */
export const META_STATE_COOKIE = 'meta_oauth_state';

/** Back to the Meta lead forms page (`site` is the CRM's own address; relative when it is not set yet). */
export function backToMetaPage(site: string, query: Record<string, string | number>): NextResponse {
  const q = Object.entries(query).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
  return new NextResponse(null, { status: 302, headers: { Location: `${site}/p/meta?${q}`, 'Cache-Control': 'no-store' } });
}
