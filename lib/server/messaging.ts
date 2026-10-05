import 'server-only';
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

// WhatsApp (Meta Cloud API) and email (Resend or SMTP). Keys are read only here, on the server.
// Missing keys never crash: the send returns ok:false with a plain "not set up" reason.

export type Channel = 'whatsapp' | 'email';
export type SendResult = { ok: true; providerId: string | null } | { ok: false; error: string; notSetUp?: boolean };
export type MessageRow = { id: string; channel: Channel; lead_id: string | null; candidate_id: string | null; subject: string | null; body: string | null; template: string | null; to_addr: string | null };

const GRAPH = 'https://graph.facebook.com/v21.0';

export const whatsappReady = () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
export const emailReady = () => {
  const p = (process.env.EMAIL_PROVIDER || '').toLowerCase();
  if (!process.env.EMAIL_FROM) return false;
  if (p === 'resend') return !!process.env.RESEND_API_KEY;
  if (p === 'smtp') return !!process.env.SMTP_HOST;
  return false;
};
export const channelReady = (c: Channel) => (c === 'whatsapp' ? whatsappReady() : emailReady());

/** Last 10 digits, for matching Indian numbers stored with or without +91. */
export const digits10 = (v: string | null | undefined) => String(v || '').replace(/\D/g, '').slice(-10);
const waNumber = (v: string) => { const d = String(v).replace(/\D/g, ''); return d.length === 10 ? '91' + d : d; };

/** Fill {{first_name}}, {{name}} and any other {{key}} present in vars. Unknown keys are left blank. */
export function fillTemplate(body: string, vars: Record<string, string>) {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? '');
}

/** Real address of the person, read with the service role. Never returned to the browser. */
export async function resolveContact(svc: SupabaseClient, row: { lead_id: string | null; candidate_id: string | null }) {
  if (row.lead_id) {
    const { data } = await svc.from('lead').select('full_name, mobile, email').eq('id', row.lead_id).maybeSingle();
    return data ? { name: String(data.full_name || ''), mobile: data.mobile as string | null, email: data.email as string | null } : null;
  }
  if (row.candidate_id) {
    const [{ data: c }, { data: p }] = await Promise.all([
      svc.from('candidate').select('full_name').eq('id', row.candidate_id).maybeSingle(),
      svc.from('candidate_private').select('contact').eq('candidate_id', row.candidate_id).maybeSingle(),
    ]);
    if (!c) return null;
    const contact = (p?.contact || {}) as { mobile?: string; email?: string };
    return { name: String(c.full_name || ''), mobile: contact.mobile || null, email: contact.email || null };
  }
  return null;
}

/** Was there an inbound WhatsApp from this person in the last 24 hours (free text allowed)? */
export async function insideWindow(svc: SupabaseClient, row: { lead_id: string | null; candidate_id: string | null }) {
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  let q = svc.from('message').select('id', { count: 'exact', head: true }).eq('channel', 'whatsapp').eq('direction', 'in').gte('created_at', since);
  q = row.lead_id ? q.eq('lead_id', row.lead_id) : q.eq('candidate_id', row.candidate_id!);
  const { count } = await q;
  return (count || 0) > 0;
}

