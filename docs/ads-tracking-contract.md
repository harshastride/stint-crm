# Ad tracking and conversions — build contract (shared by all builders)

Goal: know which ad brought a person who **paid**, and tell Meta and Google about leads, enrolments and fees so their
ad systems find more people like paying students. Two apps:

| App | Folder | Port |
|---|---|---|
| Stint CRM | `/Users/kanalaharshareddy/Applications/stint-crm` | 3100 (DB 55322) |
| Landing page (Tech Career Fit) | `/Users/kanalaharshareddy/Documents/Applications_local/tech-career-app` | 3200 (DB 56322) |

The landing page already sends every lead to the CRM server to server (`tech-career-app/lib/server/crm.ts` →
CRM `POST /api/integrations/lead` with `x-api-key`), and reads batches from CRM `GET /api/integrations/batches`.

## Privacy rules (non-negotiable)
1. No ad or analytics tag loads before the visitor chooses. Default = nothing loads. Choices: "Accept all", "Only necessary", "Choose" (Analytics / Ads toggles). Stored in `localStorage['careerfit.consent'] = { v: 1, analytics: bool, ads: bool, at: ISO }`. Footer link "Cookie settings" reopens it. Google Consent Mode v2: default all denied; update to granted per choice.
2. Personal data (email, phone) is never put in a URL, a tag, or a browser event. It only leaves our servers **hashed** (SHA-256 of the normalised value), and only for leads with `ad_consent = true` (or Meta lead form leads, for Meta only).
3. IP and browser name are stored only in CRM `lead_click`, server-only columns, cleared after 90 days.
4. Secrets (Meta Conversions API token, Google feed password) are never readable from the browser (column grants), never logged, never in the recycle bin.
5. Every setting empty = feature off, site and CRM work exactly as today.

## CRM database (migration `20261004000101_ad_conversions.sql`, already applied — read it, do not edit it)
- `lead_click` (one per lead): utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, gbraid, wbraid, fbclid, fbc, fbp, landing_url, referrer, client_ip (inet), user_agent, ad_consent, consent_at, web_event_id, clicked_at. Staff can select only: lead_id, utm_*, landing_url, referrer, ad_consent, consent_at, clicked_at, created_at (row visible when the lead is visible). Insert/update only with the service role.
- `ad_conversion_rule` (platform 'meta'|'google', trigger 'arrived'|'stage'|'paid', stage, event_name, send_value, active, sort). CRUD by `can_page('ads','w')`. Defaults: meta arrived→Lead, Counselling→Schedule, Converted→CompleteRegistration, paid→Purchase(value); google arrived→"Website lead", Converted→"Enrolment", paid→"Fee received"(value).
- `ad_conversion` (queue + log): lead_id, rule_id, platform, event_name, event_id (dedup key), event_time, value, currency 'INR', status 'Queued'|'Sending'|'Sent'|'Failed'|'Skipped', attempts, next_try_at, last_error, sent_at. Filled **only by triggers** (`ad_enqueue`): on `lead_click` insert / ad_consent change ('arrived' + current stage), on lead stage change, on first fee_payment 'Received' ('paid', value = amount). Staff with ads 'w' may set status back to 'Queued'/'Skipped' (Retry / Skip).
- `ad_settings` (id=1): meta_enabled, meta_dataset_id, meta_capi_token (secret), meta_test_event_code, meta_token_set (generated), google_enabled, google_feed_user, google_feed_password (secret), google_password_set (generated), google_feed_days, last_feed_at. Staff (ads 'w') may update the non-secret columns directly; secrets only via `POST /api/ads/settings`.
- View `campaign_performance` (security_invoker): id, name, channel, status, budget, starts_on, leads, enrolments, fees_received, budget_per_lead, budget_per_enrolment (null when no leads/enrolments or no budget).
- Page id `ads` ('Marketing' group, "Ad conversions"). Admin all; Marketing read.
- pg_cron `ad-conversions` calls `POST {app_url}/api/ads/send` with `x-cron-secret` every minute when Meta rows are due and meta_enabled. `ad-purge-clicks` daily.

