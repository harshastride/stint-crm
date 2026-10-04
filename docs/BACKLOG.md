# Backlog — in build order

Each item: do it, add tests, run `npm run typecheck`, `node scripts/test-security.mjs`, `npm run build`, then commit.

## Slice 2 — make daily work complete
| # | Task | Done when |
|---|---|---|
| 2.1 ✅ | Git: `git init`, first commit | History exists; `.env.local` is not committed |
| 2.2 ✅ | Head vs Junior scoping | A Junior sees only records they own (lead.owner_id, candidate.poc_id, and child rows of those); a Head sees their whole team; Admin sees all. Enforced in RLS, with tests |
| 2.3 ✅ | File uploads (Supabase Storage) | Resume versions and candidate documents can attach a file; private bucket; storage policies follow the page grid; download via signed URL |
| 2.4 ✅ | Automatic alerts | Scheduled job (pg_cron or a Next route called by cron) raises alerts: fee overdue, follow-up missed, stuck past `follow_rule.stuck_after_days`, mock failed twice, resume rejected twice. No duplicates for the same record and reason |
| 2.5 ✅ | Follow-up rules in use | Logging an outcome suggests the next follow-up from `follow_rule`; assignment uses `assignment_rule` instead of the fixed "least busy telecaller" |
| 2.6 ✅ | Quote approval | Sales head (level Head, role Sales) or Admin can approve a quote with `needs_approval`; unapproved quotes cannot move to Accepted |
| 2.7 ✅ | Fee plan → instalments | Creating a fee plan generates the due payments by plan; recording a payment marks the matching instalment Received with a receipt number |
| 2.8 ✅ | Password: change own password, admin reset | Invited staff must change the temporary password on first login |
| 2.9 ✅ | Lists: search box, column sort, paging beyond 500 rows | Works on every list page |
| 2.10 ✅ | Playwright end-to-end tests in the repo | The flows in README "What is built" run with one command |

## Slice 3 — Activepieces (see project plan "activepieces-integration-plan")
| # | Task | Done when |
|---|---|---|
| 3.1 ✅ | Outgoing events | Supabase database webhooks (or pg_net trigger) POST signed events to Activepieces for: lead created/assigned, counselling booked, quote sent, lead converted, payment recorded, attendance absent, mock booked/result, resume rejected, vendor request created, placement recorded |
| 3.2 ✅ | Incoming endpoint | `POST /api/integrations/lead` with an API key creates a lead (dedupe by mobile, source tagging, assignment) for Meta/Google/portal flows |
| 3.3 ✅ | Delivery log | Table + Automations page tab showing sent/failed per flow, with retry |
| 3.4 ✅ | Starter flows | JSON for: Meta lead in, lead assigned, fee due reminder, payment receipt |
| 3.5 ✅ | Consent | Marketing messages only to leads who agreed (field on lead, captured on the enquiry form) |

## Slice 4 — recordings (see project plan "conversation-capture-plan")
| # | Task | Done when |
|---|---|---|
| 4.1 ✅ | Record button in the quick panel | Consent tick required; audio captured in the browser and stored privately |
| 4.2 ✅* | Soniox transcript, Gemini summary | Server routes; keys only on the server; summary is a draft the staff member confirms |
| 4.3 ✅ | Recordings page actions | Attach to a person, create a lead from it, delete; audio removed after `audio_retention_days` |
| 4.4 ◐ | Android companion app | Separate project; uploads call recordings with number and time |

4.2 ✅*: built and wired; not yet run against the live Soniox and Gemini APIs (needs `SONIOX_API_KEY`, `GEMINI_API_KEY` in `.env.local`).
4.4 ◐: CRM upload endpoint and app spec (`docs/android-companion.md`) done; the Android app itself is a separate project.

## Slice 5 — go live
| # | Task | Done when |
|---|---|---|
| 5.1 | Production Supabase | Official Docker Compose stack on a server, new JWT secret and keys, backups, SMTP for auth emails |
| 5.2 | App deploy | Docker image or Node process behind HTTPS; env from a secret store |
| 5.3 | Real data | Real staff invited; demo seed never run in production; import of existing leads and candidates |
| 5.4 | Phone layout | Sidebar collapses; quick panel becomes a sheet |

## Open decisions (ask Harsha, do not guess)
- Discount approval limit (now 10%) and discount steps.
- Exact dropdown wording for lead stages and call outcomes.
- Sensitive-field grid per role.
- WhatsApp and email providers.
- Staff phones: Android or iPhone, company or personal.
