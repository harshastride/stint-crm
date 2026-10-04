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
| Wipe and rebuild database | `supabase db reset` then `npm run seed` |
| Type check | `npm run typecheck` |
| Security and rules tests | `node scripts/test-security.mjs` (needs seeded data; must stay 100% passing) |
| Build | `npm run build` |
| Browser tests | `npm run test:e2e` (Playwright; app on 3100, demo data) |
| All tests | `npm test` |
| Go live | `deploy/README.md` |

Demo logins: `<name>@demo.stint.local` / `stint-demo-1234` (harsha Admin, anita Front desk, divya Marketing, teja Telecaller, manish Sales, praveen HR / Counsellor, kiran Trainer, hemanth SME, lakshmi Placement, suresh Finance).

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

## Where to look next
Integrations: `docs/activepieces/` (events, incoming leads), recordings need `SONIOX_API_KEY` and `GEMINI_API_KEY` (server only).
`docs/BACKLOG.md` lists the remaining work in order, with acceptance checks. The visual reference is the "Stint CRM Role Dashboards" design (screenshots in the mockup zip, if present under `docs/design/`).