## CRM incoming lead: new optional field `attribution`
`POST /api/integrations/lead` body may include:
```json
"attribution": {
  "utm_source": "", "utm_medium": "", "utm_campaign": "", "utm_content": "", "utm_term": "",
  "gclid": "", "gbraid": "", "wbraid": "", "fbclid": "", "fbc": "", "fbp": "",
  "landing_url": "", "referrer": "", "client_ip": "", "user_agent": "",
  "ad_consent": true, "consent_at": "ISO", "event_id": "browser Lead event id", "clicked_at": "ISO"
}
```
Rules: every string trimmed and cut to the column limit; invalid IP → null; `campaign` defaults to `attribution.utm_campaign` when the body has no `campaign`. New lead → insert `lead_click`. Duplicate (mobile already a lead) → insert `lead_click` only if that lead has none; never overwrite. `web_event_id` = `attribution.event_id`.

## CRM server (agent "crm-sender")
- `lib/server/ads.ts`: normalise + SHA-256 hash email (trim, lowercase) and phone (digits, with country code 91 for 10-digit Indian numbers); build Meta CAPI payload; send due Meta rows; build Google CSV.
- `POST /api/ads/send` (cron secret, like `/api/meta/process`): claim due Meta rows (status Queued, next_try_at <= now, limit 100; mark Sending), POST `{GRAPH}/{graph_version}/{meta_dataset_id}/events?access_token=…` (reuse `GRAPH` from `lib/server/meta.ts` so tests can use `META_GRAPH_URL`; version from `meta_app.graph_version`, default v25.0), with `test_event_code` when set. Event: `event_name`, `event_time` (unix s), `event_id` (= `lead_click.web_event_id` for the 'arrived' Lead so the browser pixel and server count once; otherwise the row's event_id), `action_source` = 'website' for website leads, 'system_generated' for Meta lead-form leads, `event_source_url` = landing_url when present, `user_data` { em: [hash], ph: [hash], fbc, fbp, client_ip_address, client_user_agent, external_id: [hash(lead id)], lead_id: <leadgen_id> for Meta lead-form leads }, `custom_data` { value, currency } when value, plus for system_generated: `lead_event_source: 'Stint CRM'`, `event_source: 'crm'`. Success → Sent, sent_at. Error → attempts+1, backoff (1, 5, 30, 120 min), after 5 → Failed with last_error (no personal data in errors). meta_enabled false or no token/dataset → leave rows Queued (do nothing).
- `GET /api/ads/google-feed` (HTTP Basic auth = google_feed_user / google_feed_password, constant-time compare; 401 with `WWW-Authenticate: Basic`; 404-style refusal when google_enabled false). CSV for Google Ads scheduled uploads (Conversions → Uploads → Schedule → HTTPS): first line `Parameters:TimeZone=Asia/Calcutta`, header `Google Click ID,GBRAID,WBRAID,Email,Phone Number,Conversion Name,Conversion Time,Conversion Value,Conversion Currency,Order ID`. One row per google ad_conversion row in the last `google_feed_days` days whose lead has a gclid/gbraid/wbraid or an email/phone (hashed). Time `yyyy-MM-dd HH:mm:ss`. Order ID = event_id. Mark those rows Sent (sent_at) the first time they are served; Google ignores repeats. Update `last_feed_at`.
- `POST /api/ads/settings` (signed-in, `can_page('ads','w')`, Origin check): body may hold meta_capi_token, google_feed_password (string to set, '' to clear). Service role writes. Returns `{ ok: true }`.
- `POST /api/ads/test` (signed-in, ads 'w'): `{ platform: 'meta' }` sends one test event (`event_name: 'TestEvent'`, uses meta_test_event_code if set) and returns `{ ok, message }` in plain words; `{ platform: 'google' }` returns how many rows the feed would show now.
- `lib/server/incoming-lead.ts`: accept `attribution` as above.
- Tests in `scripts/test-security.mjs` (this agent owns that file).

## CRM screens (agent "crm-admin")
- `components/special/AdConversions.tsx`, registered as `ads` in `app/(app)/p/[page]/page.tsx` SPECIAL and in `components/Shell.tsx` nav (Marketing group, next to Campaigns). Sections: status summary (Meta on/off, Google on/off, last sent, waiting, failed), Meta settings (dataset id, token write-only with "Set"/"Replace", test event code, enable switch, "Send test event"), Google settings (feed URL `{app_url}/api/ads/google-feed`, user, password write-only, days, enable, last read by Google, setup steps), Rules table (platform, when, stage dropdown from `lead_stage`, event name, send value, active; add/edit/remove), Log (recent ad_conversion with lead name via `lead_list`, status pill, error, Retry/Skip). View-only for Marketing.
- Campaigns page: show performance (leads, enrolments, fees received, budget per lead, budget per enrolment) from `campaign_performance`, labelled "budget" (not "spend").
- Lead panel: one line "Came from: <utm_source> · <utm_campaign>" from `lead_click` when present.

## Landing page server (agent "landing-server")
- Migration `20261023000012_attribution.sql`: `lead.attribution jsonb not null default '{}'` (utm_*, gclid, gbraid, wbraid, fbclid, fbc, fbp, landing_url, referrer, clicked_at, ad_consent, analytics_consent, consent_at, event_id — never IP or browser). Staff see `utm_source`, `utm_medium`, `utm_campaign` via `lead_list` (add columns).
- `app/api/public/submit` and `app/api/public/enquiry` accept `ctx` (below), validate and cut every value, read `_fbp` / `_fbc` cookies (build `fb.1.<ms>.<fbclid>` when there is fbclid but no _fbc), save `attribution`, and pass to `sendLeadToCrm(id, site, { client_ip, user_agent })` → CRM `attribution`. `campaign` = utm_campaign when present, else today's defaults. IP/browser are only forwarded, never stored here. Resend from staff panel sends without IP/browser.
- Quiz leads (staff): "Came from" column/row.
- `scripts/test-security.mjs` checks; `.env.example`, `deploy/app.env.example`, `deploy/docker-compose.app.yml`: runtime env `GA4_ID`, `GOOGLE_ADS_ID` (AW-…), `GOOGLE_ADS_LEAD_LABEL`, `META_PIXEL_ID` (read at run time on the server, no rebuild needed).

### `ctx` sent by the browser with submit and enquiry
```json
"ctx": {
  "attr": { "utm_source": "", "utm_medium": "", "utm_campaign": "", "utm_content": "", "utm_term": "",
            "gclid": "", "gbraid": "", "wbraid": "", "fbclid": "", "landing_url": "", "referrer": "", "clicked_at": "ISO" },
  "consent": { "ads": false, "analytics": false, "at": "ISO" },
  "event_id": "uuid without dashes, same id the browser used for its Lead event"
}
```

## Landing page browser (agent "landing-client")
- `lib/attribution.ts`: on every page load read utm_*/gclid/gbraid/wbraid/fbclid from the URL; keep **last non-empty ad touch** for 90 days in `localStorage['careerfit.attr']` (first landing_url/referrer of that touch, clicked_at). Functional storage only (sent with the form the visitor submits); not shared with ad platforms unless they accept ads.
- `lib/consent.ts` + `components/consent/ConsentBanner.tsx` (bottom sheet, 44px buttons, plain words, link to `/privacy`), footer "Cookie settings".
- `components/consent/Tags.tsx`: loads `gtag.js` (GA4 + Google Ads) and the Meta Pixel **only after** the matching consent, with the CSP nonce; IDs come from the server layout props (`GA4_ID`, `GOOGLE_ADS_ID`, `GOOGLE_ADS_LEAD_LABEL`, `META_PIXEL_ID`); none set = nothing loads.
- `lib/track.ts`: `track(event, params?, { eventId? })` → gtag + fbq when allowed, no-op otherwise. Events: `quiz_start` (Meta custom QuizStart), `quiz_complete` (custom QuizComplete), `generate_lead` / Meta `Lead` + Google Ads conversion (send_to `GOOGLE_ADS_ID/GOOGLE_ADS_LEAD_LABEL`) on submit and enquiry success with the same `event_id` as in `ctx`, `book_call` / Meta `Schedule` when a call slot is booked. Never pass name, email or phone to track().
- `middleware.ts` CSP: allow only what these tags need (googletagmanager.com, google-analytics.com, *.analytics.google.com, googleadservices.com, googleads.g.doubleclick.net, www.google.com, td.doubleclick.net frames, connect.facebook.net, www.facebook.com).
- `/privacy` page: plain description of what is collected and why, cookies used, how to change the choice, contact `CONTACT.email`.
