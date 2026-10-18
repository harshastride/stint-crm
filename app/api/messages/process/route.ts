import { NextResponse } from 'next/server';
import { fail } from '@/lib/server/guard';
import { service } from '@/lib/server/recordings';
import { cronAllowed, deliver, type MessageRow } from '@/lib/server/messaging';

export const maxDuration = 120;

// Called every few minutes by the database (pg_cron) or Activepieces with x-cron-secret.
// Sends queued outbound rows whose send_after has passed (reminders queued by the automations use this).
export async function POST(request: Request) {
  const db = service();
  if (!(await cronAllowed(db, request))) return NextResponse.json({ error: 'Not allowed.' }, { status: 401 });
  const { data, error } = await db.from('message').select('id, channel, lead_id, candidate_id, subject, body, template, to_addr')
    .eq('direction', 'out').eq('status', 'queued').lte('send_after', new Date().toISOString()).order('send_after').limit(50);
  if (error) return fail('messages/process read queue', error, 'Could not read the message queue.');
  let sent = 0, failed = 0, waiting = 0;
  for (const r of (data || []) as MessageRow[]) {
    const res = await deliver(db, r);
    if (res.ok) sent++; else if (res.notSetUp) waiting++; else failed++;
  }
  return NextResponse.json({ ok: true, sent, failed, waiting });
}
