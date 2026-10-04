# Stint CRM block for Activepieces

Lets anyone build automations by picking from lists: **When** Stint CRM → New lead / Payment recorded / …, **Do** WhatsApp, email,
or Stint CRM → Create follow-up / Add note / Move stage / Create lead.

| Part | What |
|---|---|
| Triggers (12) | New lead, Lead assigned, Counselling booked, Fee quote sent, Lead converted, Payment recorded, Student absent, Mock booked, Mock result, Resume rejected, Vendor request created, Placement recorded |
| Actions (6) | Create lead, Find person by mobile, Add note to timeline, Create follow-up, Move stage, Get fee reminders for today |
| Connection | CRM address + Incoming API key (CRM → Admin settings → Automation log). On this Mac: `http://host.docker.internal:3100` |

How it works: turning a flow on makes its trigger subscribe to that one CRM event (`/api/integrations/hooks`); turning it off removes it.
Each incoming event is confirmed with the CRM by its id before the flow runs, so a forged webhook call cannot start a flow.

## Build and install

```bash
cd tools/activepieces/stint-piece && npm install && npm run build
```
Bump `version` in `package.json` first for every new upload (Activepieces caches by version). Then Activepieces → Platform Admin →
Pieces → **Install Piece** → Packed Archive (.tgz) → name `@stint/piece-stint-crm`, the version, and `dist/stint-piece-stint-crm-<version>.tgz`.
