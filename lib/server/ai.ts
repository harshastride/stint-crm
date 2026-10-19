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
// A key made at organisation level (not inside a workspace) also needs the workspace id: set ANTHROPIC_WORKSPACE_ID.
const claude = () => (client ??= new Anthropic({ maxRetries: 2, timeout: 90_000,
  defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } : undefined }));

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

/** Ask Claude for JSON that matches `schema` (structured outputs), log the cost, and return the parsed object. */
export async function askJson<T>({ feature, staffId, model, system, prompt, schema, maxTokens = 4000, effort = 'low' }: Ask): Promise<T> {
  if (!claudeReady()) throw new Error('ANTHROPIC_API_KEY is not set on the server.');
  let res: Anthropic.Message;
  try {
    res = await claude().messages.create({
      model, max_tokens: maxTokens, system,
      messages: [{ role: 'user', content: prompt }],
      output_config: { effort, format: { type: 'json_schema', schema } },
    });
  } catch (e) {
    await logUsage(feature, staffId, model, 0, 0, false);
    // the reason only (never the text sent), so the admin can see why in the server log
    if (e instanceof Anthropic.APIError) console.error(`claude ${feature} failed: ${e.status ?? 'network'} ${String(e.message).slice(0, 160)}`);
    if (e instanceof Anthropic.AuthenticationError) throw new Error('The Claude key is wrong or switched off.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Claude is busy right now. Please try again in a minute.');
    if (e instanceof Anthropic.APIError && /workspace/i.test(String(e.message))) throw new Error('The Claude key is not inside a workspace. Make a key inside a workspace, or set ANTHROPIC_WORKSPACE_ID.');
    if (e instanceof Anthropic.APIError) throw new Error(`Claude failed (${e.status ?? 'network'}).`);
    throw e;
  }
  await logUsage(feature, staffId, model, res.usage.input_tokens + (res.usage.cache_read_input_tokens || 0), res.usage.output_tokens, res.stop_reason === 'end_turn');
  if (res.stop_reason === 'refusal') throw new Error('Claude declined to write this one.');
  if (res.stop_reason === 'max_tokens') throw new Error('The answer was too long and got cut off.');
  const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
  if (!text) throw new Error('Claude returned nothing.');
  return JSON.parse(text) as T;
}

/** JSON schema helpers: structured outputs need every key listed in `required` and no extra keys. */
export const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const str = { type: 'string' };
export const strOrNull = { anyOf: [{ type: 'string' }, { type: 'null' }] };
export const oneOfOrNull = (values: string[]) => (values.length ? { anyOf: [{ type: 'string', enum: values }, { type: 'null' }] } : strOrNull);
