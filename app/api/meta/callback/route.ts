import { NextResponse, type NextRequest } from 'next/server';
import { safeEqual } from '@/lib/server/guard';
import { appReady, getApp, listPages, MetaError, subscribePage, userTokenFromCode } from '@/lib/server/meta';
import { backToMetaPage, META_STATE_COOKIE, requireMetaAdmin, syncForms } from '@/lib/server/meta-sync';
import { service } from '@/lib/server/recordings';
import { siteUrl } from '@/lib/server/teams';

// Facebook sends the Admin back here after "Connect Facebook". We swap the one-time code for a long-lived sign-in,
// save every page they manage (with its page token, server only) and, when there is just one page, start receiving its
// leads straight away. Always ends on the Meta lead forms page: ?meta=connected&pages=n or ?meta=error&reason=...
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const site = await siteUrl().catch(() => '');
  const params = request.nextUrl.searchParams;
  const sentState = params.get('state');
  const savedState = request.cookies.get(META_STATE_COOKIE)?.value;

  const done = (res: NextResponse) => {
    res.cookies.set(META_STATE_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: site.startsWith('https'), path: '/api/meta', maxAge: 0 });
    return res;
  };
  const error = (reason: string) => done(backToMetaPage(site, { meta: 'error', reason }));

  if (params.get('error') || params.get('error_reason')) return error('You cancelled the Facebook sign-in.');
  if (!savedState || !sentState || !safeEqual(savedState, sentState))
    return error('The sign-in took too long or came from elsewhere. Press Connect Facebook again.');
  const code = params.get('code');
  if (!code || code.length > 2000) return error('Facebook did not send a sign-in code. Press Connect Facebook again.');

  try {
    const who = await requireMetaAdmin();
    if (who instanceof NextResponse)
      return error(who.status === 401 ? 'Please sign in to the CRM, then press Connect Facebook again.' : 'Only someone who can change Meta lead forms can connect Facebook.');
    if (!/^https?:\/\//.test(site)) return error('The CRM’s web address is not set yet. Ask the person who set up the CRM to set it.');

    const db = service();
    const app = await getApp(db);
    if (!appReady(app)) return error('Save the Meta App ID and App secret first.');

    const userToken = await userTokenFromCode(app, code, site + '/api/meta/callback');
    const pages = (await listPages(app, userToken)).filter((p) => p?.id && p.access_token);
    if (!pages.length) return error('This Facebook account does not manage any page. Sign in with the account that is an admin of your page.');

    // Save every page. Only these columns are sent, so a page already receiving leads keeps doing so.
    const now = new Date().toISOString();
    const { error: saveErr } = await db.from('meta_page').upsert(
      pages.map((p) => ({ page_id: String(p.id), name: String(p.name || 'Facebook page').slice(0, 200), access_token: p.access_token, connected_by: who.user.id, connected_at: now, last_error: null })),
      { onConflict: 'page_id' });
    if (saveErr) {
      console.error('[api] meta callback: saving pages failed' + (saveErr.code ? ` (${saveErr.code})` : ''));
      return error('Could not save your Facebook pages. Please try again.');
    }

    // Just one page: nothing to choose, so start receiving its leads now.
    if (pages.length === 1) {
      const p = pages[0];
      const pageId = String(p.id);
      try {
        await subscribePage(app, pageId, p.access_token);
        await db.from('meta_page').update({ receiving: true, last_error: null }).eq('page_id', pageId);
        await syncForms(db, app, { page_id: pageId, access_token: p.access_token });
      } catch (e) {
        if (!(e instanceof MetaError)) console.error('[api] meta callback: starting the page failed');
        const msg = e instanceof MetaError ? e.message : 'Connected, but the lead forms could not be read yet. Press Refresh forms.';
        await db.from('meta_page').update({ last_error: msg }).eq('page_id', pageId);
        // The page is saved; the Admin sees the problem on it and can press "Receive leads" again.
      }
    }
    return done(backToMetaPage(site, { meta: 'connected', pages: pages.length }));
  } catch (e) {
    if (e instanceof MetaError) return error(e.message);
    console.error('[api] meta callback failed');
    return error('Could not finish connecting Facebook. Please try again.');
  }
}
