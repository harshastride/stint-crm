import { NextResponse } from 'next/server';
import { sendDueMeta } from '@/lib/server/ads';
import { cronAllowed } from '@/lib/server/messaging';
import { service } from '@/lib/server/recordings';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Sends waiting Meta conversions (Conversions API). Called every minute by the database (pg_cron, call_ad_sender) with
// x-cron-secret, only while Meta is switched on and something is due. Claiming and retries: lib/server/ads.ts.
export async function POST(request: Request) {
  const db = service();
  if (!(await cronAllowed(db, request))) return NextResponse.json({ error: 'Not allowed.' }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await sendDueMeta(db)) });
  } catch {
    console.error('[ads] send run failed');
    return NextResponse.json({ error: 'Could not send the ad conversions.' }, { status: 500 });
  }
}
