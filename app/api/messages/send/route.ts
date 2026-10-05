import { NextResponse } from 'next/server';
import { asCaller, service } from '@/lib/server/recordings';
import { channelReady, deliver, type Channel, type MessageRow } from '@/lib/server/messaging';

// Per-staff rate limit (in memory, per server process): 30 sends a minute.
const hits = new Map<string, number[]>();

/** Which channels are set up (no secrets returned). */
export async function GET() {
  const { data: { user } } = await (await asCaller()).auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  return NextResponse.json({ whatsapp: channelReady('whatsapp'), email: channelReady('email') });
}

/** Staff send: the row is inserted AS the caller (row security proves they can see the person), then the server sends it.
 *  The real number/email is looked up on the server and never returned. */
export async function POST(request: Request) {
  const caller = await asCaller();
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });

  const now = Date.now(), recent = (hits.get(user.id) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 30) return NextResponse.json({ error: 'Too many messages in a minute. Please wait a moment.' }, { status: 429 });
  recent.push(now); hits.set(user.id, recent);

  const b = (await request.json().catch(() => null)) as { channel?: string; lead_id?: string; candidate_id?: string; body?: string; subject?: string; template?: string } | null;
  const channel = b?.channel as Channel;
  if (!b || !['whatsapp', 'email'].includes(channel)) return NextResponse.json({ error: 'Pick WhatsApp or email.' }, { status: 400 });
  if (!!b.lead_id === !!b.candidate_id) return NextResponse.json({ error: 'Pick one person.' }, { status: 400 });
  const body = String(b.body || '').trim().slice(0, 4000);
  if (!body) return NextResponse.json({ error: 'Type a message first.' }, { status: 400 });

  const { data: row, error } = await caller.from('message').insert({
    channel, direction: 'out', status: 'queued', created_by: user.id, body,
    lead_id: b.lead_id || null, candidate_id: b.candidate_id || null,
    subject: channel === 'email' ? String(b.subject || '').slice(0, 200) || null : null,
    template: b.template ? String(b.template).slice(0, 120) : null,
  }).select('id, channel, lead_id, candidate_id, subject, body, template').single();
  if (error || !row) return NextResponse.json({ error: 'You cannot message this person.' }, { status: 403 });

  const res = await deliver(service(), { ...(row as Omit<MessageRow, 'to_addr'>), to_addr: null });
  if (!res.ok) return NextResponse.json({ id: row.id, ok: false, notSetUp: !!res.notSetUp, error: res.error }, { status: res.notSetUp ? 503 : 502 });
  return NextResponse.json({ id: row.id, ok: true });
}
