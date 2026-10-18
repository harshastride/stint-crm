import { NextResponse } from 'next/server';
import { cronAllowed } from '@/lib/server/messaging';
import { service } from '@/lib/server/recordings';
import { buildCard, postToTeams, siteUrl } from '@/lib/server/teams';

export const maxDuration = 120;

// Sends the Teams queue (teams_message). Called every minute by the database (pg_cron, call_teams_sender) with x-cron-secret.
//
// Claiming: a row is taken by an UPDATE that sets status 'Sending' and next_try_at = now(), filtered on its id AND the state
// it was read in (Pending and due, or Sending and stuck for 5+ minutes). Postgres re-checks that filter after locking each row,
// so when two runs overlap only one of them gets the row back from the update, and only returned rows are sent.

const BATCH = 50, PARALLEL = 5, MAX_ATTEMPTS = 5, STUCK_MS = 5 * 60_000;
const STOP_STARTING_AFTER_MS = 90_000; // leave room inside maxDuration; unstarted rows go back to the queue

type Claimed = { id: string; event: string; channel_id: string | null; person_name: string | null; payload: unknown; attempts: number };
const COLS = 'id, event, channel_id, person_name, payload, attempts';

export async function POST(request: Request) {
  const started = Date.now();
  const db = service();
  if (!(await cronAllowed(db, request))) return NextResponse.json({ error: 'Not allowed.' }, { status: 401 });

  const nowIso = new Date().toISOString();
  const stuckIso = new Date(started - STUCK_MS).toISOString();
  const { data: due, error } = await db.from('teams_message').select('id, status')
    .or(`and(status.eq.Pending,next_try_at.lte."${nowIso}"),and(status.eq.Sending,next_try_at.lt."${stuckIso}")`)
    .order('next_try_at').limit(BATCH);
  if (error) { console.error('[teams] read queue failed', error.code || ''); return NextResponse.json({ error: 'Could not read the queue.' }, { status: 500 }); }
  if (!due?.length) return NextResponse.json({ ok: true, sent: 0, failed: 0, retrying: 0 });

  const pendingIds = due.filter((r) => r.status === 'Pending').map((r) => r.id as string);
  const stuckIds = due.filter((r) => r.status === 'Sending').map((r) => r.id as string);
  const claimAt = new Date().toISOString();
  const [a, b] = await Promise.all([
    pendingIds.length
      ? db.from('teams_message').update({ status: 'Sending', next_try_at: claimAt })
        .in('id', pendingIds).eq('status', 'Pending').lte('next_try_at', nowIso).select(COLS)
      : Promise.resolve({ data: [] as Claimed[], error: null }),
    stuckIds.length
      ? db.from('teams_message').update({ status: 'Sending', next_try_at: claimAt })
        .in('id', stuckIds).eq('status', 'Sending').lt('next_try_at', stuckIso).select(COLS)
      : Promise.resolve({ data: [] as Claimed[], error: null }),
  ]);
  if (a.error || b.error) console.error('[teams] claim failed', a.error?.code || b.error?.code || '');
  const rows = [...((a.data || []) as Claimed[]), ...((b.data || []) as Claimed[])];
  if (!rows.length) return NextResponse.json({ ok: true, sent: 0, failed: 0, retrying: 0 });

  const channelIds = [...new Set(rows.map((r) => r.channel_id).filter((x): x is string => !!x))];
  const { data: chans, error: chErr } = channelIds.length
    ? await db.from('teams_channel').select('id, active, webhook_url_secret').in('id', channelIds)
    : { data: [], error: null };
  if (chErr) {
    // Could not read the channels: give the rows back untouched rather than marking them failed.
    await db.from('teams_message').update({ status: 'Pending', next_try_at: new Date().toISOString() }).in('id', rows.map((r) => r.id)).eq('status', 'Sending');
    console.error('[teams] read channels failed', chErr.code || '');
    return NextResponse.json({ error: 'Could not read the channels.' }, { status: 500 });
  }
  const channel = new Map((chans || []).map((c) => [c.id as string, c as { id: string; active: boolean; webhook_url_secret: string }]));
  const site = await siteUrl().catch(() => '');

  let sent = 0, failed = 0, retrying = 0;
  const putBack: string[] = [];

  const settle = (id: string, patch: Record<string, unknown>) =>
    db.from('teams_message').update(patch).eq('id', id).eq('status', 'Sending').then(({ error: e }) => { if (e) console.error('[teams] save result failed', e.code || ''); });

  async function handle(r: Claimed) {
    const ch = r.channel_id ? channel.get(r.channel_id) : undefined;
    if (!ch || !ch.active) {
      failed++;
      return settle(r.id, { status: 'Failed', last_error: 'Channel is switched off or removed' });
    }
    const res = await postToTeams(ch.webhook_url_secret, buildCard(r.event, r.payload, site, r.person_name));
    if (res.ok) {
      sent++;
      return settle(r.id, { status: 'Sent', sent_at: new Date().toISOString(), last_error: null });
    }
    const attempts = (r.attempts || 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      failed++;
      return settle(r.id, { status: 'Failed', attempts, last_error: res.error });
    }
    retrying++;
    return settle(r.id, { status: 'Pending', attempts, last_error: res.error, next_try_at: new Date(Date.now() + 2 ** attempts * 60_000).toISOString() });
  }

  // A few at a time, so one slow channel does not hold up the rest and Teams is not flooded.
  let next = 0;
  async function worker() {
    while (next < rows.length) {
      const r = rows[next++];
      if (Date.now() - started > STOP_STARTING_AFTER_MS) { putBack.push(r.id); continue; }
      try { await handle(r); }
      catch { retrying++; await settle(r.id, { status: 'Pending', attempts: (r.attempts || 0) + 1, last_error: 'Could not send', next_try_at: new Date(Date.now() + 60_000).toISOString() }); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, rows.length) }, worker));

  if (putBack.length) {
    retrying += putBack.length;
    await db.from('teams_message').update({ status: 'Pending', next_try_at: new Date().toISOString() }).in('id', putBack).eq('status', 'Sending');
  }

  return NextResponse.json({ ok: true, sent, failed, retrying });
}
