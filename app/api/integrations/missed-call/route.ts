import { NextResponse } from 'next/server';
import { limited } from '@/lib/server/guard';
import { bad, withKey } from '@/lib/server/integration';
import { captureInbound } from '@/lib/server/messaging';

// Missed call to the institute's tracking number (call-tracking service → automation → here).
// POST JSON with header  x-api-key: <incoming key, same as /api/integrations/lead>
//   { "number": "+91 98765 43210", "called_at"?: "2026-10-19T10:42:00+05:30" }
// New number → a lead (source "Missed call", owner by the assignment rule) + a "Call back missed call" follow-up due now
// + one friendly WhatsApp reply (queued until WhatsApp is switched on). The same number again within 24 hours changes nothing.
// The response never contains the number.
export async function POST(request: Request) {
  const a = await withKey(request); if ('error' in a) return a.error;
  if (limited('missed-call', 240)) return bad('Too many calls in a minute. Please try again shortly.', 429);
  const b = (await request.json().catch(() => null)) as { number?: unknown; called_at?: unknown } | null;
  if (!b) return bad('Send JSON.');
  const number = String(b.number ?? '').replace(/\D/g, '');
  if (number.length < 10 || number.length > 15) return bad('number must be a phone number (10 digits, or with the country code).');
  let at: string | null = null;
  if (b.called_at != null && b.called_at !== '') {
    const d = new Date(String(b.called_at));
    if (isNaN(d.getTime())) return bad('called_at is not a valid date.');
    at = d.toISOString();
  }
  const r = await captureInbound(a.db, { channel: 'missed_call', number, at });
  if ('error' in r) return bad('Could not save the missed call.', 500);
  const x = r.result;
  return NextResponse.json({
    ok: true, kind: x.kind, lead_id: x.lead_id ?? null, candidate_id: x.candidate_id ?? null,
    created: !!x.created, duplicate: !!x.duplicate, ignored: x.kind === 'ignored', reply: r.reply,
  }, { status: x.created ? 201 : 200 });
}
