import { NextResponse } from 'next/server';
import { askJson, claudeReady, MODEL_FAST, obj, str } from '@/lib/server/ai';
import { crossSite, fail, isUuid } from '@/lib/server/guard';
import { leadContext, playbookText, tooOften } from '@/lib/server/live';
import { asCaller, service } from '@/lib/server/recordings';
import { plainIntro, siteUrl, whatsappText, type Intro } from '@/lib/server/brochure';

export const maxDuration = 30;

// POST { lead_id, brochure_id } → { url, whatsappText, intro }
// Signed-in active staff who can see the lead and open the Brochures page. Writes the personal first page
// (AI draft from the lead's details and the Sales playbook only; a plain page if that is off or fails), then makes the link.
// Never reads or returns the lead's mobile or email.

type Draft = { greeting: string; why_this_course: { point: string; ref: string }[]; answers: { q: string; a: string; ref: string }[]; next_step: string };

const SCHEMA = obj({
  greeting: str,
  why_this_course: { type: 'array', items: obj({ point: str, ref: str }) },
  answers: { type: 'array', items: obj({ q: str, a: str, ref: str }) },
  next_step: str,
});

const SYSTEM = `You write the first page of a course brochure that Stint Academy (a training and placement institute in India) sends to one lead.
The lead reads it on their phone, so keep it short, warm and plain English. Speak to the lead as "you".

Rules:
- Use ONLY the lead details and the Sales playbook given. Never invent fees, discounts, offers, dates, batch timings, durations,
  placement numbers, salaries or company names. If the playbook does not state a fact, do not mention it.
- Follow "Never say" strictly. Never promise a job.
- greeting: one or two sentences, starting "Hi <first name>," and saying which course this brochure is about and what they told us
  (for example the mode or start they prefer), only if those details are given.
- why_this_course: exactly 2 short points (under 20 words each) from the playbook "Selling points" or "Facts we can quote" that fit
  this lead; ref is the [P…] reference of the item used. If the playbook has fewer, return fewer.
- answers: up to 3 questions this lead is likely to have (from their earlier calls and situation), each answered ONLY with a
  "Doubts and approved answers" item; q is the question in the lead's words (under 12 words), a is the approved answer
  (under 35 words), ref is that item's [P…] reference. Return an empty list if no approved answer fits.
- next_step: one sentence inviting them to reply to the message to ask a question or book a call. No dates or prices.`;

const line = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export async function POST(request: Request) {
  const bad = crossSite(request); if (bad) return bad;
  const body = await request.json().catch(() => ({}));
  if (!isUuid(body.lead_id) || !isUuid(body.brochure_id)) return NextResponse.json({ error: 'Pick the lead and the brochure.' }, { status: 400 });

  const caller = await asCaller();
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const db = service();
  const { data: staff } = await db.from('staff').select('id').eq('id', user.id).eq('status', 'Active').maybeSingle();
  if (!staff) return NextResponse.json({ error: 'Only active staff can send brochures.' }, { status: 403 });
  const { data: may } = await caller.rpc('can_page', { p: 'brochures', need: 'r' });
  if (may !== true) return NextResponse.json({ error: 'Your role can’t send brochures.' }, { status: 403 });
  const slow = tooOften('brochure-send:' + user.id, 10, 60_000); if (slow) return slow;

  // the lead as the caller sees it (row security), and the brochure as the caller sees it
  const { data: lead } = await caller.from('lead_list').select('id').eq('id', body.lead_id).maybeSingle();
  if (!lead) return NextResponse.json({ error: 'You can’t see that lead.' }, { status: 403 });
  const { data: bro } = await caller.from('brochure').select('id, title, status, file_path, program_id, program:program_id(name)').eq('id', body.brochure_id).maybeSingle();
  if (!bro) return NextResponse.json({ error: 'That brochure isn’t available to you.' }, { status: 404 });
  if (bro.status !== 'Live') return NextResponse.json({ error: 'That brochure is switched off. Pick another one.' }, { status: 409 });
  if (!bro.file_path) return NextResponse.json({ error: 'That brochure has no PDF yet. Ask the admin to upload it.' }, { status: 409 });

  try {
    const ctx = await leadContext(caller, body.lead_id);
    const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x);
    const course = one(bro.program as { name: string } | { name: string }[] | null)?.name || ctx.text.match(/^Course they asked about: (.+)$/m)?.[1]?.replace(/^not decided$/, '') || 'our courses';
    let intro: Intro = plainIntro(ctx.firstName, course);

    if (claudeReady()) {
      try {
        // the brochure's course decides the playbook; a brochure for every course uses the lead's course
        const playbook = await playbookText((bro.program_id as string | null) || ctx.programId);
        const out = await askJson<Draft>({
          feature: 'brochure_intro', staffId: user.id, model: MODEL_FAST, effort: 'low', maxTokens: 1200, system: SYSTEM, schema: SCHEMA,
          prompt: `Brochure: ${line(bro.title, 120)} (course: ${course})\n\nLead details:\n${ctx.text}\n\nSales playbook:\n${playbook.text}`,
        });
        // keep only points and answers that cite a real playbook item of the right kind: nothing the playbook doesn't say
        const kinds = new Map(playbook.refs.map((r) => [r.ref, r.kind]));
        const ref = (x: unknown) => String(x ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        const why = (Array.isArray(out.why_this_course) ? out.why_this_course : [])
          .filter((p) => ['Selling point', 'Fact we can quote'].includes(kinds.get(ref(p?.ref)) || ''))
          .map((p) => line(p.point, 160)).filter(Boolean).slice(0, 2);
        const answers = (Array.isArray(out.answers) ? out.answers : [])
          .filter((a) => kinds.get(ref(a?.ref)) === 'Doubt and answer')
          .map((a) => ({ q: line(a.q, 120), a: line(a.a, 320) })).filter((a) => a.q && a.a).slice(0, 3);
        const greeting = line(out.greeting, 300);
        if (greeting) intro = { ...intro, greeting, why, answers, next_step: line(out.next_step, 200) || intro.next_step, by: 'ai' };
      } catch (e) {
        // AI is optional here: send with the plain first page, log the reason (no personal data)
        console.error('[brochure] intro draft failed:', e instanceof Error ? e.message.slice(0, 80) : 'unknown');
      }
    }

    const { data: sent, error } = await db.from('brochure_send')
      .insert({ brochure_id: bro.id, lead_id: body.lead_id, sent_by: user.id, intro })
      .select('id, token').single();
    if (error || !sent) return fail('brochures/send insert', error, 'Couldn’t make the link. Please try again.');
    const url = `${siteUrl(request)}/b/${sent.token}`;
    return NextResponse.json({ id: sent.id, url, whatsappText: whatsappText(ctx.firstName, course, url), intro });
  } catch (e) {
    return fail('brochures/send', e, 'Couldn’t make the link. Please try again.');
  }
}
