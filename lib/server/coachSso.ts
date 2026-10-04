import crypto from 'node:crypto';

// One-minute signed pass that lets a student open the Interview Coach without a second login.
// Token = <payload b64url>.<HMAC-SHA256(COACH_SSO_SECRET, payload b64url) b64url>
export type CoachClaims = { cid: string; email: string; name: string; exp: number; nonce: string };

const sign = (payload: string, secret: string) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

export function makeCoachToken(who: { cid: string; email: string; name: string }, secret = process.env.COACH_SSO_SECRET || '', ttl = 60): string {
  if (!secret) throw new Error('COACH_SSO_SECRET is not set.');
  const claims: CoachClaims = { ...who, exp: Math.floor(Date.now() / 1000) + ttl, nonce: crypto.randomBytes(16).toString('hex') };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyCoachToken(token: string, secret = process.env.COACH_SSO_SECRET || ''): CoachClaims | null {
  if (!secret || typeof token !== 'string') return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(payload, secret));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as CoachClaims;
    if (!c.cid || typeof c.exp !== 'number' || c.exp < Math.floor(Date.now() / 1000)) return null;
    return c;
  } catch { return null; }
}
