# Stint CRM

Training and placement CRM for Stint Academy. Next.js front end, self-hosted Supabase (Postgres, login, API) behind it.

## Start it on your Mac

You need Docker Desktop (open and running), the Supabase CLI (`brew install supabase/tap/supabase`) and Node.js 20+.

```bash
cd ~/Applications/stint-crm
./scripts/setup-local.sh     # one time: starts Supabase, creates tables, adds demo data
npm run dev                  # every time: starts the app
```

Open http://localhost:3100.

| Login (password `stint-demo-1234`) | Role |
|---|---|
| harsha@demo.stint.local | Admin |
| anita@demo.stint.local | Front desk |
| divya@demo.stint.local | Marketing |
| teja@demo.stint.local / pooja@… | Telecaller |
| manish@demo.stint.local | Sales |
| praveen@demo.stint.local | HR / Counsellor |
| kiran@demo.stint.local / nikhil@… | Trainer |
| hemanth@demo.stint.local | SME |
| lakshmi@demo.stint.local | Placement |
| suresh@demo.stint.local | Finance |

Supabase’s own admin screen (tables, logins) is at http://localhost:55323.

Day to day: `supabase stop` / `supabase start` to stop and start the database; `supabase db reset` wipes it and re-applies everything in `supabase/`, after which run `npm run seed` again.

## What is built (slice 1)

- Login, 10 roles, sidebar per role, light and dark theme
- Permissions enforced in the database (row-level security), driven by the Roles & permissions grid
- All 46 pages: 36 run on four shared blocks (table/board list, editor panel, create form, quick panel); dashboard, enquiry form, enrolment form, attendance, roles grid, dropdown values, import and Candidate 360 are their own screens
- Rules in the database: auto-assign a new lead, duplicate mobile refused, lead → candidate on Converted (with fee plan and follow-ups), quote amount and discount approval flag, status history, masked and hidden candidate details
- Job papers checklist that follows the job’s dates; CSV lead import with duplicate check; CSV export on reports and history

## What is built (slice 2)

- Head vs Junior: a Junior in a lead- or candidate-owning role sees only their own records; a Head sees the team (row security)
- Sales picks up Interested leads; booking counselling hands the lead to the counsellor
- File uploads on resumes and documents (private bucket, one-minute download links)
- Alerts raised every 15 minutes by the database (fee overdue, follow-up missed, stuck, mock failed twice, resume rejected twice), never duplicated, closed when fixed
- Follow-up rules suggest the next step after a call; failed mocks, absences and rejected resumes raise follow-ups; assignment rules pick owners
- Quote approval by the Sales head or Admin; custom instalments; fee plans create due payments; payments settle them with receipt numbers
- Change own password, admin reset, temporary passwords must be changed first
- Every list: search, column sort, paging over all rows
- `npm test`: database rules and security checks, then browser flows (Playwright)

## Not built yet

See `docs/BACKLOG.md` (Activepieces, recordings, go-live).

## How it is put together

| Folder | What |
|---|---|
| `supabase/migrations` | Tables, security, rules, report views |
| `supabase/seed.sql` | Roles, pages, permission grid, dropdown values, programs (no people) |
| `scripts/seed-demo.mjs` | Demo logins and sample people |
| `scripts/test-security.mjs` | Checks that the database enforces roles and rules |
| `e2e/` | Browser tests of the main flows (`npm run test:e2e`) |
| `lib/pages.ts` | One config entry per list page (columns, views, fields, board) |
| `components/` | The four blocks and the special screens |

To add or change a list page, edit its entry in `lib/pages.ts`. To change who sees what, use Roles & permissions in the app.

## Going live later

Run the full self-hosted Supabase stack on a server (Supabase’s Docker Compose), apply `supabase/migrations` and `supabase/seed.sql`, set the three values from `.env.example`, then `npm run build && npm run start`. Do not run `seed-demo.mjs` on the live server; invite real staff from Users & staff. Use new keys and a new JWT secret on the server, never the local ones.
