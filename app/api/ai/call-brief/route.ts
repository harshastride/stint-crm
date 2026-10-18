import { NextResponse } from 'next/server';
import { crossSite } from '@/lib/server/guard';
import { asCaller, service } from '@/lib/server/recordings';
import { askJson, claudeReady, MODEL_FAST, obj, SafeError, scrub, str } from '@/lib/server/ai';

export const maxDuration = 120;

// Daily call brief: for each lead the signed-in telecaller / sales person must call today, a short "last time" and
// "say now" note written by Claude (Haiku) from the lead's recent calls and notes. Advice only: nothing is saved to the lead.
// Leads, calls and notes are read AS THE CALLER (row security applies). Lead mobile/email are never read.

type Priority = 1 | 2 | 3;
type BriefItem = { lead_id: string; name: string; stage: string; due: string | null; priority: Priority; last_time: string; say_now: string };
type BriefBody = { overview: string; items: BriefItem[] };

type LeadRow = { id: string; full_name: string; stage: string; program_id: string | null; source_id: string | null; course_other: string | null; next_call_at: string | null; created_at: string };
type FollowRow = { lead_id: string; title: string; due_at: string };
type CallRow = { lead_id: string; called_at: string; outcome: string; notes: string | null };
type NoteRow = { lead_id: string; created_at: string; kind: string; body: string };
type ModelOut = { overview: string; items: { lead_id: string; priority: number; last_time: string; say_now: string }[] };

const MAX_LEADS = 25;
const PER_HOUR = 6;
// Light per-staff rate limit on preparing a brief (in memory, per server process).
const hits = new Map<string, number[]>();

const SYSTEM = [
  'You prepare a morning call brief for a telecaller at Stint Academy, a training and placement institute in India.',
  'For each lead you get what is due today, their last calls and their last notes. Write plain, short English that a busy telecaller can read in seconds.',
  'Only use the facts given. If there is no history, say so plainly. Never invent course fees, offers, discounts, dates or promises.',
  'Never include phone numbers, email addresses, ID, bank or card numbers.',
  'For every lead return: lead_id exactly as given; priority 1 = call first (warm, interested, ready to decide), 2 = then, 3 = low chance or no response so far;',
  'last_time = one short sentence on what happened last time; say_now = one short sentence on what to say or ask on this call.',
  'overview = one short sentence about the day as a whole (for example how many look warm).',
].join(' ');

const SCHEMA = obj({
  overview: str,
  items: { type: 'array', items: obj({ lead_id: str, priority: { type: 'integer', enum: [1, 2, 3] }, last_time: str, say_now: str }) },
});

/** Plain one-liner from model text: no line breaks, scrubbed again, clipped. */
const line = (s: unknown, max = 240) => {
  const t = scrub(String(s ?? '')).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
};
/** Free text going to Claude: scrubbed, one line, clipped. */
const clip = (s: string | null | undefined, max = 300) => line(s, max);
const day = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const earliest = (a: string | null, b: string | null) => (!a ? b : !b ? a : a < b ? a : b);

class Step extends Error {}
const must = <T>(kind: string, r: { data: T | null; error: { code?: string } | null }): T => {
  if (r.error) throw new Step(`${kind}${r.error.code ? ' (' + r.error.code + ')' : ''}`);
  return (r.data ?? []) as T;
};

