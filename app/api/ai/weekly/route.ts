import { NextResponse } from 'next/server';
import { askJson, claudeReady, MODEL_SMART, obj, str } from '@/lib/server/ai';
import { crossSite, limited } from '@/lib/server/guard';
import { cronAllowed } from '@/lib/server/messaging';
import { asCaller, service } from '@/lib/server/recordings';

export const maxDuration = 120;

// Weekly owner summary. Every Monday 08:00 India time the database (pg_cron, x-cron-secret) calls this; the Admin can also
// press "Write it now" on the dashboard. The numbers are counted in the database (owner_week_facts); Claude only reads them
// and writes the words. Both are saved in ai_brief so the owner can check every figure against the counts.

type OwnerWeekBody = {
  headline: string;
  went_well: string[];
  needs_attention: { issue: string; action: string }[];
  keep_an_eye_on: string[];
};

const SCHEMA = obj({
  headline: str,
  went_well: { type: 'array', items: str },
  needs_attention: { type: 'array', items: obj({ issue: str, action: str }) },
  keep_an_eye_on: { type: 'array', items: str },
});

const SYSTEM = `You write a weekly summary for the owner of Stint Academy, a training and placement institute in India.
The owner is a busy founder who reads it in one minute. Write plain, short English. Each list item is one sentence.

Rules:
- Use ONLY numbers that are present in the facts. Never estimate, never guess, never compute percentages or rates.
- Where the facts give this week and the previous week (keys ending in "_previous"), always compare them, like "52 new leads, up from 40 the week before".
- If something is missing or zero in both weeks, say "no data" or leave it out rather than guessing a reason.
- Amounts in "fees_inr" are Indian rupees. Write them in the Indian style, like ₹1,25,000.
- Name staff only exactly as they appear in the facts. Do not mention anyone else.
- Do not set or mention targets; the facts contain none.
- Suggest practical actions: who should do what this week (a named person from the facts, or a team such as telecallers, counsellors, finance, placement).

What the facts mean:
- "week" is the 7 India days counted (from, to) and the 7 days before (previous_from, previous_to).
- leads.new: leads created in the week. leads.new_by_source: this week's new leads by source.
- calls.made: calls logged in the week. calls.by_caller: calls per person this week and the week before. calls.outcomes: this week's call results.
- counselling_booked: counselling sessions created in the week. quotes_sent: fee quotes created in the week.
- enrolments.new: candidates added (enrolled) in the week, by_program for this week.
- fees_inr.collected: fee payments received with a paid date in the week.
- placements.new: placements recorded in the week.
- These are counts right now, not for the week: leads.open_by_stage, leads.open_not_called_7_days (open leads older than 7 days with no call in the last 7 days),
  quotes_waiting_approval, fees_inr.overdue_amount and overdue_payments, placements.joining_soon, follow_ups (open and past due, by owner), alerts (open now; alerts.open_by_kind groups them by kind, such as "Follow-up missed").

Write:
- headline: the single most important thing about the week, one sentence.
- went_well: at most 3 items.
- needs_attention: at most 3 items, each an issue and a suggested action for this week.
- keep_an_eye_on: at most 3 items worth watching that need no action yet.
An empty list is fine when there is nothing true to say.`;

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/** Today's date in India as YYYY-MM-DD. */
const indiaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const readable = (ymd: string) => new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const clean = (a: unknown): string[] => (Array.isArray(a) ? a : []).map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 3);

export async function POST(request: Request) {
  const db = service();
  let adminId: string | null = null;

  // 1. Who is asking: the Monday job (x-cron-secret) or a signed-in Admin on the dashboard.
  if (request.headers.has('x-cron-secret')) {
    if (!(await cronAllowed(db, request))) return NextResponse.json({ error: 'Not allowed.' }, { status: 401 });
  } else {
    const bad = crossSite(request); if (bad) return bad;
    const caller = await asCaller();
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
    const { data: admin } = await caller.rpc('is_admin');
    if (admin !== true) return NextResponse.json({ error: 'Only the Admin can write the weekly summary.' }, { status: 403 });
    if (limited('ai-weekly:' + user.id, 5, 60 * 60_000))
      return NextResponse.json({ error: 'The summary was rewritten several times in the last hour. Please try again later.' }, { status: 429 });
    adminId = user.id;
  }

  if (!claudeReady()) return NextResponse.json({ error: 'The weekly summary is not set up yet. Add the Claude key on the server.' }, { status: 503 });

  // 2. The week: the 7 India days ending yesterday (on Monday morning that is Monday to Sunday).
  const pEnd = isoDay(new Date(Date.parse(indiaToday() + 'T00:00:00Z') - DAY));

  let stage = 'facts';
  try {
    const { data: facts, error } = await db.rpc('owner_week_facts', { p_end: pEnd });
    if (error || !facts?.week?.from) throw new Error('facts');
    const week = facts.week as { from: string; to: string; previous_from: string; previous_to: string };

    stage = 'ai';
    const prompt = `This week: ${readable(week.from)} to ${readable(week.to)}.\nPrevious week: ${readable(week.previous_from)} to ${readable(week.previous_to)}.\n\n`
      + `Facts counted by the CRM (JSON):\n${JSON.stringify(facts, null, 2)}`;
    const out = await askJson<OwnerWeekBody>({
      feature: 'owner_week', staffId: adminId, model: MODEL_SMART, effort: 'medium', maxTokens: 6000, system: SYSTEM, prompt, schema: SCHEMA,
    });
    const body: OwnerWeekBody = {
      headline: String(out.headline ?? '').trim(),
      went_well: clean(out.went_well),
      needs_attention: (Array.isArray(out.needs_attention) ? out.needs_attention : [])
        .map((x) => ({ issue: String(x?.issue ?? '').trim(), action: String(x?.action ?? '').trim() }))
        .filter((x) => x.issue).slice(0, 3),
      keep_an_eye_on: clean(out.keep_an_eye_on),
    };

    stage = 'save';
    const created_at = new Date().toISOString();
    const { error: saveErr } = await db.from('ai_brief').upsert({
      kind: 'owner_week', staff_id: null, period_start: week.from, period_end: week.to, body, facts, model: MODEL_SMART, created_by: adminId, created_at,
    }, { onConflict: 'kind,staff_id,period_start' });
    if (saveErr) throw new Error('save');

    // The Monday run (not a manual Rewrite) also goes out as an event, so Teams alerts can post it to the owner's channel.
    if (!adminId) {
      const { error: evErr } = await db.rpc('emit_event', { ev: 'summary.weekly', ent: 'report', eid: null, who: null, data: { week: { from: week.from, to: week.to }, ...body } });
      if (evErr) console.error('ai/weekly: could not queue the Teams post:', evErr.code);
    }

    return NextResponse.json({ brief: { period_start: week.from, period_end: week.to, body, facts, created_at } });
  } catch (e) {
    // log only where it failed and the error kind, never the numbers or the text
    const kind = e instanceof Error ? e.name + (stage === 'ai' && !(e instanceof SyntaxError) ? ': ' + e.message.slice(0, 80) : '') : 'unknown';
    console.error(`ai/weekly failed at ${stage}:`, kind);
    const message = stage === 'facts' ? 'Could not count last week’s numbers. Please try again.'
      : stage === 'save' ? 'The summary was written but could not be saved. Please try again.'
      : e instanceof Error && !(e instanceof SyntaxError) && e.constructor === Error ? e.message
      : 'Could not write the summary. Please try again.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
