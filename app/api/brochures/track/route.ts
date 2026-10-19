import { NextResponse } from 'next/server';
import { clientIp, crossSite, limited } from '@/lib/server/guard';
import { asCaller, service } from '@/lib/server/recordings';
import { TOKEN_RE } from '@/lib/server/brochure';

// POST { token, events: [{ page, seconds }] } from the public brochure page (no login).
// The viewer sends one call when the page opens, a heartbeat every 15 s while the tab is visible, and one on leaving.
// Rate-limited per address and link; body capped; the database checks the link, clamps seconds and raises the alert.
// Staff who open a link while signed in are not counted (so checking the page doesn't alert anyone).
// Always answers { ok: true } so the page can't be used to test which links exist.

const MAX_BYTES = 4096;
const ok = () => NextResponse.json({ ok: true });

export async function POST(request: Request) {
  const bad = crossSite(request); if (bad) return bad;
  const raw = await request.text().catch(() => '');
  if (!raw || raw.length > MAX_BYTES) return ok();
  let body: { token?: unknown; events?: unknown };
  try { body = JSON.parse(raw); } catch { return ok(); }
  const token = typeof body.token === 'string' ? body.token : '';
  if (!TOKEN_RE.test(token)) return ok();
  // 8 calls a minute per address and link is plenty for a 15 s heartbeat; 60 a minute per address across links
  const ip = clientIp(request);
  if (limited('brochure-track:' + ip + ':' + token, 8, 60_000) || limited('brochure-track-ip:' + ip, 60, 60_000)) return ok();

  if (/sb-stint-auth-token/.test(request.headers.get('cookie') || '')) {
    const { data: { user } } = await (await asCaller()).auth.getUser().catch(() => ({ data: { user: null } }));
    if (user) return ok();
  }

  const events = (Array.isArray(body.events) ? body.events : []).slice(0, 40).map((e) => ({
    page: Math.max(0, Math.min(999, Math.floor(Number((e as { page?: unknown })?.page) || 0))),
    seconds: Math.max(0, Math.min(120, Math.round(Number((e as { seconds?: unknown })?.seconds) || 0))),
  }));
  const { error } = await service().rpc('brochure_track', { p_token: token, p_events: events });
  if (error) console.error('[brochure] track failed' + (error.code ? ' (' + error.code + ')' : ''));
  return ok();
}
