import { after, NextResponse } from 'next/server';
import { crossSite, fail, limited } from '@/lib/server/guard';
import { appReady, formLeadIds, getApp, MetaError } from '@/lib/server/meta';
import { processDue } from '@/lib/server/meta-process';
import { asCaller, service } from '@/lib/server/recordings';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST { form_id, days? } → { ok, found, queued }
// "Fetch missed leads": asks Meta for every lead on one form from the last 1–90 days (default 7), records the ones the CRM has
// not seen, and saves them in the background through the same processor as the webhook. Leads already recorded are left
// alone (no second lead, no second note). For whoever may change the "Meta lead forms" page.

const ID = /^\d{1,40}$/;

export async function POST(request: Request) {
  const bad = crossSite(request);
  if (bad) return bad;
  const caller = await asCaller();
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  const { data: may } = await caller.rpc('can_page', { p: 'meta', need: 'w' });
  if (may !== true) return NextResponse.json({ error: 'You do not have access to Meta lead forms.' }, { status: 403 });
  if (limited('meta-backfill:' + user.id, 10, 3600_000)) return NextResponse.json({ error: 'Too many fetches in the last hour. Please try again later.' }, { status: 429 });

  const input = await request.json().catch(() => null) as { form_id?: unknown; days?: unknown } | null;
  const formId = typeof input?.form_id === 'string' || typeof input?.form_id === 'number' ? String(input.form_id).trim() : '';
  if (!ID.test(formId)) return NextResponse.json({ error: 'Pick a form.' }, { status: 400 });
  const daysIn = input?.days == null || input.days === '' ? 7 : Number(input.days);
  if (!Number.isFinite(daysIn)) return NextResponse.json({ error: 'Days must be a number from 1 to 90.' }, { status: 400 });
  const days = Math.min(90, Math.max(1, Math.round(daysIn)));

  const db = service();
  try {
    const { data: form, error: formErr } = await db.from('meta_form').select('form_id, page_id').eq('form_id', formId).maybeSingle();
    if (formErr) return fail('meta backfill: read form', formErr);
    if (!form) return NextResponse.json({ error: 'That form is not in the CRM. Press “Refresh forms” first.' }, { status: 404 });
    const { data: page, error: pageErr } = await db.from('meta_page').select('page_id, access_token').eq('page_id', form.page_id).maybeSingle();
    if (pageErr) return fail('meta backfill: read page', pageErr);
    if (!page?.access_token) return NextResponse.json({ error: 'This page is no longer connected. Press “Connect Facebook” again.' }, { status: 409 });
    const app = await getApp(db);
    if (!appReady(app)) return NextResponse.json({ error: 'The Meta app is not saved yet.' }, { status: 409 });

    const since = Math.floor(Date.now() / 1000) - days * 86_400;
    const found = [...new Set((await formLeadIds(app, formId, page.access_token, since)).filter((id) => ID.test(id)))];
    let queued = 0;
    if (found.length) {
      const { data: added, error } = await db.from('meta_lead')
        .upsert(found.map((leadgen_id) => ({ leadgen_id, page_id: page.page_id, form_id: formId })), { onConflict: 'leadgen_id', ignoreDuplicates: true })
        .select('leadgen_id');
      if (error) return fail('meta backfill: record lead ids', error);
      queued = added?.length || 0;
    }
    if (queued) after(() => processDue(service(), { limit: 100, budgetMs: 45_000 }).then(() => undefined, () => console.error('[meta] backfill: processing failed; the minute job will retry')));
    return NextResponse.json({ ok: true, found: found.length, queued });
  } catch (e) {
    if (e instanceof MetaError) return NextResponse.json({ error: e.message }, { status: 502 });
    return fail('meta backfill', e);
  }
}
