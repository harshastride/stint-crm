import { NextResponse } from 'next/server';
import { cronAllowed } from '@/lib/server/messaging';
import { processDue } from '@/lib/server/meta-process';
import { service } from '@/lib/server/recordings';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Saves Meta leads that are still waiting (or stuck). Called every minute by the database (pg_cron, call_meta_processor)
// with x-cron-secret. The claiming rules are in lib/server/meta-process.ts.
export async function POST(request: Request) {
  const db = service();
  if (!(await cronAllowed(db, request))) return NextResponse.json({ error: 'Not allowed.' }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await processDue(db)) });
  } catch {
    console.error('[meta] process run failed');
    return NextResponse.json({ error: 'Could not process the Meta leads.' }, { status: 500 });
  }
}
