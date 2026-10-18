import { NextResponse } from 'next/server';
import { crossSite, fail, limited } from '@/lib/server/guard';
import { asCaller } from '@/lib/server/recordings';
import { postToTeams, siteUrl } from '@/lib/server/teams';
import { TEAMS_EVENTS, TEAMS_EVENT_LABEL } from '@/lib/teams-events';

// "Send a test" on the Teams alerts page: posts a short card to one channel so the Admin can see the link works.
// The channel and its rules are read as the signed-in person, so row security decides who may do this.

export async function POST(request: Request) {
  const bad = crossSite(request); if (bad) return bad;
  try {
    const caller = await asCaller();
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
    const { data: allowed } = await caller.rpc('can_page', { p: 'teams', need: 'w' });
    if (allowed !== true) return NextResponse.json({ error: 'Only someone who can change Teams alerts can send a test.' }, { status: 403 });
    if (limited('teams-test:' + user.id, 10, 60 * 60_000))
      return NextResponse.json({ error: 'Many tests in the last hour. Please try again later.' }, { status: 429 });

    const body = (await request.json().catch(() => null)) as { audience?: unknown } | null;
    const audience = typeof body?.audience === 'string' ? body.audience.trim() : '';
    if (!audience || audience.length > 80) return NextResponse.json({ error: 'Pick a channel to test.' }, { status: 400 });

    const [{ data: ch, error: chErr }, { data: rules }] = await Promise.all([
      caller.from('teams_channel').select('name, audience, webhook_url_secret').eq('audience', audience).maybeSingle(),
      caller.from('teams_rule').select('event').eq('audience', audience).eq('active', true),
    ]);
    if (chErr) return fail('teams test', chErr, 'Could not read the channel.');
    if (!ch) return NextResponse.json({ error: 'There is no Teams channel for this group yet. Add its link first.' }, { status: 404 });

    // Labels in the order the Teams alerts page lists them; unknown events by their raw name at the end.
    const chosen = new Set((rules || []).map((r) => String(r.event)));
    const labels = [...TEAMS_EVENTS.filter((e) => chosen.has(e.event)).map((e) => e.label), ...[...chosen].filter((e) => !TEAMS_EVENT_LABEL[e])];
    const gets = labels.length ? labels.join(', ') : 'nothing yet — choose events on the Teams alerts page';

    const site = await siteUrl().catch(() => '');
    const link = site ? `${site}/p/teams` : '';
    const card = {
      type: 'message',
      attachments: [{
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            { type: 'TextBlock', text: 'Test message from Stint CRM', weight: 'Bolder', size: 'Medium', wrap: true },
            { type: 'TextBlock', text: `This is the ${clean(ch.name)} channel (${clean(ch.audience)}). It will get: ${gets}.`, wrap: true },
          ],
          actions: link ? [{ type: 'Action.OpenUrl', title: 'Open Teams alerts', url: link }] : [],
        },
      }],
    };

    const res = await postToTeams(String(ch.webhook_url_secret || ''), card);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail('teams test', e, 'Could not send the test. Please try again.');
  }
}

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').replace(/\[/g, '(').replace(/\]/g, ')').trim().slice(0, 120);
