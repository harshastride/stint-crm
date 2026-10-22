import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { appReady, getApp, loginUrl } from '@/lib/server/meta';
import { backToMetaPage, META_STATE_COOKIE, requireMetaAdmin } from '@/lib/server/meta-sync';
import { service } from '@/lib/server/recordings';
import { siteUrl } from '@/lib/server/teams';

// "Connect Facebook": sends the Admin to Facebook's sign-in, with a one-time state kept in a short-lived cookie so the
// callback can tell the answer is for this sign-in. Every redirect uses the CRM's own address, never the request host.
export const dynamic = 'force-dynamic';

const backWithError = (site: string, reason: string) => backToMetaPage(site, { meta: 'error', reason });

export async function GET() {
  const site = await siteUrl().catch(() => '');
  try {
    const who = await requireMetaAdmin();
    if (who instanceof NextResponse)
      return backWithError(site, who.status === 401 ? 'Please sign in first.' : 'Only someone who can change Meta lead forms can connect Facebook.');
    if (!/^https?:\/\//.test(site)) return backWithError(site, 'The CRM’s web address is not set yet, so Facebook cannot send you back. Ask the person who set up the CRM to set it.');

    const app = await getApp(service());
    if (!appReady(app)) return backWithError(site, 'Save the Meta App ID and App secret first.');

    const state = crypto.randomBytes(24).toString('hex');
    const res = new NextResponse(null, { status: 302, headers: { Location: loginUrl(app, site + '/api/meta/callback', state), 'Cache-Control': 'no-store' } });
    res.cookies.set(META_STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', secure: site.startsWith('https'), path: '/api/meta', maxAge: 600 });
    return res;
  } catch {
    console.error('[api] meta connect failed');
    return backWithError(site, 'Could not start the Facebook sign-in. Please try again.');
  }
}
