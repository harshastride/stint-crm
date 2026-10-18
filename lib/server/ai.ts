import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

// Claude, server side only. ANTHROPIC_API_KEY is never sent to the browser.
// FAST (Haiku) does the many small jobs: call summaries, voice notes, the daily call brief.
// SMART (Sonnet) does the one weekly owner summary, where careful reading of the numbers matters.
export const MODEL_FAST = process.env.CLAUDE_MODEL_FAST || 'claude-haiku-5-5';
export const MODEL_SMART = process.env.CLAUDE_MODEL_SMART || 'claude-sonnet-5-5';

// US$ per million tokens (input, output), for the usage log. Unknown models are logged with cost 0.
const PRICE: Record<string, [number, number]> = {
  'claude-haiku-5-5': [0.1, 0.5], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20],
};

export const claudeReady = () => !!process.env.ANTHROPIC_API_KEY;

let client: Anthropic | null = null;
const claude = () => (client ??= new Anthropic({ maxRetries: 2, timeout: 90_000 }));

const logDb = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

/** One row per Claude call in ai_usage (Admin can read it): what it was for, who asked, tokens and cost. Never the text. */
async function logUsage(feature: string, staffId: string | null, model: string, inTok: number, outTok: number, ok: boolean) {
  const [pi, po] = PRICE[model] || [0, 0];
  const cost = (inTok * pi + outTok * po) / 1_000_000;
  await logDb().from('ai_usage').insert({ feature, staff_id: staffId, model, input_tokens: inTok, output_tokens: outTok, cost_usd: cost, ok })
    .then(({ error }) => { if (error) console.error('ai_usage log failed:', error.message.slice(0, 80)); });
}

/** Phone numbers, emails and long digit runs (ID, bank, card) are removed before any text goes to Claude. */
export const scrub = (s: string | null | undefined) => String(s || '')
  .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
  .replace(/(?:\+?\d[\s-]?){7,}/g, '[number]');

type Ask = {
  feature: string; staffId: string | null; model: string; system: string; prompt: string;
  schema: Record<string, unknown>; maxTokens?: number; effort?: 'low' | 'medium' | 'high';
};

/** An error whose message is plain and safe to show staff (no service names, keys or status codes).
 *  Routes may pass `message` of a SafeError straight to the browser; any other error gets the route's own generic sentence. */
export class SafeError extends Error { name = 'SafeError'; }

export const NOT_ON = 'This isn’t switched on yet. Ask the admin.';
export const BUSY = 'The service is busy. Please try again in a minute.';

/** Log the real reason on the server only: feature, step, upstream status and the first ~120 chars of the upstream message. */
const logAi = (feature: string, step: string, status?: number | string, detail?: string) =>
  console.error(`[ai] ${feature}: ${step}${status !== undefined ? ' (' + status + ')' : ''}${detail ? ': ' + detail.replace(/\s+/g, ' ').slice(0, 120) : ''}`);

/** Ask Claude for JSON that matches `schema` (structured outputs), log the cost, and return the parsed object.
 *  Every error thrown here is a SafeError with a plain message; the specific reason goes to the server log. */
export async function askJson<T>({ feature, staffId, model, system, prompt, schema, maxTokens = 4000, effort = 'low' }: Ask): Promise<T> {
  if (!claudeReady()) { logAi(feature, 'ANTHROPIC_API_KEY is not set'); throw new SafeError(NOT_ON); }
  let res: Anthropic.Message;
  try {
    res = await claude().messages.create({
      model, max_tokens: maxTokens, system,
      messages: [{ role: 'user', content: prompt }],
      output_config: { effort, format: { type: 'json_schema', schema } },
    });
  } catch (e) {
    await logUsage(feature, staffId, model, 0, 0, false);
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      logAi(feature, 'Anthropic key rejected', e.status, e.message); throw new SafeError(NOT_ON);
    }
    if (e instanceof Anthropic.RateLimitError) { logAi(feature, 'Anthropic rate limit', e.status, e.message); throw new SafeError(BUSY); }
    if (e instanceof Anthropic.APIError && e.status === 529) { logAi(feature, 'Anthropic overloaded', e.status, e.message); throw new SafeError(BUSY); }
    if (e instanceof Anthropic.APIError) { logAi(feature, 'Anthropic call failed', e.status ?? 'network', e.message); throw new SafeError('The AI assistant couldn’t answer. Please try again.'); }
    logAi(feature, 'call failed', undefined, e instanceof Error ? e.name + ': ' + e.message : 'unknown');
    throw new SafeError('The AI assistant couldn’t answer. Please try again.');
  }
  await logUsage(feature, staffId, model, res.usage.input_tokens + (res.usage.cache_read_input_tokens || 0), res.usage.output_tokens, res.stop_reason === 'end_turn');
  if (res.stop_reason === 'refusal') { logAi(feature, 'model refused'); throw new SafeError('The AI assistant couldn’t write this one.'); }
  if (res.stop_reason === 'max_tokens') { logAi(feature, 'hit max_tokens', maxTokens); throw new SafeError('The answer was too long and got cut off. Please try again.'); }
  const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
  if (!text) { logAi(feature, 'empty reply', res.stop_reason ?? undefined); throw new SafeError('The AI assistant returned nothing. Please try again.'); }
  try { return JSON.parse(text) as T; }
  catch { logAi(feature, 'reply was not valid JSON'); throw new SafeError('The AI assistant’s answer could not be read. Please try again.'); }
}

/** JSON schema helpers: structured outputs need every key listed in `required` and no extra keys. */
export const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const str = { type: 'string' };
export const strOrNull = { type: ['string', 'null'] };
export const oneOfOrNull = (values: string[]) => (values.length ? { anyOf: [{ type: 'string', enum: values }, { type: 'null' }] } : strOrNull);
