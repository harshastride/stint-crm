import 'server-only';
import { NextResponse } from 'next/server';
import { crossSite, isUuid, limited } from './guard';
import { asCaller, service } from './recordings';
import { scrub } from './ai';

// Live help during a call: shared checks and the lead + playbook context the tips are built from.

export type Line = { speaker: string; text: string };

/** Same-site, signed in, active staff who may log calls on leads, and the lead is one they can see. */
export async function liveCaller(request: Request, leadId: unknown) {
  const bad = crossSite(request); if (bad) return { error: bad };
  const caller = await asCaller();
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Please sign in.' }, { status: 401 }) };
  const { data: staff } = await service().from('staff').select('id').eq('id', user.id).eq('status', 'Active').maybeSingle();
  if (!staff) return { error: NextResponse.json({ error: 'Only active staff can use live help.' }, { status: 403 }) };
  const { data: may } = await caller.rpc('can_page', { p: 'call', need: 'w' });
  if (may !== true) return { error: NextResponse.json({ error: 'Your role cannot log calls, so live help is off for you.' }, { status: 403 }) };
  if (leadId !== undefined) {
    if (!isUuid(leadId)) return { error: NextResponse.json({ error: 'Which lead?' }, { status: 400 }) };
    const { data: lead } = await caller.from('lead_list').select('id').eq('id', leadId).maybeSingle();
    if (!lead) return { error: NextResponse.json({ error: 'You can’t see that lead.' }, { status: 403 }) };
  }
  return { user, caller };
}

export const tooOften = (key: string, max: number, windowMs: number) =>
  limited(key, max, windowMs) ? NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 }) : null;

/** The transcript as plain lines, newest last, capped, with phone numbers, emails and long digit runs removed. */
export function transcriptText(lines: unknown, maxChars = 6000): string {
  const arr = (Array.isArray(lines) ? lines : []).slice(-80)
    .map((l) => ({ speaker: String((l as Line)?.speaker || 'Speaker').slice(0, 20), text: scrub(String((l as Line)?.text || '')).slice(0, 600) }))
    .filter((l) => l.text.trim());
  let out = arr.map((l) => `${l.speaker}: ${l.text}`).join('\n');
  if (out.length > maxChars) out = '…' + out.slice(-maxChars);
  return out;
}

/** What the CRM knows about the lead (read as the caller, so row security applies; never mobile or email). */
export async function leadContext(caller: Awaited<ReturnType<typeof asCaller>>, leadId: string) {
  const { data: l } = await caller.from('lead_list')
    .select('full_name, stage, currently, preferred_mode, preferred_start, course_other, created_at, program_id, program:program_id(name), source:source_id(name)')
    .eq('id', leadId).maybeSingle();
  const { data: calls } = await caller.from('call_log').select('outcome, notes, called_at').eq('lead_id', leadId).order('called_at', { ascending: false }).limit(3);
  const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x);
  const program = one(l?.program as { name: string } | { name: string }[] | null)?.name || l?.course_other || 'not decided';
  const lines = [
    `First name: ${String(l?.full_name || '').split(' ')[0] || 'unknown'}`,
    `Stage: ${l?.stage || 'unknown'}`, `Course they asked about: ${program}`,
    l?.currently ? `Currently: ${l.currently}` : '', l?.preferred_mode ? `Preferred mode: ${l.preferred_mode}` : '',
    l?.preferred_start ? `Wants to start: ${l.preferred_start}` : '',
    `Came from: ${one(l?.source as { name: string } | { name: string }[] | null)?.name || 'unknown'}`,
    ...(calls || []).map((c) => `Earlier call ${new Date(c.called_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}: ${c.outcome}${c.notes ? ' — ' + scrub(c.notes).slice(0, 240) : ''}`),
  ].filter(Boolean);
  return { text: lines.join('\n'), programId: (l?.program_id as string | null) || null, firstName: String(l?.full_name || '').split(' ')[0] };
}

/** The Sales playbook for this course (and for every course), live items only. Read with the service client:
 *  telecallers may read it anyway, and Live help must work for any role that may log calls. */
export async function playbookText(programId: string | null) {
  let q = service().from('playbook_item').select('kind, title, answer, program_id').eq('status', 'Live').order('kind').limit(120);
  q = programId ? q.or(`program_id.is.null,program_id.eq.${programId}`) : q.is('program_id', null);
  const { data } = await q;
  const items = data || [];
  const by = (k: string) => items.filter((i) => i.kind === k);
  const sec = (title: string, rows: string[]) => (rows.length ? `${title}:\n${rows.map((r) => '- ' + r).join('\n')}` : `${title}: (none written yet)`);
  return {
    count: items.length,
    text: [
      sec('Selling points', by('Selling point').map((i) => i.title)),
      sec('Facts we can quote', by('Fact we can quote').map((i) => i.title)),
      sec('Doubts and approved answers', by('Doubt and answer').map((i) => `If they say "${i.title}" → ${i.answer}`)),
      sec('Never say', by('Never say').map((i) => i.title)),
    ].join('\n\n'),
  };
}
