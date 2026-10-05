# WhatsApp and email inside the CRM

Staff send and read WhatsApp and email from the **Chat** tab of the Quick panel. Replies land in the same thread and notify the record owner.

| Piece | Where |
|---|---|
| Messages table | `message` (migration 060). Staff can read messages only for leads/students they can see. |
| Templates | Admin settings → Message templates (`message_template`) |
| Send (staff) | `POST /api/messages/send` — the server looks up the real number/email; the browser never gets it |
| Queue sender (cron) | `POST /api/messages/process` with header `x-cron-secret` (value from `integration_config.cron_secret`) |
| WhatsApp webhook | `GET/POST /api/webhooks/whatsapp` |

If keys are missing, nothing breaks: the message stays **queued** and staff see "not set up". It goes out on the next `process` run after keys are added.

## 1. WhatsApp (Meta WhatsApp Cloud API)

| Step | Do |
|---|---|
| 1 | Go to developers.facebook.com → My Apps → Create app → type **Business** → add **WhatsApp**. |
| 2 | WhatsApp → API Setup: add and verify Stint's business number. Copy the **Phone number ID** → `WHATSAPP_PHONE_ID`. |
| 3 | Business settings → System users → add a system user (Admin) → Generate token with `whatsapp_business_messaging` and `whatsapp_business_management` → `WHATSAPP_TOKEN` (permanent token, not the 24-hour test token). |
| 4 | App settings → Basic → **App secret** → `WHATSAPP_APP_SECRET`. |
| 5 | Make up a long random text → `WHATSAPP_VERIFY_TOKEN`. |
| 6 | WhatsApp → Configuration → Webhook: Callback URL `https://<your-domain>/api/webhooks/whatsapp`, Verify token = the value from step 5. Subscribe to **messages**. |
| 7 | WhatsApp Manager → Message templates: create templates (one body variable `{{1}}`). Add the same **name** in Admin settings → Message templates and mark it Ready to use. |

24-hour rule: free text works only within 24 hours of the person's last WhatsApp to you. Otherwise staff must pick a template (the CRM sends the filled message as the template's `{{1}}`). Language code defaults to `en` (`WHATSAPP_TEMPLATE_LANG` to change).

Inbound messages are matched to a lead (by mobile) or a student (by mobile in private details) using the last 10 digits. Unknown numbers are ignored.

## 2. Email

| Option | Keys |
|---|---|
| Resend (recommended) | `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` (e.g. `Stint Academy <hello@stint.academy>`; verify the domain in Resend) |
| SMTP | `EMAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`. Needs `npm install nodemailer`. |

Email replies are not read back into the CRM yet.

## 3. Queue sender

Call `POST /api/messages/process` every 2–5 minutes (pg_cron `net.http_post` like the recordings cleanup, or an Activepieces schedule) with header `x-cron-secret`. Reminders queued for later (`send_after`) go out this way.

All keys are server-only. Store them in Infisical (dev / prod), never as `NEXT_PUBLIC_`.
