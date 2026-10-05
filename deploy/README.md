# Going live: Coolify + Infisical (main path)

Nothing here has been run on a real server yet. Fresh Ubuntu 24.04 server, 4 GB RAM or more, a domain (e.g. `crm.stintacademy.com`) pointed at it.

| Piece | Where it runs |
|---|---|
| Database + login (Supabase) | Docker on the server, `/opt/supabase` (official compose) |
| CRM app | Coolify, built from GitHub `harshastride/stint-crm` with the repo `Dockerfile` |
| Secrets | Infisical, environment **prod** (never reuse **dev** values) |
| HTTPS | Coolify's proxy (Traefik + Let's Encrypt) |
| Backups | `deploy/backup.sh` nightly, encrypted, 14 days, copy off-server |

## 1. Server basics

| # | Do | Command / note |
|---|---|---|
| 1 | Updates + Docker | `apt update && apt upgrade -y`, then `curl -fsSL https://get.docker.com \| sh` |
| 2 | Firewall: only 22, 80, 443 | `ufw default deny incoming && ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable` |
| 3 | Docker ignores ufw for published ports | Never publish Postgres (5432), Kong (8000) or Studio to `0.0.0.0`. In `/opt/supabase/docker-compose.yml` bind them to `127.0.0.1:` (e.g. `"127.0.0.1:8000:8000"`). Check from your laptop: `nc -zv <server> 5432` must fail |
| 4 | SSH keys only | `PasswordAuthentication no` in `/etc/ssh/sshd_config`, `systemctl restart ssh` |

## 2. Supabase on the server

| # | Do | Command / note |
|---|---|---|
| 1 | Get the official stack | `git clone --depth 1 https://github.com/supabase/supabase && cp -r supabase/docker /opt/supabase && cd /opt/supabase && cp .env.example .env` |
| 2 | New secrets (never the local ones) | On your laptop `node scripts/gen-secrets.mjs` → save in Infisical **prod** (`POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `DASHBOARD_PASSWORD`) → paste into `/opt/supabase/.env`, `chmod 600 .env` |
| 3 | Auth emails (SMTP) | In `.env`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_ADMIN_EMAIL`, `SMTP_SENDER_NAME="Stint Academy"`, `SITE_URL=https://crm.<domain>`, `ENABLE_EMAIL_SIGNUP=false` |
| 4 | Idle sign-out | In `docker-compose.yml`, `auth` service `environment:` add `GOTRUE_SESSIONS_INACTIVITY_TIMEOUT: 30m` (same as setting `idle_signout_minutes`) |
| 5 | Start | `docker compose up -d` |
| 6 | CRM schema + settings | Over an SSH tunnel (`ssh -L 5433:127.0.0.1:5432 <server>`): `supabase db push --db-url "postgresql://postgres:<POSTGRES_PASSWORD>@127.0.0.1:5433/postgres"`, then `psql ... -f supabase/seed.sql` once. **Never** `npm run seed` / `seed-demo` / `seed-student` there |
| 7 | Extensions | Migrations use `pg_cron`, `pg_net`, `pgcrypto`; the official image has them |

## 3. App on Coolify

| # | Do | Command / note |
|---|---|---|
| 1 | Install Coolify | `curl -fsSL https://cdn.coollabs.io/coolify/install.sh \| bash`, open `http://<server>:8000` once over an SSH tunnel, create the admin, then close that port (firewall above already does) |
| 2 | Connect GitHub | Sources → GitHub App → give access to `harshastride/stint-crm` only |
| 3 | New resource | Project → Add → Application → the repo, branch `main`, **Build pack: Dockerfile** (repo root `Dockerfile`: Next standalone, non-root user, healthcheck on `/login`) |
| 4 | Port | Ports exposes `3100` |
| 5 | Reach Supabase | `NEXT_PUBLIC_SUPABASE_URL=http://host.docker.internal:8000` and in Custom Docker options add `--add-host=host.docker.internal:host-gateway` (or put the app on the Supabase docker network and use `http://kong:8000`) |
| 6 | Build-time values | Mark `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as **Build Variable** (they are baked into the browser bundle). Everything else is runtime only |
| 7 | Auto-deploy | Turn on "Auto deploy" on push to `main` |
| 8 | Health | Coolify uses the Dockerfile `HEALTHCHECK`; a failed check keeps the old version running |

## 4. Secrets: Infisical prod → Coolify

| # | Do | Command / note |
|---|---|---|
| 1 | Put every key in Infisical **prod** | Names as in `deploy/app.env.example` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DEEPGRAM_API_KEY`, `GEMINI_API_KEY`, `COACH_URL`, `COACH_SSO_SECRET`, messaging keys) + `BACKUP_PASSPHRASE` |
| 2 | Sync to Coolify (pick one) | **a)** Infisical → Integrations → Coolify (native sync, keeps Coolify updated) **or b)** on your laptop: `infisical export --env=prod --format=dotenv` and paste into Coolify → Environment Variables (Developer view). Do not save that file to disk |
| 3 | Service key stays server-only | `SUPABASE_SERVICE_ROLE_KEY` must **not** be a Build Variable and never `NEXT_PUBLIC_` |
| 4 | After changing a key | Redeploy in Coolify (build variables need a rebuild, runtime ones a restart) |

## 5. HTTPS domain