async function sendWhatsApp(to: string, body: string, template: string | null, freeText: boolean): Promise<SendResult> {
  if (!whatsappReady()) return { ok: false, notSetUp: true, error: 'WhatsApp is not set up yet. Ask the admin to add the WhatsApp keys.' };
  const payload = freeText || !template
    ? { messaging_product: 'whatsapp', to: waNumber(to), type: 'text', text: { body } }
    : { messaging_product: 'whatsapp', to: waNumber(to), type: 'template', template: { name: template, language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: body.slice(0, 1000) }] }] } };
  if (!freeText && !template) return { ok: false, error: 'More than 24 hours since their last reply: pick an approved template.' };
  try {
    const r = await fetch(`${GRAPH}/${process.env.WHATSAPP_PHONE_ID}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const j = (await r.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!r.ok) return { ok: false, error: 'WhatsApp refused: ' + String(j.error?.message || r.status).slice(0, 160) };
    return { ok: true, providerId: j.messages?.[0]?.id || null };
  } catch { return { ok: false, error: 'Could not reach WhatsApp. Will retry.' }; }
}

async function sendEmail(to: string, subject: string, body: string): Promise<SendResult> {
  if (!emailReady()) return { ok: false, notSetUp: true, error: 'Email is not set up yet. Ask the admin to add the email keys.' };
  const from = process.env.EMAIL_FROM!;
  if ((process.env.EMAIL_PROVIDER || '').toLowerCase() === 'resend') {
    try {
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject, text: body }) });
      const j = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!r.ok) return { ok: false, error: 'Email refused: ' + String(j.message || r.status).slice(0, 160) };
      return { ok: true, providerId: j.id || null };
    } catch { return { ok: false, error: 'Could not reach the email service. Will retry.' }; }
  }
  // SMTP uses nodemailer if it is installed (optional; not a dependency by default).
  try {
    const mod = 'nodemailer';
    const nm = (await import(/* webpackIgnore: true */ mod).catch(() => null)) as { createTransport: (o: unknown) => { sendMail: (m: unknown) => Promise<{ messageId?: string }> } } | null;
    if (!nm) return { ok: false, notSetUp: true, error: 'SMTP needs the "nodemailer" package. Use EMAIL_PROVIDER=resend or install it.' };
    const t = nm.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: Number(process.env.SMTP_PORT) === 465, auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined });
    const info = await t.sendMail({ from, to, subject, text: body });
    return { ok: true, providerId: info.messageId || null };
  } catch { return { ok: false, error: 'The SMTP server refused the email.' }; }
}

/** Send one queued row (service-role client). Updates the row; never throws. */
export async function deliver(svc: SupabaseClient, row: MessageRow): Promise<SendResult> {
  let res: SendResult;
  const who = await resolveContact(svc, row);
  if (!who) res = { ok: false, error: 'The person was not found.' };
  else {
    const first = who.name.split(/\s+/)[0] || '';
    const body = fillTemplate(row.body || '', { first_name: first, name: who.name });
    if (row.channel === 'whatsapp') {
      if (!who.mobile) res = { ok: false, error: 'No mobile number on record.' };
      else res = await sendWhatsApp(who.mobile, body, row.template, !row.template || (await insideWindow(svc, row)));
    } else {
      if (!who.email) res = { ok: false, error: 'No email address on record.' };
      else res = await sendEmail(who.email, fillTemplate(row.subject || 'Message from Stint Academy', { first_name: first, name: who.name }), body);
    }
    if (res.ok) {
      await svc.from('message').update({ status: 'sent', sent_at: new Date().toISOString(), provider_id: res.providerId, error: null, body, to_addr: row.channel === 'whatsapp' ? who.mobile : who.email }).eq('id', row.id);
      return res;
    }
  }
  // Not set up: keep it queued so it goes out once keys are added. Other errors: mark failed.
  await svc.from('message').update(res.notSetUp ? { error: res.error } : { status: 'failed', error: res.error }).eq('id', row.id);
  return res;
}

/** Meta webhook signature: X-Hub-Signature-256 = "sha256=" + HMAC(app secret, raw body). */
export function validSignature(raw: string, header: string | null) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header?.startsWith('sha256=')) return false;
  const want = Buffer.from('sha256=' + crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex'));
  const got = Buffer.from(header);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/** Cron secret check, same as recordings cleanup. */
export async function cronAllowed(svc: SupabaseClient, request: Request) {
  const { data: cfg } = await svc.from('integration_config').select('value').eq('key', 'cron_secret').single();
  const got = request.headers.get('x-cron-secret') || '';
  return !!cfg?.value && got.length === cfg.value.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(cfg.value));
}
