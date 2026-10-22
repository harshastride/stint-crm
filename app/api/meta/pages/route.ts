import { NextResponse } from 'next/server';
import { crossSite, fail, limited } from '@/lib/server/guard';
import { appReady, getApp, MetaError, subscribePage, unsubscribePage } from '@/lib/server/meta';
import { requireMetaAdmin, syncForms } from '@/lib/server/meta-sync';
import { service } from '@/lib/server/recordings';

// Buttons on a connected Facebook page: Receive leads, Stop, Refresh forms, Disconnect.
// The page token is read with the service client and never leaves the server.
export const dynamic = 'force-dynamic';

const ACTIONS = ['receive', 'stop', 'sync', 'disconnect'] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(request: Request) {
  const bad = crossSite(request); if (bad) return bad;
  try {
    const who = await requireMetaAdmin();
    if (who instanceof NextResponse) return who;
    if (limited('meta-pages:' + who.user.id, 30, 60_000))
      return NextResponse.json({ error: 'Too many clicks in a minute. Please wait a moment.' }, { status: 429 });

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const pageId = typeof body?.page_id === 'string' ? body.page_id.trim() : '';
    const action = (typeof body?.action === 'string' ? body.action : '') as Action;
    if (!/^\d{1,30}$/.test(pageId)) return NextResponse.json({ error: 'Pick a Facebook page.' }, { status: 400 });
    if (!ACTIONS.includes(action)) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });

    const db = service();
    const { data: page, error: readErr } = await db.from('meta_page').select('page_id, access_token').eq('page_id', pageId).maybeSingle();
    if (readErr) return fail('meta pages read', readErr, 'Could not read the page.');
    if (!page) return NextResponse.json({ error: 'This page is not connected any more. Refresh the screen.' }, { status: 404 });
    const app = await getApp(db);
    if (!appReady(app) && action !== 'disconnect') return NextResponse.json({ error: 'Save the Meta App ID and App secret first.' }, { status: 400 });

    const token = String(page.access_token || '');
    const save = async (patch: Record<string, unknown>) => {
      const { error } = await db.from('meta_page').update(patch).eq('page_id', pageId);
      if (error) throw error;
    };

    try {
      if (action === 'disconnect') {
        if (token && appReady(app)) await unsubscribePage(app, pageId, token).catch(() => undefined);   // best effort: the page goes either way
        // Forget the page token first: the recycle bin keeps a copy of every deleted row, and Admin can read the bin.
        const { error: wipeErr } = await db.from('meta_page').update({ access_token: null, receiving: false }).eq('page_id', pageId);
        if (wipeErr) return fail('meta pages disconnect', wipeErr, 'Could not disconnect the page.');
        const { error } = await db.from('meta_page').delete().eq('page_id', pageId);   // its forms and question settings go with it
        if (error) return fail('meta pages disconnect', error, 'Could not disconnect the page.');
        return NextResponse.json({ ok: true });
      }
      if (!token) throw new MetaError('This page has no Facebook connection. Press Connect Facebook again.', 190);
      if (action === 'receive') {
        await subscribePage(app, pageId, token);
        await save({ receiving: true, last_error: null });
        const forms = await syncForms(db, app, { page_id: pageId, access_token: token });
        return NextResponse.json({ ok: true, forms });
      }
      if (action === 'stop') {
        await unsubscribePage(app, pageId, token);
        await save({ receiving: false });
        return NextResponse.json({ ok: true });
      }
      const forms = await syncForms(db, app, { page_id: pageId, access_token: token });
      return NextResponse.json({ ok: true, forms });
    } catch (e) {
      if (!(e instanceof MetaError)) throw e;
      // 190 = the Facebook connection expired or was removed: leads cannot arrive any more.
      await db.from('meta_page').update({ last_error: e.message, ...(e.code === 190 ? { receiving: false } : {}) }).eq('page_id', pageId);
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
  } catch (e) {
    return fail('meta pages', e, 'Could not update the page. Please try again.');
  }
}
