import { NextResponse } from 'next/server';
import { crossSite, isUuid, limited } from '@/lib/server/guard';
import { asCaller, service } from '@/lib/server/recordings';
import { askJson, claudeReady, MODEL_FAST, obj, SafeError, scrub, str } from '@/lib/server/ai';
import { playbookText } from '@/lib/server/live';

export const maxDuration = 60;

// Win-back message: a short WhatsApp-style draft for a lost or quiet lead that answers why they were lost, using only
// what the Sales playbook says (offers, fees, facts). A draft for staff to check, never sent from here.
// The lead's reason, course and notes come from winback_context, called AS THE CALLER (it refuses leads they can't see);
// notes arrive with numbers and emails already removed. Mobile and email are never read.

const LANGS = ['English', 'Telugu', 'Hindi'] as const;
type Lang = (typeof LANGS)[number];
type Ctx = {
  first_name: string; stage: string; kind: string | null; reason: string | null; days_since: number | null; last_outcome: string | null;
  program_id: string | null; course: string | null; currently: string | null; preferred_mode: string | null; preferred_start: string | null;
  notes: { on: string; what: string; text: string | null }[]; earlier_messages: (string | null)[];
};
type Out = { message: string; uses_playbook: string[] };

const SYSTEM = [
  'You write one short follow-up message from a staff member at Stint Academy (a training and placement institute in India) to a person who enquired earlier but did not join, or stopped replying.',
  'The goal: answer the reason they gave (or the likely reason) honestly and invite them to talk again. Warm, respectful, no pressure, no guilt.',
  'Facts rule: fees, discounts, instalment plans, batch dates, placement numbers, offers and promises may ONLY come from the Sales playbook given. If the playbook does not cover their reason, do not make up an answer: just check in, say things may have changed, and offer a short call.',
  'Never use anything listed under "Never say". Never include phone numbers, email addresses, links or prices that are not in the playbook.',
  'Keep it under 70 words, 2–4 short sentences, plain words, at most one emoji (or none). Address them by first name. End with the staff member\'s first name and "Stint Academy".',
  'If earlier win-back messages are shown, do not repeat them; take a different angle.',
  'Language: write in the language asked. For Telugu or Hindi use the native script and simple everyday words; common English words like course, batch, fees, placement may stay in English as people say them.',
  'uses_playbook = the reference codes (like P3) of the playbook items you used; empty if none.',
].join(' ');

const SCHEMA = obj({ message: str, uses_playbook: { type: 'array', items: str } });

const clip = (s: unknown, max: number) => {
  const t = scrub(String(s ?? '')).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
};

export async function POST(request: Request) {
  const bad = crossSite(request); if (bad) return bad;
  const caller = await asCaller();
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const { data: staff } = await service().from('staff').select('id, full_name').eq('id', user.id).eq('status', 'Active').maybeSingle();
  if (!staff) return NextResponse.json({ error: 'Only active staff can write win-back messages.' }, { status: 403 });
  const { data: may } = await caller.rpc('can_page', { p: 'winback', need: 'r' });
  if (may !== true) return NextResponse.json({ error: 'Your role can’t open the Win-back list.' }, { status: 403 });

  const b = (await request.json().catch(() => null)) as { lead_id?: unknown; language?: unknown } | null;
  if (!isUuid(b?.lead_id)) return NextResponse.json({ error: 'Which lead?' }, { status: 400 });
  const language: Lang = LANGS.includes(b?.language as Lang) ? (b!.language as Lang) : 'English';
  if (limited('winback-msg:' + user.id, 20, 60_000)) return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 });
  if (!claudeReady()) { console.error('ai/winback-message: ANTHROPIC_API_KEY is not set'); return NextResponse.json({ error: 'Message writing isn’t switched on yet. Ask the admin.' }, { status: 503 }); }

  try {
    const { data, error } = await caller.rpc('winback_context', { p_lead: b!.lead_id });
    if (error || !data) {
      if (error?.code !== '42501' && error?.code !== 'P0002') console.error('ai/winback-message: context', error?.code || 'empty');
      return NextResponse.json({ error: 'You can’t see this lead.' }, { status: 403 });
    }
    const c = data as Ctx;
    const pb = await playbookText(c.program_id);

    const notes = (c.notes || []).map((n) => `- ${clip(n.on, 20)} · ${clip(n.what, 40)}${n.text ? ' · ' + clip(n.text, 300) : ''}`);
    const earlier = (c.earlier_messages || []).filter(Boolean).map((m) => '- ' + clip(m, 400));
    const prompt = [
      `Write the message in ${language}.`,
      `Staff member's first name: ${clip(String(staff.full_name || '').split(/\s+/)[0], 30) || 'the team'}`,
      '',
      'About the person:',
      `First name: ${clip(c.first_name, 40) || 'there'}`,
      `Why they are on the list: ${c.kind === 'Went quiet' ? 'stopped replying' : 'said not interested'}${c.days_since != null ? `, ${c.days_since} days ago` : ''}`,
      `Reason recorded: ${clip(c.reason, 80) || 'none recorded'}`,
      `Course they asked about: ${clip(c.course, 80) || 'not decided'}`,
      c.currently ? `Currently: ${clip(c.currently, 80)}` : '',
      c.preferred_mode ? `Preferred mode: ${clip(c.preferred_mode, 40)}` : '',
      c.preferred_start ? `Wanted to start: ${clip(c.preferred_start, 60)}` : '',
      c.last_outcome ? `Last call result: ${clip(c.last_outcome, 60)}` : '',
      `Last notes (newest first):${notes.length ? '\n' + notes.join('\n') : ' none'}`,
      earlier.length ? `Earlier win-back messages already sent (do not repeat):\n${earlier.join('\n')}` : '',
      '',
      pb.count ? `Sales playbook (the only source of facts and offers):\n${pb.text}` : 'Sales playbook: nothing written yet, so make no offers and quote no facts.',
    ].filter((l) => l !== '').join('\n');

    let out: Out;
    try {
      out = await askJson<Out>({ feature: 'winback_message', staffId: user.id, model: MODEL_FAST, system: SYSTEM, prompt, schema: SCHEMA, maxTokens: 1200, effort: 'low' });
    } catch (e) {
      if (e instanceof SafeError) return NextResponse.json({ error: e.message }, { status: e.message.includes('switched on') ? 503 : 502 });
      throw e;
    }

    const message = scrub(String(out?.message || '')).trim().slice(0, 1200);
    if (!message) return NextResponse.json({ error: 'The draft came back empty. Please try again.' }, { status: 502 });
    const byRef = new Map(pb.refs.map((r) => [r.ref, r.title]));
    const uses = [...new Set((Array.isArray(out?.uses_playbook) ? out.uses_playbook : []).map((r) => String(r).trim().toUpperCase()))]
      .filter((r) => byRef.has(r)).map((r) => byRef.get(r)!).slice(0, 6);
    return NextResponse.json({ message, uses_playbook: uses, playbook_items: pb.count });
  } catch (e) {
    console.error('ai/winback-message failed:', e instanceof Error ? e.name : 'unknown');
    return NextResponse.json({ error: 'Could not write the message. Please try again.' }, { status: 502 });
  }
}
