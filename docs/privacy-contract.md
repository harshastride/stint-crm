# Time-limited data access — build contract (shared by all builders)

Plan: /Users/kanalaharshareddy/.claude/plans/steady-napping-pillow.md

## Settings (table `setting`, Admin edits in Branding/settings)
`old_data_days`=30, `alumni_lock_days`=10, `idle_signout_minutes`=30, `reveal_seconds`=60. SQL helper `public.setting_int(key text, fallback int) returns int`.

## Database (migration 047 — agent A1)
- `lead.mobile_masked`, `lead.email_masked`: generated stored columns (e.g. `•••••1234`, `r•••@gmail.com`).
- Column SELECT on `lead.mobile`, `lead.email` REVOKED from `authenticated` (insert/update still allowed). ⇒ client code must never `select('*')` from `lead` or use `.select()` with no columns after insert/update on `lead`; select explicit columns or read from the view.
- View `public.lead_list` (security_invoker): every lead column except mobile/email, plus mobile_masked, email_masked. RLS of lead applies.
- `public.search_people(p_kind text, p_term text, p_limit int default 8) returns jsonb` → `[{id, full_name, mobile_masked, stage, code}]` (code only for candidates). Matches full mobile digits (≥3) or name. Security definer, respects the same row visibility as the caller (lead_row_visible / candidate scope+stage).
- `public.contact_status(p_kind text, p_id uuid) returns jsonb` → `{allowed: bool, reason: text|null, seconds: int}` reason in plain words e.g. "Only while the lead is in New, Callback or Interested", "Details locked: Alumni for more than 10 days", "No activity for 30 days".
- `public.reveal_contact(p_kind text, p_id uuid, p_field text) returns text` — p_kind 'lead'|'candidate'; p_field 'mobile'|'email' (candidate: keys of candidate_private.contact, e.g. mobile, email, address). Returns full value if allowed, logs to `data_access_log`; else raises errcode 42501 with the plain reason.
- `candidate_private_get(cid)` keeps its shape; for non-Admin the `contact` group values are always masked (reveal one at a time), and all groups become hidden (`h`) when Alumni-locked or outside the role's contact stages; adds `"locked": "<reason>"|null` to the result.
- Table `data_access_log(id, staff_id default auth.uid(), kind, entity_id, field, at default now())`; select only Admin; insert only via reveal_contact. Page `accesslog` ('Admin settings', 'Data access log').
- `app_role.contact_lead_stages text[]`, `app_role.contact_candidate_stages text[]` (null = any stage). Defaults: Telecaller lead {New,Callback,Interested}; Sales lead {Interested,Counselling}; Front desk candidate {Enrolled}; Placement candidate {Ready,Placed}; HR / Counsellor candidate {Enrolled,Training,Mocks,Resume,Docs,Ready}; Finance candidate null.
- Alumni lock: candidate.stage='Alumni' and stage_changed_at < now() - alumni_lock_days → non-Admin cannot reveal; private groups hidden; `alumni_summary` hides contact columns for non-Admin.

## Database (migration 048 — agent A2): 30-day rule, non-Admin only (Admin sees all)
Restrictive RLS: closed leads (Not interested/Converted) hidden when stage_changed_at older than old_data_days; call_log, note, recording, training_note older than old_data_days hidden; follow_up status Done older (by created_at) hidden; alert Resolved older hidden; status_history older hidden; fee_quote Expired/Lost older hidden. `person_timeline` respects it. Inactive lead (no stage change, call or note for old_data_days) ⇒ contact_status not allowed (A1 provides helper `lead_last_activity(uuid)` — A2 may define it if missing; coordinate by `create or replace`).
NOT hidden: active students, fee plans/payments, documents, placements, job papers.

## UI
- `components/kit/Reveal.tsx` (agent B): `<Reveal kind id field masked label? onRevealed?(value) />` shows masked + "Show" → calls reveal_contact, shows full value with countdown `reveal_seconds`, then re-masks; shows contact_status reason when not allowed. Export helper `revealOnce(kind,id,field): Promise<string|null>` for Call/WhatsApp/Email buttons.
- Idle sign-out (agent D): `components/kit/IdleGuard.tsx`, test hook `window.__stintIdleMs`.
- Export only for Admin (agent C).
