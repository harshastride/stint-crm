// Error text shown to staff and students must be plain: no outside service names, setting names,
// status codes or database wording. Messages the database writes on purpose (business rules) pass through.

const NETWORK = /failed to fetch|networkerror|load failed|fetch failed|network request failed|econn|enotfound|no connection/i;
const SIGNED_OUT = /jwt expired|invalid jwt|jwt|PGRST30\d|session (?:has )?expired|refresh token/i;
const TECHNICAL = new RegExp([
  'deepgram', 'claude', 'anthropic', 'haiku', 'sonnet', 'gemini', 'google ai', 'openai', '\\bgpt', 'supabase', 'postgrest', 'pgrst', 'infisical',
  'service.?role', 'api.?key', 'schema cache', 'relation "', 'column "', 'function [\\w.]+\\(', 'does not exist', 'syntax', 'violates', 'constraint',
  'null value', 'duplicate key', 'invalid input', 'timed? ?out', '\\bhttps?\\b', 'status(?: code)?:? ?[1-5]\\d\\d', '^[1-5]\\d\\d\\b',
  'internal server error', 'bad gateway', 'service unavailable', 'bad request', 'typeerror', 'referenceerror', 'unexpected token', 'json',
  'undefined', '<\\/?[a-z]+[ >]', '\\bat [\\w.<>]+ \\(',
].join('|'), 'i');
// Setting names such as SOME_SERVICE_KEY (upper case words joined by underscores).
const SETTING_NAME = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/;

/** The message as it is when it is already plain; otherwise a generic line (`fallback`). */
export function plainMessage(msg: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const m = typeof msg === 'string' ? msg.replace(/^ERROR:\s*/, '').trim() : '';
  if (!m) return fallback;
  if (NETWORK.test(m)) return 'Couldn’t reach the server. Check the internet and try again.';
  if (SIGNED_OUT.test(m)) return 'You were signed out. Please sign in again.';
  if (TECHNICAL.test(m) || SETTING_NAME.test(m) || m.length > 220) return fallback;
  return m;
}