| # | Do | Command / note |
|---|---|---|
| 1 | DNS | `A` record `crm.<domain>` → server IP |
| 2 | Coolify | Application → Domains: `https://crm.<domain>` → Save → Redeploy. Let's Encrypt certificate is automatic |
| 3 | Supabase knows the site | `SITE_URL=https://crm.<domain>` in `/opt/supabase/.env`, `docker compose up -d` |
| 4 | Database knows the app | `update integration_config set value='http://host.docker.internal:3100' where key='app_url';` (the app's internal address, used by the nightly audio clean-up) |
| 5 | Check | `https://crm.<domain>/login` loads with a padlock; `http://` redirects to `https://` |

## 6. Backups (nightly, encrypted, off-site)

`deploy/backup.sh`: `pg_dump` (custom format, compressed) of `public`, `auth`, `storage` → encrypted with gpg AES-256 using `BACKUP_PASSPHRASE` → keeps 14 days → optional copy with rclone. `deploy/restore.sh` puts one back.

| # | Do | Command / note |
|---|---|---|
| 1 | Tools | `apt install -y gnupg rclone` |
| 2 | Off-site storage | `rclone config` → an S3-compatible bucket (Backblaze B2, Cloudflare R2, AWS S3) or Google Drive. Name it e.g. `offsite` |
| 3 | Backup settings file | `/etc/stint-backup.env` (`chmod 600`): `BACKUP_PASSPHRASE=…` (from Infisical prod), `DB_CONTAINER=supabase-db`, `RCLONE_REMOTE=offsite:stint-backups`, optional `BACKUP_DIR`, `KEEP_DAYS=14` |
| 4 | Keep the passphrase twice | In Infisical prod **and** offline (password manager). Without it the backups cannot be opened |
| 5 | Cron (02:15 daily) | `crontab -e` → `15 2 * * * set -a; . /etc/stint-backup.env; /opt/stint-crm/deploy/backup.sh >> /var/log/stint-backup.log 2>&1` |
| 6 | Files too | Resumes/documents/recordings are in `/opt/supabase/volumes/storage`: add `15 3 * * * rclone sync /opt/supabase/volumes/storage offsite:stint-storage` |
| 7 | Test a restore (monthly) | `docker exec supabase-db createdb -U postgres stint_restore_test` → `set -a; . /etc/stint-backup.env; DB_CONTAINER=supabase-db deploy/restore.sh <file>.dump.gpg postgresql://postgres:<PW>@localhost:5432/stint_restore_test` → compare counts (`select count(*) from lead` etc.) → `docker exec supabase-db dropdb -U postgres stint_restore_test`. One "schema public already exists" message is normal |
| 8 | Real disaster | New server → steps 1–2 → `RESTORE_FLAGS="--clean --if-exists"` restore into `postgres` → copy storage back → redeploy app |

Tested locally (5 Oct 2026): backup 388 KB, restore into a throwaway DB matched row counts (candidate 10, fee_payment 21, staff 14, auth.users 18, dropdown_value 132, 67 tables).

## 7. Go-live checklist

| ✓ | Check |
|---|---|
| ☐ | All keys are new for prod (Supabase JWT/anon/service/Postgres/dashboard, Deepgram, Gemini, Coach SSO, WhatsApp, email, backup passphrase). None equal to dev in Infisical |
| ☐ | Demo data never seeded: `select count(*) from auth.users where email like '%@demo.stint.local'` returns 0 |
| ☐ | First Admin made with `scripts/create-admin.mjs` (section 8), temporary password changed |
| ☐ | Ports: only 22/80/443 open from outside (`nmap <server>`) |
| ☐ | HTTPS works, `SITE_URL` correct, sign-up disabled |
| ☐ | Backup ran last night, file is in the off-site bucket, a test restore matched counts |
| ☐ | Storage folder syncs off-site |
| ☐ | Coolify healthcheck green; auto-deploy on `main` |
| ☐ | Dependencies: `npm audit --omit=dev` shows 0 vulnerabilities |

## 8. Real data (after go-live)

| # | Do | Command / note |
|---|---|---|
| 1 | First admin | `NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/create-admin.mjs "Harsha Reddy" you@stintacademy.com` → sign in, change the temporary password |
| 2 | Staff | Users & staff → Invite user (each gets a temporary password they must change) |
| 3 | Programs, batches, branches, lead sources | Fill from their pages |
| 4 | Existing leads | Admin settings → Import / export (CSV; duplicates skipped) |
| 5 | Existing students | `node scripts/import-candidates.mjs students.csv` (dry run) then `--apply` |
| 6 | Activepieces | Automation log → paste the webhook URL; give the incoming API key to the lead flows (`docs/activepieces/`) |
| 7 | Recordings | Put `DEEPGRAM_API_KEY` and `GEMINI_API_KEY` in `deploy/app.env`, restart the app, record a test call and check the Recordings page |


## Alternative: plain docker compose (no Coolify)

| # | Do | Command / note |
|---|---|---|
| 1 | Secrets | `cp deploy/app.env.example deploy/app.env`, fill from Infisical prod, `chmod 600 deploy/app.env` (or `infisical run --env=prod -- docker compose ...`) |
| 2 | Build and start with HTTPS (Caddy) | `docker compose -f deploy/docker-compose.app.yml --env-file deploy/app.env up -d --build` |
| 3 | Then | Sections 5.3–5.4, 6, 7 above still apply |

## Open decisions before go-live

See `docs/BACKLOG.md` → Open decisions (discount limit, dropdown wording, sensitive-field grid, WhatsApp/email providers, phones).
