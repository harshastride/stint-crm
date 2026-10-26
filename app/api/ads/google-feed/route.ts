import { NextResponse } from 'next/server';
import { feedCsv, getSettings, googleFeedRows } from '@/lib/server/ads';
import { clientIp, limited, safeEqual } from '@/lib/server/guard';
import { service } from '@/lib/server/recordings';

export const dynamic = 'force-dynamic';

// Google Ads scheduled upload (Conversions → Uploads → Schedule → HTTPS). Google reads this with HTTP Basic auth
// (user and password from the Ad conversions page). Email and phone are SHA-256 hashed; rows are marked Sent the first
// time they are served (Google ignores an Order ID it has already seen).
const notFound = () => NextResponse.json({ error: 'Not found.' }, { status: 404 });
const askLogin = () => new NextResponse('Sign in required.', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Stint CRM conversions", charset="UTF-8"' } });

export async function GET(request: Request) {
  const db = service();
  const s = await getSettings(db);
  if (!s?.google_enabled || !s.google_feed_password) return notFound();

  const ip = clientIp(request);
  if (limited('gfeed:' + ip, 30, 10 * 60_000)) return NextResponse.json({ error: 'Too many tries. Please wait.' }, { status: 429 });
  const m = (request.headers.get('authorization') || '').match(/^Basic\s+([A-Za-z0-9+/=]+)$/i);
  let user = '', pass = '';
  if (m) {
    const raw = Buffer.from(m[1], 'base64').toString('utf8');
    const i = raw.indexOf(':');
    if (i >= 0) { user = raw.slice(0, i); pass = raw.slice(i + 1); }
  }
  const userOk = safeEqual(user, s.google_feed_user), passOk = safeEqual(pass, s.google_feed_password);
  if (!userOk || !passOk) return askLogin();

  try {
    const rows = await googleFeedRows(db, s.google_feed_days);
    const fresh = rows.filter((r) => r.status !== 'Sent').map((r) => r.id);
    const now = new Date().toISOString();
    for (let i = 0; i < fresh.length; i += 200) {
      const { error } = await db.from('ad_conversion').update({ status: 'Sent', sent_at: now, last_error: null }).in('id', fresh.slice(i, i + 200)).neq('status', 'Sent');
      if (error) console.error('[ads] mark feed rows failed', error.code || '');
    }
    await db.from('ad_settings').update({ last_feed_at: now }).eq('id', 1);
    return new NextResponse(feedCsv(rows), { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch {
    console.error('[ads] google feed failed');
    return NextResponse.json({ error: 'Could not build the feed.' }, { status: 500 });
  }
}
