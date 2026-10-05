import 'server-only';
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
export { isUuid } from '@/lib/pgrst';

// Small shared guards for app/api/* routes.

/** Constant-time string compare (hashes first, so different lengths do not throw or leak timing). */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ha = crypto.createHash('sha256').update(a).digest(), hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb) && a.length === b.length;
}

/** CSRF guard for cookie-signed-in POSTs: the Origin (or Referer) must be this site. Requests without either (curl, apps) pass,
 *  because they cannot carry a browser's cookies cross-site anyway. */
export function crossSite(request: Request): NextResponse | null {
  const origin = request.headers.get('origin') || (() => { try { return new URL(request.headers.get('referer') || '').origin; } catch { return null; } })();
  if (!origin || origin === 'null' && !request.headers.get('cookie')) return null;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  try { if (host && new URL(origin).host === host) return null; } catch { /* fall through */ }
  const allowed = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '');
  if (allowed && origin === allowed) return null;
  return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
}

/** Log the real problem on the server (no personal data), return a plain message to the caller. */
export function fail(where: string, e: unknown, message = 'Something went wrong. Please try again.', status = 500) {
  const code = (e && typeof e === 'object' && 'code' in e) ? String((e as { code: unknown }).code) : '';
  console.error(`[api] ${where} failed${code ? ' (' + code + ')' : ''}`);
  return NextResponse.json({ error: message }, { status });
}

/** Very small in-memory rate limit (per server process). Returns true when the caller is over the limit. */
const buckets = new Map<string, number[]>();
export function limited(key: string, max: number, windowMs = 60_000): boolean {
  const now = Date.now(), hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  hits.push(now); buckets.set(key, hits);
  if (buckets.size > 5000) for (const k of buckets.keys()) { buckets.delete(k); if (buckets.size < 4000) break; }
  return hits.length > max;
}

export const clientIp = (r: Request) => (r.headers.get('x-forwarded-for') || '').split(',')[0].trim() || r.headers.get('x-real-ip') || 'local';

/** Safe filename for Content-Disposition. */
export const safeFilename = (n: string) => n.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'file.pdf';

/** Webhook target check: http(s) only, no cloud metadata / link-local / unspecified addresses, no credentials in the URL. */
export function badTarget(u: URL): string | null {
  if (!/^https?:$/.test(u.protocol)) return 'url must start with http:// or https://';
  if (u.username || u.password) return 'url must not contain a user name or password.';
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (/^(169\.254\.|0\.|100\.100\.100\.200$)/.test(h) || h === '0.0.0.0' || h === '::' || h.startsWith('fe80:') || /metadata(\.google)?\.internal$/.test(h) || h === 'metadata')
    return 'That address is not allowed.';
  return null;
}