export async function POST(request: Request) {
  const bad = crossSite(request); if (bad) return bad;
  const caller = await asCaller();
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const { data: staff } = await service().from('staff').select('id').eq('id', user.id).eq('status', 'Active').maybeSingle();
  if (!staff) return NextResponse.json({ error: 'Only active staff can use the call brief.' }, { status: 403 });
  const { data: canLeads } = await caller.rpc('can_page', { p: 'lead', need: 'r' });
  if (canLeads !== true) return NextResponse.json({ error: 'The call brief needs access to Leads.' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { refresh?: unknown };
  const refresh = body?.refresh === true;

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const endOfToday = `${today}T23:59:59+05:30`;

  try {
    if (!refresh) {
      const saved = await service().from('ai_brief').select('body, created_at')
        .eq('kind', 'call_brief').eq('staff_id', user.id).eq('period_start', today).maybeSingle();
      if (saved.error) throw new Step('read saved brief');
      if (saved.data) return NextResponse.json({ brief: saved.data });
    }

    const now = Date.now(), recent = (hits.get(user.id) || []).filter((t) => now - t < 3_600_000);
    if (recent.length >= PER_HOUR) return NextResponse.json({ error: 'You have refreshed the brief many times this hour. Please try again a little later.' }, { status: 429 });

    if (!claudeReady()) { console.error('ai/call-brief: ANTHROPIC_API_KEY is not set'); return NextResponse.json({ error: 'The call brief isn’t switched on yet. Ask the admin.' }, { status: 503 }); }

    recent.push(now); hits.set(user.id, recent);
    if (hits.size > 5000) for (const k of hits.keys()) { hits.delete(k); if (hits.size < 4000) break; }

    // 1. What is due today (or overdue): my open lead follow-ups, and my leads whose next call is due.
    const [fuRes, ownRes] = await Promise.all([
      caller.from('follow_up').select('lead_id, title, due_at')
        .eq('status', 'Open').eq('owner_id', user.id).not('lead_id', 'is', null).lte('due_at', endOfToday)
        .order('due_at', { ascending: true }).limit(200),
      caller.from('lead_list').select('id, next_call_at')
        .eq('owner_id', user.id).lte('next_call_at', endOfToday).not('stage', 'in', '("Converted","Not interested")')
        .order('next_call_at', { ascending: true }).limit(200),
    ]);
    const follows = must<FollowRow[]>('read follow_up', fuRes);
    const owned = must<{ id: string; next_call_at: string | null }[]>('read lead_list', ownRes);

    const dueBy = new Map<string, string | null>();
    const titles = new Map<string, string[]>();
    for (const f of follows) {
      dueBy.set(f.lead_id, earliest(dueBy.get(f.lead_id) ?? null, f.due_at));
      titles.set(f.lead_id, [...(titles.get(f.lead_id) || []), f.title]);
    }
    for (const l of owned) dueBy.set(l.id, earliest(dueBy.get(l.id) ?? null, l.next_call_at));
    const candidateIds = [...dueBy.keys()].sort((a, b) => String(dueBy.get(a) ?? '9').localeCompare(String(dueBy.get(b) ?? '9')));

    // 2. The leads themselves (only those this person may read; closed ones dropped), earliest due first, at most 25.
    let leads: LeadRow[] = [];
    if (candidateIds.length) {
      const r = await caller.from('lead_list')
        .select('id, full_name, stage, program_id, source_id, course_other, next_call_at, created_at')
        .in('id', candidateIds.slice(0, 200));
      leads = must<LeadRow[]>('read leads', r).filter((l) => l.stage !== 'Converted' && l.stage !== 'Not interested');
    }
    const byId = new Map(leads.map((l) => [l.id, l]));
    const ids = candidateIds.filter((id) => byId.has(id)).slice(0, MAX_LEADS);

    if (!ids.length) {
      const empty: BriefBody = { overview: 'Nothing is due today.', items: [] };
      return save(user.id, today, empty);
    }

    // 3. Names for program and source (if readable), last 3 calls and last 2 notes per lead, fetched in bulk.
    const programIds = [...new Set(ids.map((id) => byId.get(id)!.program_id).filter(Boolean))] as string[];
    const sourceIds = [...new Set(ids.map((id) => byId.get(id)!.source_id).filter(Boolean))] as string[];
    const [progRes, srcRes, callRes, noteRes] = await Promise.all([
      programIds.length ? caller.from('program').select('id, name').in('id', programIds) : Promise.resolve({ data: [], error: null }),
      sourceIds.length ? caller.from('lead_source').select('id, name').in('id', sourceIds) : Promise.resolve({ data: [], error: null }),
      caller.from('call_log').select('lead_id, called_at, outcome, notes').in('lead_id', ids).order('called_at', { ascending: false }).limit(600),
      caller.from('note').select('lead_id, created_at, kind, body').in('lead_id', ids).order('created_at', { ascending: false }).limit(400),
    ]);
    // program / source names are nice to have: if this role cannot read them, carry on without
    const progName = new Map(((progRes.error ? [] : progRes.data) as { id: string; name: string }[] || []).map((p) => [p.id, p.name]));
    const srcName = new Map(((srcRes.error ? [] : srcRes.data) as { id: string; name: string }[] || []).map((s) => [s.id, s.name]));
    const calls = must<CallRow[]>('read call_log', callRes);
    const notes = must<NoteRow[]>('read note', noteRes);
    const callsBy = new Map<string, CallRow[]>(), notesBy = new Map<string, NoteRow[]>();
    for (const c of calls) { const a = callsBy.get(c.lead_id) || []; if (a.length < 3) callsBy.set(c.lead_id, [...a, c]); }
    for (const n of notes) { const a = notesBy.get(n.lead_id) || []; if (a.length < 2) notesBy.set(n.lead_id, [...a, n]); }

    // 4. One compact block per lead. First name only; every free-text field scrubbed.
    const block = ids.map((id) => {
      const l = byId.get(id)!;
      const since = Math.max(0, Math.round((Date.parse(today) - Date.parse(day(l.created_at))) / 86_400_000));
      const due = titles.get(id)?.map((t) => clip(t, 120)).join('; ') || (l.next_call_at ? 'Scheduled call' : 'Call');
      const lc = (callsBy.get(id) || []).map((c) => `  - ${day(c.called_at)} · ${clip(c.outcome, 60)}${c.notes ? ' · ' + clip(c.notes) : ''}`);
      const ln = (notesBy.get(id) || []).map((n) => `  - ${day(n.created_at)} · ${clip(n.kind, 30)} · ${clip(n.body)}`);
      return [
        `lead_id: ${id}`,
        `first name: ${clip(l.full_name.split(/\s+/)[0], 40)}`,
        `stage: ${l.stage}`,
        `program: ${l.program_id ? progName.get(l.program_id) || 'not known' : clip(l.course_other, 60) || 'not chosen'}`,
        `source: ${l.source_id ? srcName.get(l.source_id) || 'not known' : 'not known'}`,
        `days since enquiry: ${since}`,
        `due today: ${due}`,
        `last calls:${lc.length ? '\n' + lc.join('\n') : ' none'}`,
        `last notes:${ln.length ? '\n' + ln.join('\n') : ' none'}`,
      ].join('\n');
    }).join('\n\n');
    const prompt = `Today is ${today}. ${ids.length} lead${ids.length === 1 ? '' : 's'} to call.\n\n${block}\n\nReturn one item for every lead above.`;

    let out: ModelOut;
    try {
      out = await askJson<ModelOut>({ feature: 'call_brief', staffId: user.id, model: MODEL_FAST, system: SYSTEM, prompt, schema: SCHEMA, maxTokens: 8000, effort: 'low' });
    } catch (e) {
      // askJson throws only SafeErrors (plain messages; the reason is already in the server log)
      if (e instanceof SafeError) return NextResponse.json({ error: e.message }, { status: 502 });
      throw new Step('model call');
    }

    // 5. Trust only the text: known lead ids, no repeats; name, stage and due come from our own data.
    const seen = new Set<string>();
    const items: BriefItem[] = [];
    for (const it of Array.isArray(out?.items) ? out.items : []) {
      const id = String(it?.lead_id || '').trim();
      if (!byId.has(id) || seen.has(id) || !ids.includes(id)) continue;
      seen.add(id);
      const l = byId.get(id)!;
      const p = Number(it.priority);
      items.push({
        lead_id: id, name: l.full_name, stage: l.stage, due: dueBy.get(id) ?? null,
        priority: (p === 1 || p === 2 ? p : 3) as Priority,
        last_time: line(it.last_time) || 'No summary — open the lead to check.',
        say_now: line(it.say_now),
      });
    }
    for (const id of ids) {
      if (seen.has(id)) continue;
      const l = byId.get(id)!;
      items.push({ lead_id: id, name: l.full_name, stage: l.stage, due: dueBy.get(id) ?? null, priority: 3, last_time: 'No summary — open the lead to check.', say_now: '' });
    }
    items.sort((a, b) => a.priority - b.priority || String(a.due ?? '9').localeCompare(String(b.due ?? '9')));

    return save(user.id, today, { overview: line(out?.overview, 300) || `${items.length} to call today.`, items });
  } catch (e) {
    // log only the step that failed, never lead names or note text
    console.error('ai/call-brief failed:', e instanceof Step ? e.message : 'unknown');
    return NextResponse.json({ error: 'Could not prepare the brief. Please try again.' }, { status: 502 });
  }
}

async function save(staffId: string, today: string, body: BriefBody) {
  const created_at = new Date().toISOString();
  const { error } = await service().from('ai_brief').upsert(
    { kind: 'call_brief', staff_id: staffId, period_start: today, period_end: today, body, model: MODEL_FAST, created_by: staffId, created_at },
    { onConflict: 'kind,staff_id,period_start' },
  );
  if (error) throw new Step(`save brief${error.code ? ' (' + error.code + ')' : ''}`);
  return NextResponse.json({ brief: { body, created_at } });
}
