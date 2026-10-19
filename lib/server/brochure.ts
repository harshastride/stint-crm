import 'server-only';
import { service } from './recordings';

// Course brochures sent as a private link (/b/<token>). Shared by the send and track routes and the public page.

/** The personal first page stored on brochure_send.intro. `by` says who wrote it: the AI draft or the plain fallback. */
export type Intro = {
  first_name: string;
  course: string;
  greeting: string;
  why: string[];
  answers: { q: string; a: string }[];
  next_step: string;
  by: 'ai' | 'plain';
};

export const TOKEN_RE = /^[0-9a-f]{36}$/;

/** Public address of this site: NEXT_PUBLIC_SITE_URL when set, else the address the request came to. */
export function siteUrl(request: Request) {
  const env = (process.env.NEXT_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
  if (env) return env;
  const u = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || u.host;
  const proto = request.headers.get('x-forwarded-proto') || u.protocol.replace(':', '');
  return `${proto}://${host}`;
}

/** The plain first page used when the AI draft is off or fails. States no facts beyond the lead's name and course. */
export function plainIntro(firstName: string, course: string): Intro {
  return {
    first_name: firstName, course,
    greeting: `Hi ${firstName || 'there'}, here is the ${course === 'our courses' ? 'Stint Academy' : course} brochure you asked about.`,
    why: [], answers: [],
    next_step: 'Have a question? Reply to our message and we will call you back at a time that suits you.',
    by: 'plain',
  };
}

/** The short message the staff member copies into WhatsApp. English, no contact details. */
export function whatsappText(firstName: string, course: string, url: string) {
  const what = course === 'our courses' ? 'our course brochure' : `the ${course} brochure`;
  return `Hi ${firstName || 'there'}, this is Stint Academy. Here is ${what}, with a first page written for you: ${url}`;
}

/** Turn a server-side signed storage link into the same-site /supabase/... address the browser may fetch (CSP connect-src 'self'). */
export function sameSite(signedUrl: string) {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
  if (base && signedUrl.startsWith(base)) return '/supabase' + signedUrl.slice(base.length);
  try { const u = new URL(signedUrl); return '/supabase' + u.pathname + u.search; } catch { return null; }
}

/** What the public page needs for one link. Never contact details or staff names. null = unknown or switched off. */
export async function sendForPage(token: string) {
  if (!TOKEN_RE.test(token)) return null;
  const db = service();
  const { data } = await db.from('brochure_send').select('id, intro, brochure:brochure_id(title, status, file_path)').eq('token', token).maybeSingle();
  const b = (Array.isArray(data?.brochure) ? data?.brochure[0] : data?.brochure) as { title: string; status: string; file_path: string | null } | null | undefined;
  if (!data || !b || b.status !== 'Live') return null;
  let pdf: string | null = null;
  if (b.file_path) {
    const { data: signed, error } = await db.storage.from('brochures').createSignedUrl(b.file_path, 600);
    if (error) console.error('[brochure] could not sign the file link');
    pdf = signed?.signedUrl ? sameSite(signed.signedUrl) : null;
  }
  const { data: wa } = await db.from('setting').select('value').eq('key', 'institute_whatsapp').maybeSingle();
  const digits = String(wa?.value || '').replace(/\D/g, '');
  const { data: inst } = await db.from('setting').select('value').eq('key', 'institute_name').maybeSingle();
  return {
    title: b.title, intro: (data.intro || null) as Intro | null, pdf,
    whatsapp: digits.length >= 10 && digits.length <= 15 ? digits : null,
    institute: String(inst?.value || 'Stint Academy'),
  };
}
