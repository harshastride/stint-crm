import { NextResponse } from 'next/server';
import { claudeReady } from '@/lib/server/ai';
import { leadContext, liveCaller, tooOften, transcriptText } from '@/lib/server/live';
import { service, summarise } from '@/lib/server/recordings';

export const maxDuration = 60;

// After a live call: a short summary draft (same as recordings) for the telecaller to check in "Log call". Nothing is saved here.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const who = await liveCaller(request, body.lead_id); if ('error' in who) return who.error;
  const slow = tooOften('live-summary:' + who.user.id, 10, 10 * 60_000); if (slow) return slow;
  if (!claudeReady()) return NextResponse.json({ error: 'Live help is not set up yet.' }, { status: 503 });
  const transcript = transcriptText(body.transcript, 20000);
  if (!transcript) return NextResponse.json({ summary: 'Nothing was heard during the call.', outcome: null, follow_up: null, follow_up_when: null });
  try {
    const lead = await leadContext(who.caller, body.lead_id);
    const { data: vals } = await service().from('dropdown_value').select('value').eq('list_id', 'call_outcome').eq('active', true).order('sort');
    const draft = await summarise(transcript, (vals || []).map((v: { value: string }) => v.value), 'lead ' + (lead.firstName || 'unknown'), who.user.id);
    return NextResponse.json(draft);
  } catch (e) {
    console.error('live/summary failed:', e instanceof Error ? e.message.slice(0, 80) : 'unknown');
    return NextResponse.json({ error: 'Could not write the summary. You can still log the call yourself.' }, { status: 502 });
  }
}
