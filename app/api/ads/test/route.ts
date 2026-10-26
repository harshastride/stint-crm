import { NextResponse } from 'next/server';
import { getSettings, googleFeedRows, requireAdsWriter, sendMetaTest } from '@/lib/server/ads';
import { crossSite, fail, limited } from '@/lib/server/guard';
import { service } from '@/lib/server/recordings';

export const dynamic = 'force-dynamic';

// "Send test event" (Meta) and "Check feed" (Google) on the Ad conversions page.
export async function POST(request: Request) {
  const bad = crossSite(request); if (bad) return bad;
  try {
    const who = await requireAdsWriter();
    if (who instanceof NextResponse) return who;
    if (limited('ads-test:' + who.user.id, 10, 10 * 60_000)) return NextResponse.json({ error: 'Tried many times. Please wait a few minutes.' }, { status: 429 });
    const body = (await request.json().catch(() => null)) as { platform?: unknown } | null;
    const db = service();
    if (body?.platform === 'meta') return NextResponse.json(await sendMetaTest(db));
    if (body?.platform === 'google') {
      const s = await getSettings(db);
      const rows = await googleFeedRows(db, s?.google_feed_days ?? 60);
      const waiting = rows.filter((r) => r.status !== 'Sent').length;
      const off = !s?.google_enabled ? ' Google is switched off, so the feed is closed for now.' : !s.google_feed_password ? ' Set a feed password before Google can read it.' : '';
      return NextResponse.json({ ok: true, count: rows.length, message: `The feed shows ${rows.length} conversion${rows.length === 1 ? '' : 's'} now (${waiting} not read by Google yet).${off}` });
    }
    return NextResponse.json({ error: 'Choose meta or google.' }, { status: 400 });
  } catch (e) {
    return fail('ads test', e);
  }
}
