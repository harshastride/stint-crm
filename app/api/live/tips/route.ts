import { NextResponse } from 'next/server';
import { askJson, claudeReady, MODEL_FAST, obj, str } from '@/lib/server/ai';
import { leadContext, liveCaller, playbookText, tooOften, transcriptText } from '@/lib/server/live';

export const maxDuration = 30;

type Tips = { they_said: string; say_this: string; still_to_cover: string[]; ask_for: string; careful: string | null };

const SCHEMA = obj({
  they_said: str, say_this: str,
  still_to_cover: { type: 'array', items: str },
  ask_for: str,
  careful: { anyOf: [{ type: 'string' }, { type: 'null' }] },
});

const SYSTEM = `You help a telecaller at Stint Academy, a training and placement institute in India, DURING a live phone call with a lead.
The telecaller glances at your tips while talking, so every line must be short, spoken English they can say aloud right now.

Rules:
- Use ONLY the Sales playbook and the lead details given. Never invent fees, discounts, offers, dates, batch timings, placement numbers or salaries.
  If the lead asks something the playbook does not answer, say_this should be: offer to check and call back (or book a counselling session).
- Follow "Never say" strictly. Never promise a job.
- The transcript has two speakers from automatic speech recognition; work out which one is the telecaller (the one speaking for Stint).
  The speech may mix English, Telugu and Hindi and may have recognition mistakes.
- they_said: what the lead just said or is worried about, in under 15 words.
- say_this: the best next thing to say, 1–2 sentences, warm and honest, using a doubt-and-answer or selling point that fits.
- still_to_cover: up to 3 short playbook points not yet discussed that matter for this lead.
- ask_for: the one next step to ask for now (for example booking a free counselling session or a demo class), in under 15 words.
- careful: a short warning only if the telecaller said something risky or against the playbook, else null.`;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const who = await liveCaller(request, body.lead_id); if ('error' in who) return who.error;
  const slow = tooOften('live-tips:' + who.user.id, 20, 60_000); if (slow) return slow;
  if (!claudeReady()) return NextResponse.json({ error: 'Live help is not set up yet.' }, { status: 503 });
  const transcript = transcriptText(body.transcript);
  if (!transcript) return NextResponse.json({ error: 'Nothing was said yet.' }, { status: 400 });
  try {
    const lead = await leadContext(who.caller, body.lead_id);
    const playbook = await playbookText(lead.programId);
    const out = await askJson<Tips>({
      feature: 'live_tips', staffId: who.user.id, model: MODEL_FAST, effort: 'low', maxTokens: 1500, system: SYSTEM, schema: SCHEMA,
      prompt: `Lead details:\n${lead.text}\n\nSales playbook:\n${playbook.text}\n\nCall so far (newest last):\n${transcript}`,
    });
    const line = (s: unknown, n = 240) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
    return NextResponse.json({
      they_said: line(out.they_said, 160), say_this: line(out.say_this, 400), ask_for: line(out.ask_for, 160),
      still_to_cover: (Array.isArray(out.still_to_cover) ? out.still_to_cover : []).map((x) => line(x, 120)).filter(Boolean).slice(0, 3),
      careful: out.careful ? line(out.careful, 200) : null,
      playbook_items: playbook.count,
    });
  } catch (e) {
    console.error('live/tips failed:', e instanceof Error ? e.message.slice(0, 80) : 'unknown');
    return NextResponse.json({ error: e instanceof Error && e.constructor === Error ? e.message : 'Could not get tips. Keep talking; they will try again.' }, { status: 502 });
  }
}
