import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { service } from '@/lib/server/recordings';
import { captureInbound, validSignature } from '@/lib/server/messaging';

// Meta WhatsApp Cloud API webhook. Register: https://<your-domain>/api/webhooks/whatsapp

/** Verification handshake when the webhook is registered in Meta. */
export async function GET(request: Request) {
  const u = new URL(request.url);
  const want = process.env.WHATSAPP_VERIFY_TOKEN || '';
  const got = u.searchParams.get('hub.verify_token') || '';
  const ok = u.searchParams.get('hub.mode') === 'subscribe' && !!want && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
  if (!ok) return new NextResponse('Forbidden', { status: 403 });
  return new NextResponse(u.searchParams.get('hub.challenge') || '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

type WaMsg = { from: string; id: string; type: string; timestamp?: string; text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } } };
type WaStatus = { id: string; status: string; errors?: { title?: string }[] };
const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

export async function POST(request: Request) {
  const raw = await request.text();
  if (!validSignature(raw, request.headers.get('x-hub-signature-256'))) return NextResponse.json({ error: 'Bad signature.' }, { status: 401 });
  let payload: { entry?: { changes?: { value?: { messages?: WaMsg[]; statuses?: WaStatus[]; contacts?: { wa_id?: string; profile?: { name?: string } }[] } }[] }[] };
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Bad body.' }, { status: 400 }); }
  const db = service();

  for (const e of payload.entry || []) for (const c of e.changes || []) {
    const v = c.value || {};
    const names = new Map((v.contacts || []).map((k) => [k.wa_id || '', k.profile?.name || null]));
    for (const m of v.messages || []) {
      const body = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || `[${m.type}]`;
      // Known lead or student: stored on them. Unknown number: a new conversation (or a lead, if auto-create is on)
      // with one friendly auto-reply a day. Retries of the same message are stored once (provider id).
      const sent = m.timestamp && /^\d+$/.test(m.timestamp) ? new Date(Number(m.timestamp) * 1000).toISOString() : null;
      await captureInbound(db, { channel: 'whatsapp', number: m.from, body: body.slice(0, 4000), providerId: m.id, profileName: names.get(m.from) || null, at: sent });
    }
    for (const s of v.statuses || []) {
      if (!(s.status in RANK)) continue;
      const { data: row } = await db.from('message').select('id, status').eq('provider_id', s.id).eq('direction', 'out').maybeSingle();
      if (!row || (RANK[s.status] <= (RANK[row.status] ?? 0) && s.status !== 'failed')) continue;
      await db.from('message').update({ status: s.status, error: s.status === 'failed' ? String(s.errors?.[0]?.title || 'Not delivered').slice(0, 200) : null }).eq('id', row.id);
    }
  }
  return NextResponse.json({ ok: true });
}
