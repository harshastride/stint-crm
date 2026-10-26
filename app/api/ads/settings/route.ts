import { NextResponse } from 'next/server';
import { requireAdsWriter } from '@/lib/server/ads';
import { crossSite, fail, limited } from '@/lib/server/guard';
import { service } from '@/lib/server/recordings';

export const dynamic = 'force-dynamic';

// Saves the two secrets of Ad conversions (never readable from the browser): the Meta Conversions API token and the
// Google feed password. A string sets it, '' clears it, a missing field leaves it as it is. Nothing is returned or logged.
const TOKEN = /^[A-Za-z0-9_\-|.]{20,1000}$/;

export async function POST(request: Request) {
  const bad = crossSite(request); if (bad) return bad;
  try {
    const who = await requireAdsWriter();
    if (who instanceof NextResponse) return who;
    if (limited('ads-settings:' + who.user.id, 20, 3600_000)) return NextResponse.json({ error: 'Saved many times in the last hour. Please try again later.' }, { status: 429 });

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Send JSON.' }, { status: 400 });
    const patch: Record<string, string | null> = {};
    if ('meta_capi_token' in body) {
      if (typeof body.meta_capi_token !== 'string') return NextResponse.json({ error: 'The token must be text.' }, { status: 400 });
      const t = body.meta_capi_token.trim();
      if (t && !TOKEN.test(t)) return NextResponse.json({ error: 'That does not look like a Conversions API token. Copy it again from Events Manager → Settings → Generate access token.' }, { status: 400 });
      patch.meta_capi_token = t || null;
    }
    if ('google_feed_password' in body) {
      if (typeof body.google_feed_password !== 'string') return NextResponse.json({ error: 'The password must be text.' }, { status: 400 });
      const p = body.google_feed_password;
      if (p && (p.length < 12 || p.length > 100 || /[\s:]/.test(p))) return NextResponse.json({ error: 'Use 12 to 100 characters, without spaces or colons.' }, { status: 400 });
      patch.google_feed_password = p || null;
    }
    if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 });
    const { error } = await service().from('ad_settings').update(patch).eq('id', 1);
    if (error) return fail('ads settings save', error, 'Could not save.');
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail('ads settings', e);
  }
}
