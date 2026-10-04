# Activepieces starter flows

The CRM side is built: it sends signed events and accepts incoming leads. These four flows are what to build in Activepieces.
The `*.flow.json` files describe each flow step by step (trigger, filters, actions, field mapping). They are blueprints to
follow in the flow builder, not files exported from a live Activepieces, so build them by hand and check each step with a test event.

## Connect the two sides (once)

| Step | Where | What |
|---|---|---|
| 1 | Activepieces | New flow → trigger **Webhook** → copy its URL |
| 2 | CRM → Admin settings → Automation log | Paste the URL under *Activepieces webhook URL* → Save |
| 3 | CRM | Press **Send a test event**; within a minute the flow's webhook shows a `test.ping` |
| 4 | Activepieces | Add a **Code** step that checks the signature (below); stop the flow if it fails |
| 5 | Activepieces | Use a **Router** on `{{trigger.body.event}}` to send each event to its branch |

One webhook flow receives every event; branch on `body.event`. Event names:
`lead.created`, `lead.assigned`, `counselling.booked`, `quote.sent`, `lead.converted`, `payment.recorded`, `attendance.absent`,
`mock.booked`, `mock.result`, `resume.rejected`, `vendor_request.created`, `placement.recorded`, `test.ping`.

Every body looks like `{ "id": "<event id>", "event": "...", "occurred_at": "...", "data": { "lead": {...} | "candidate": {...}, ... } }`.
Lead and candidate blocks carry `name`, `mobile`, `email`, `program`, `owner`, `owner_email`; leads also carry `marketing_consent`.

### Signature check (Code step, Node)

```js
import crypto from 'crypto';
export const code = async (inputs) => {
  // inputs.body = raw JSON text of the request; inputs.signature = header x-stint-signature; inputs.secret = signing secret from the CRM
  const want = 'sha256=' + crypto.createHmac('sha256', inputs.secret).update(inputs.body).digest('hex');
  if (want !== inputs.signature) throw new Error('Bad signature');
  return JSON.parse(inputs.body);
};
```
Turn on "raw body" on the webhook trigger so the text is byte-for-byte what the CRM signed. Keep the secret in an Activepieces connection or variable, not in the code.
The event `id` repeats if the CRM retries, so flows that send messages should skip an id they have already handled (store ids in an Activepieces table).

## Leads coming in

Meta, Google and portal flows end with an **HTTP** step:

```
POST https://<your CRM address>/api/integrations/lead
x-api-key: <Incoming API key from the Automation log>
Content-Type: application/json

{ "full_name": "...", "mobile": "...", "email": "...", "city": "...", "course": "Python",
  "source": "Meta lead form", "campaign": "...", "notes": "...", "marketing_consent": true }
```
Answers: `201 { lead_id, assigned_to }` for a new lead, `200 { duplicate: true, lead_id }` when the mobile is already in the CRM (a note is added instead), `401` for a wrong key, `400` with a reason for bad data.
`source` must match a name under Marketing → Lead sources (for example `Meta lead form`, `Google lead form`, `Website form`).

## Consent

Only send marketing messages (offers, new batches, reminders to enquire) when `data.lead.marketing_consent` is `true`.
Service messages the person asked for (receipt, counselling booking, fee due) can go without it.
The front desk records consent with the tick on the enquiry form; incoming leads pass `marketing_consent`.

## The four flows

| File | Trigger | Does |
|---|---|---|
| `meta-lead-in.flow.json` | Meta Lead Ads: new lead | Posts the lead to the CRM |
| `lead-assigned.flow.json` | CRM `lead.assigned` | WhatsApp to the lead; email to the owner |
| `fee-due-reminder.flow.json` | Schedule, daily 09:00 | Calls `GET /api/integrations/fees-due` (same API key), which lists who to remind today, and sends the reminders |
| `payment-receipt.flow.json` | CRM `payment.recorded` | WhatsApp + email receipt with the receipt number |

WhatsApp and email providers are still an open decision; the flows name the step, pick the piece once decided.
