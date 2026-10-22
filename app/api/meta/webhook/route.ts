import { after, NextResponse } from 'next/server';
import { safeEqual } from '@/lib/server/guard';
import { getApp, signatureOk } from '@/lib/server/meta';
import { processDue } from '@/lib/server/meta-process';
import { service } from '@/lib/server/recordings';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Meta calls this address (no sign-in).
// GET  : Meta checks the address once ("hub.challenge"), using the verify token saved on the Meta app row.
// POST : someone submitted a lead form on a connected page. Signed by Meta with the app secret (X-Hub-Signature-256).
//        Only the Meta ids are recorded here; the answers are fetched from Meta after the reply is sent, so Meta gets a
//        fast 200. Meta may send the same lead twice: the lead id is the key, so the second copy is ignored.

const ID = /^\d{1,40}$/;   // Meta ids are digits; anything else is not used (it would end up in a Graph API path)
const idOrNull = (v: unknown) => { const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : ''; return ID.test(s) ? s : null; };

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const app = await getApp(service()).catch(() => null);
  if (q.get('hub.mode') === 'subscribe' && app?.verify_token && safeEqual(q.get('hub.verify_token'), app.verify_token)) {
    return new Response(q.get('hub.challenge') || '', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  return new Response('Not allowed.', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 1_000_000) return NextResponse.json({ error: 'Too large.' }, { status: 413 });
  const db = service();
  const app = await getApp(db).catch(() => null);
  if (!signatureOk(raw, request.headers.get('x-hub-signature-256'), app?.app_secret ?? null)) {
    return NextResponse.json({ error: 'Not allowed.' }, { status: 401 });
  }

  let body: { object?: unknown; entry?: unknown };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Bad JSON.' }, { status: 400 }); }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Bad JSON.' }, { status: 400 });

  const rows = new Map<string, { leadgen_id: string; page_id: string | null; form_id: string | null; ad_id: string | null }>();
  for (const entry of Array.isArray(body.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (change?.field !== 'leadgen' || !change.value || typeof change.value !== 'object') continue;
      const v = change.value as Record<string, unknown>;
      const leadgen_id = idOrNull(v.leadgen_id);
      if (!leadgen_id) continue;
      rows.set(leadgen_id, { leadgen_id, page_id: idOrNull(v.page_id ?? entry?.id), form_id: idOrNull(v.form_id), ad_id: idOrNull(v.ad_id) });
    }
  }
  if (!rows.size) return NextResponse.json({ ok: true });   // another field or object: nothing to do

  const { data, error } = await db.from('meta_lead').upsert([...rows.values()], { onConflict: 'leadgen_id', ignoreDuplicates: true }).select('leadgen_id');
  if (error) {
    // not recorded: a non-200 makes Meta send it again later
    console.error('[meta] webhook: record lead ids failed', error.code || '');
    return NextResponse.json({ error: 'Could not record the lead.' }, { status: 500 });
  }
  const ids = (data || []).map((r) => r.leadgen_id as string);
  if (ids.length) {
    after(() => processDue(service(), { ids, budgetMs: 25_000 }).then(() => undefined, () => console.error('[meta] webhook: processing failed; the minute job will retry')));
  }
  return NextResponse.json({ ok: true });
}
