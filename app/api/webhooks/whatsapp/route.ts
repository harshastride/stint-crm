import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { service } from '@/lib/server/recordings';
import { digits10, validSignature } from '@/lib/server/messaging';

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

type WaMsg = { from: string; id: string; type: string; text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } } };
type WaStatus = { id: string; status: string; errors?: { title?: string }[] };
const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

export async function POST(request: Request) {
  const raw = await request.text();
  if (!validSignature(raw, request.headers.get('x-hub-signature-256'))) return NextResponse.json({ error: 'Bad signature.' }, { status: 401 });
  let payload: { entry?: { changes?: { value?: { messages?: WaMsg[]; statuses?: WaStatus[] } }[] }[] };
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Bad body.' }, { status: 400 }); }
  const db = service();

  for (const e of payload.entry || []) for (const c of e.changes || []) {
    const v = c.value || {};
    for (const m of v.messages || []) {
      const { count } = await db.from('message').select('id', { count: 'exact', head: true }).eq('provider_id', m.id);
      if (count) continue; // Meta retries; store once
      const d = digits10(m.from);
      let lead_id: string | null = null, candidate_id: string | null = null;
      if (d.length === 10) {
        const { data: l } = await db.from('lead').select('id').like('mobile', '%' + d).limit(1).maybeSingle();
        if (l) lead_id = l.id;
        else {
          const { data: p } = await db.from('candidate_private').select('candidate_id').like('contact->>mobile', '%' + d).limit(1).maybeSingle();
          if (p) candidate_id = p.candidate_id;
        }
      }
      if (!lead_id && !candidate_id) continue; // unknown sender: not stored
      const body = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || `[${m.type}]`;
      await db.from('message').insert({ channel: 'whatsapp', direction: 'in', status: 'received', lead_id, candidate_id, from_addr: m.from, body: body.slice(0, 4000), provider_id: m.id, sent_at: new Date().toISOString() });
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
