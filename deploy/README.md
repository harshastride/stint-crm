# Going live (Slice 5)

Nothing here has been run on a real server yet. Follow it top to bottom on a fresh Ubuntu server (4 GB RAM or more) with a domain pointed at it.

## 5.1 Supabase on the server

| # | Do | Command / note |
|---|---|---|
| 1 | Install Docker | `curl -fsSL https://get.docker.com \| sh` |
| 2 | Get the official self-hosted stack | `git clone --depth 1 https://github.com/supabase/supabase && cp -r supabase/docker /opt/supabase && cd /opt/supabase && cp .env.example .env` |
| 3 | New secrets (never the local ones) | On your laptop: `node scripts/gen-secrets.mjs` → paste into `/opt/supabase/.env` |
| 4 | Auth emails (SMTP) | In `.env`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_ADMIN_EMAIL`, `SMTP_SENDER_NAME="Stint Academy"`; `SITE_URL=https://crm.<your domain>`; `ENABLE_EMAIL_SIGNUP=false` (staff are invited only) |
| 4b | Idle sign-out on the server | In `docker-compose.yml`, under the `auth` service `environment:`, add `GOTRUE_SESSIONS_INACTIVITY_TIMEOUT: 30m` (keep it equal to the `idle_signout_minutes` setting). The app also signs people out after that time on screen |
| 5 | Keep the database private | Do not open port 5432 or 8000 to the internet (firewall: allow only 22, 80, 443) |
| 6 | Start | `docker compose up -d` |
| 7 | Apply the CRM schema and settings | From the project folder: `supabase db push --db-url "postgresql://postgres:<POSTGRES_PASSWORD>@<server>:5432/postgres"` (over an SSH tunnel), then run `supabase/seed.sql` once with `psql`. **Never** run `npm run seed` there (it refuses non-local databases anyway) |
| 8 | Extensions | The migrations enable `pg_cron`, `pg_net`, `pgcrypto`; the official image includes them |
| 9 | Backups | Copy `deploy/backup.sh` to the server, set `DB_CONTAINER`, add the crontab line in the file, and copy backups off the server. Test a restore once |

## 5.2 The app

| # | Do | Command / note |
|---|---|---|
| 1 | Secrets | `cp deploy/app.env.example deploy/app.env`, fill from your secret store, `chmod 600 deploy/app.env` |
| 2 | Build and start with HTTPS | `docker compose -f deploy/docker-compose.app.yml --env-file deploy/app.env up -d --build` |
| 3 | Tell the database where the app is | Admin settings → Automation log is for Activepieces; the nightly audio clean-up uses `integration_config.app_url`. Set it: `update integration_config set value='http://host.docker.internal:3100' where key='app_url';` (or the app's internal address) |
| 4 | Check | `https://crm.<domain>/login` loads; `node scripts/test-security.mjs` is for local only (it needs demo data) |

## 5.3 Real data

| # | Do | Command / note |
|---|---|---|
| 1 | First admin | `NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/create-admin.mjs "Harsha Reddy" you@stintacademy.com` → sign in, change the temporary password |
| 2 | Staff | Users & staff → Invite user (each gets a temporary password they must change) |
| 3 | Programs, batches, branches, lead sources | Fill from their pages |
| 4 | Existing leads | Admin settings → Import / export (CSV; duplicates skipped) |
| 5 | Existing students | `node scripts/import-candidates.mjs students.csv` (dry run) then `--apply` |
| 6 | Activepieces | Automation log → paste the webhook URL; give the incoming API key to the lead flows (`docs/activepieces/`) |
| 7 | Recordings | Put `SONIOX_API_KEY` and `GEMINI_API_KEY` in `deploy/app.env`, restart the app, record a test call and check the Recordings page |

## Open decisions before go-live

See `docs/BACKLOG.md` → Open decisions (discount limit, dropdown wording, sensitive-field grid, WhatsApp/email providers, phones).
