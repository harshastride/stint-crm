# Stint CRM — notes for Claude Code

Training and placement CRM for Stint Academy (single institute). The owner, Harsha, is a founder, not a developer: explain in short plain language, use tables, avoid long text.

## Stack
- Next.js 15 App Router + Tailwind (`app/`, `components/`, `lib/`), React 19, TypeScript strict.
- Self-hosted Supabase (Postgres, GoTrue, PostgREST) via the Supabase CLI in Docker. No separate backend server.
- The browser never calls Supabase directly: it calls `/supabase/*` on this app (rewrite in `next.config.mjs`). Server code uses `NEXT_PUBLIC_SUPABASE_URL`. Auth cookie name is `sb-stint-auth-token` everywhere.

## Commands
| Do | Command |
|---|---|
| Start database | `supabase start` (API 55321, DB 55322, Studio 55323) |
| Start app | `npm run dev` → http://localhost:3100 |
| Start app with keys from Infisical | `npm run dev:secure` (also `seed:secure`, `test:secure`; project linked in `.infisical.json`) |
| Wipe and rebuild database | `supabase db reset` then `npm run seed` |
| Type check | `npm run typecheck` |
| Security and rules tests | `node scripts/test-security.mjs` (needs seeded data; must stay 100% passing) |
| Build | `npm run build` |
| Browser tests | `npm run test:e2e` (Playwright; app on 3100, demo data) |
| All tests | `npm test` |
| Go live | `deploy/README.md` |

Demo logins: `<name>@demo.stint.local` / `stint-demo-1234` (harsha Admin, anita Front desk, divya Marketing, teja Telecaller, manish Sales, praveen HR / Counsellor, kiran Trainer, hemanth SME, lakshmi Placement, suresh Finance; student portal: priya, linked to candidate Priya Reddy, via `scripts/seed-student.mjs`).

## How the code is organised
- `lib/pages.ts`: one config per list page (table, columns, views, KPIs, board, form fields). Most page changes are edits here.
- `components/ListPage.tsx`, `EditorPanel.tsx`, `QuickPanel.tsx`, `Fields.tsx`: the four shared blocks. `components/special/*`: dashboard, enquiry, enrolment, attendance, roles grid, dropdowns, import. `app/(app)/candidate/[id]`: Candidate 360.
- `lib/session.tsx`: current staff member, page access (`can(page, 'r'|'w')`), dropdown lists, reference tables.
- `supabase/migrations/*`: tables, row security, logic, report views. `supabase/seed.sql`: roles, pages, permission grid, dropdown values (generated from the design; no people). `scripts/seed-demo.mjs`: demo logins and sample people.

## Rules to keep
1. Permissions are enforced in the database. Every new table needs RLS policies tied to a page id through `can_page(page, 'r'|'w')`. The screen only hides things.
2. Sensitive candidate details (contact, family, identity, bank) live in `candidate_private` and are read or written only through `candidate_private_get/set`, which mask or hide by role.
3. Business rules that must never be skipped go in the database (triggers/functions), not in React.
4. Schema changes are new migration files; never edit an applied migration. After a schema change run `supabase db reset`, `npm run seed`, and the tests.
5. Add a check to `scripts/test-security.mjs` for every new table or rule.
6. Never put the service role key in client code. It is used only in `app/api/*` and scripts.
7. Dropdown choices come from `dropdown_list` / `dropdown_value`; do not hard-code option lists that staff should be able to change.
8. UI: Stint brand tokens in `app/globals.css` (Poppins, accent #4474B9, coral #FF6B35), light and dark themes, 44px touch targets, plain wording, no typing where a dropdown fits.
9. Do not put real people's ID, bank or contact details in seeds, tests or fixtures.
10. Job papers (`job_record`, `job_paper`) track documents for a job the candidate actually holds; the checklist is derived from the real joining and leaving dates. Do not add features that produce or back-date employment documents.
11. Lead `mobile`/`email` are not selectable by signed-in users: read `lead_list` / `mobile_masked` and use `reveal_contact` (logged in `data_access_log`). Time limits come from settings `old_data_days`, `alumni_lock_days`, `idle_signout_minutes`, `reveal_seconds`.
12. Deletes are recoverable: a `before delete` trigger (`aa_bin`) copies every business row to `recycle_bin` (Admin-only page Recycle bin, `restore_deleted(grp)`, kept `bin_keep_days`). New business tables need the `aa_bin` trigger too (see migration 081).

## Where to look next
Integrations: `docs/activepieces/` (events, incoming leads), Teams alerts (Admin page `teams`: one Teams Workflows link per role channel, events → roles in `teams_rule`; queued by a trigger on `integration_event` into `teams_message` without contact details, sent by `/api/teams/send` every minute; migration 084, `lib/server/teams.ts`, `lib/teams-events.ts`), AI needs `DEEPGRAM_API_KEY` (speech to text) and `ANTHROPIC_API_KEY` (Claude: call summaries, voice notes, daily call brief, weekly owner summary; server only, `lib/server/ai.ts`, every call logged with its cost in `ai_usage`).
Live help during a call: `/live/<leadId>` (laptop mic → Deepgram live via a 30-second pass from `/api/live/token`, so the Deepgram key needs Member permission) → `/api/live/tips` (Claude Haiku, only from the Admin-written Sales playbook `playbook_item`, migration 086) → `/api/live/summary` → the lead panel opens Log call pre-filled. No audio is stored.
Growth features (migrations 088–097):
| Feature | Where |
|---|---|
| Ask the CRM | page `ask`, `/api/ai/ask`: the AI only fills a report-builder request (never SQL); the server re-checks it and runs `run_report()` as the caller (094) |
| Win-back | page `winback`, `winback_list` (definer view, no contact details; exception to `old_data_days`), `winback_reopen` → event `lead.won_back` (097) |
| Brochures | page `brochures`, panel card; public link `/b/<token>` (no sign-in), opens recorded by `/api/brochures/track` → `brochure_track` → owner notification + event `brochure.opened` (088–089) |
| Lead signals | `lead_signal` view (hot score 0–100 + best time to call, rule-based), `ScoreBadge` in the Leads table and panel (090) |
| Calling queue | page `queue` "Start my calls", `my_call_queue(day)` (091) |
| Staff scorecard | page `scorecard`, `staff_scorecard` / `staff_scorecard_team` (092) |
| Expected collections | `expected_collections(days)`, card on Payments and the Finance dashboard (093) |
| Lead capture inbox | page `inbox` "New conversations": new WhatsApp numbers and missed calls (`capture_inbound`); `POST /api/integrations/missed-call` with `x-api-key`; event `conversation.new` (096) |
| Bell | `kit/NotificationCenter`: read (`read_at`) and Done (`done_at`) are separate, changed only through `notification_mark` (095) |
`docs/BACKLOG.md` lists the remaining work in order, with acceptance checks. The visual reference is the "Stint CRM Role Dashboards" design (screenshots in the mockup zip, if present under `docs/design/`).
