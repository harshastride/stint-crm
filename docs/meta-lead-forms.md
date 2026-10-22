# Meta lead forms: connect once, leads arrive by themselves

Leads from Facebook and Instagram lead forms reach the CRM within seconds, without Activepieces or Zapier.
Each answer goes to its CRM field (course, Experience, Background, Fee plan, Ad set, Ad name; anything else into the
lead's notes). Same rules as every incoming lead: no duplicate for the same mobile, source "Meta lead form", campaign
added to Campaigns, assigned by the assignment rule, posted to Teams if "New lead" is switched on.

## One-time setup (about 15 minutes)
| # | Where | What to do |
|---|---|---|
| 1 | developers.facebook.com → My Apps → **Create app** | Use case **"Capture & manage ad leads"**, app type **Business**, name it **Stint CRM**, connect your Business portfolio |
| 2 | The app → **Facebook Login for Business → Settings** | Under *Valid OAuth Redirect URIs* paste the **Sign-in return address** shown on the CRM page (`https://crm.skillxen.com/api/meta/callback`) → Save |
| 3 | **Facebook Login for Business → Configurations → Create configuration** | Token type *User access token*; tick `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_manage_ads`, `leads_retrieval`, `ads_management`, `ads_read`, `business_management`; pick your page → Save → copy the **Configuration ID** |
| 4 | The app → **Add product → Webhooks** | Just add it. The CRM fills in the address itself |
| 5 | **App settings → Basic** | Copy **App ID** and **App secret** |
| 6 | CRM → Admin settings → **Meta lead forms** → Step 1 | Paste App ID, App secret and Configuration ID → **Save**. It should say *Webhook ready ✓* |
| 7 | Same page → Step 2 | **Connect Facebook** → sign in with the account that is admin of the page → allow everything |
| 8 | Same page → your page | Check **Receiving leads** is on. Open the form → *Where each answer goes* and check the suggestions |
| 9 | developers.facebook.com/tools/lead-ads-testing | Send a test lead for the form. It appears under *Recent leads from Meta* and in Leads |
| 10 | Business Settings → Integrations → **Leads Access** | Only if lead access was customised: add *Stint CRM* under CRMs for the page |

## If something goes wrong
| You see | Meaning | Fix |
|---|---|---|
| *The Facebook connection has expired* | Password changed, app removed, or page role lost | Press **Connect Facebook** again |
| *A permission is missing* | Something was not allowed in step 7, or Leads Access is customised | Connect again and allow everything; check step 10 |
| Your test leads arrive, but real ones from the public do not | Meta wants the app reviewed (Advanced Access for `leads_retrieval`) | Business Verification + App Review in the Meta app; ask for help |
| A lead shows *Failed* with a reason | E.g. the phone number was not a 10-digit Indian mobile | Fix in Meta or add the lead by hand; **Retry** after a Meta hiccup |
| Leads missed while the CRM was down | Meta retries for 36 hours; older ones can be fetched | **Fetch leads from the last 7 days** on the form |

## How it works (for developers)
| Part | Where |
|---|---|
| Tables, permissions, every-minute job | `supabase/migrations/20261004000100_meta_leads.sql` |
| Graph API calls, signatures, mapping | `lib/server/meta.ts`, `lib/server/meta-sync.ts`, `lib/server/meta-process.ts` |
| Shared lead door (also used by Activepieces) | `lib/server/incoming-lead.ts` |
| Routes | `/api/meta/app`, `/connect`, `/callback`, `/pages`, `/webhook` (Meta → CRM, signed), `/process` (timer), `/backfill` |
| Admin page | `components/special/MetaLeads.tsx` (page id `meta`) |
| Tests without Facebook | set `META_GRAPH_URL` and `META_DIALOG_URL` to a stand-in server |

The app secret and page tokens are never readable from the browser and never logged. The lead log keeps Meta ids
only; the person's answers live only on the lead.
