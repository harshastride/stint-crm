// Makes the secrets a new self-hosted Supabase needs (go-live step 5.1). Prints them; it saves nothing.
// Put them in the server's secret store / Supabase .env, never in git.   node scripts/gen-secrets.mjs
import crypto from 'node:crypto';

const b64url = (b) => Buffer.from(b).toString('base64url');
const rand = (n) => crypto.randomBytes(n).toString('base64url');
const jwtSecret = rand(48);
const sign = (role) => {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const iat = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ role, iss: 'supabase', iat, exp: iat + 10 * 365 * 24 * 3600 }));
  return `${head}.${body}.${crypto.createHmac('sha256', jwtSecret).update(`${head}.${body}`).digest('base64url')}`;
};
console.log(`# Supabase server (.env of the official docker compose)
POSTGRES_PASSWORD=${rand(24)}
JWT_SECRET=${jwtSecret}
ANON_KEY=${sign('anon')}
SERVICE_ROLE_KEY=${sign('service_role')}
DASHBOARD_USERNAME=stint-admin
DASHBOARD_PASSWORD=${rand(18)}
SECRET_KEY_BASE=${rand(48)}
VAULT_ENC_KEY=${rand(24).slice(0, 32)}
PG_META_CRYPTO_KEY=${rand(24).slice(0, 32)}

# CRM app (deploy/app.env)
NEXT_PUBLIC_SUPABASE_ANON_KEY=<same as ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<same as SERVICE_ROLE_KEY>
COACH_SSO_SECRET=${rand(32)}   # same value as the Interview Coach STINT_SSO_SECRET`);
