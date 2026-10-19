import 'server-only';
import { service } from '@/lib/server/recordings';
import { TEAMS_EVENT_LABEL, teamsUrlProblem } from '@/lib/teams-events';

// Microsoft Teams: turn a queued CRM event into an Adaptive Card and post it to a channel's Workflows link.
// Only whitelisted, non-contact fields are read from the payload (never mobile, email, owner_email, bank or ID details),
// even though teams_safe() already strips contact details in the database. The link is a secret: it never appears
// in an error message or a log line.

type Json = Record<string, unknown>;
type Fact = { title: string; value: string };
type Block = Json;

const MAX = 200;
const TZ = 'Asia/Kolkata';

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const obj = (v: unknown): Json => (isObj(v) ? v : {});

/** Plain, short, one-line text. Square brackets are swapped for round ones so a name typed into a public form
 *  (for example "[Pay here](https://…)") cannot become a clickable link in Teams. */
function clean(v: unknown, max = MAX): string {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/\s+/g, ' ').replace(/\[/g, '(').replace(/\]/g, ')').trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

function money(v: unknown): string {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return '';
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/** "18 Oct" (India time). Date-only values ("2026-10-18") are shown as that calendar day. */
function day(v: unknown): string {
  if (!v) return '';
  const s = String(v);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00+05:30') : new Date(s);
  if (Number.isNaN(d.getTime())) return clean(s);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: TZ });
}

/** "18 Oct, 3:30 pm" (India time), for booked sessions. */
function when(v: unknown): string {
  if (!v) return '';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return clean(v);
  const t = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ }).toLowerCase();
  return `${day(v)}, ${t}`;
}

const facts = (pairs: [string, unknown][]): Fact[] =>
  pairs.map(([title, value]) => ({ title, value: clean(value) })).filter((f) => f.value !== '');

function card(o: { title: string; subtitle?: string; facts?: Fact[]; sections?: { heading: string; items: string[] }[]; link: string; linkTitle?: string }) {
  const body: Block[] = [{ type: 'TextBlock', text: clean(o.title), weight: 'Bolder', size: 'Medium', wrap: true }];
  if (o.subtitle) body.push({ type: 'TextBlock', text: clean(o.subtitle), isSubtle: true, wrap: true, spacing: 'Small' });
  if (o.facts?.length) body.push({ type: 'FactSet', facts: o.facts });
  for (const s of o.sections || []) {
    const items = s.items.map((i) => clean(i)).filter(Boolean);
    if (!items.length) continue;
    body.push({ type: 'TextBlock', text: s.heading, weight: 'Bolder', wrap: true, spacing: 'Medium' });
    for (const i of items) body.push({ type: 'TextBlock', text: '• ' + i, wrap: true, spacing: 'Small' });
  }
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      contentUrl: null,
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body,
        // Teams rejects a card whose button has a relative link, so the button is left out until the site address is set.
        actions: /^https?:\/\/[^/]/i.test(o.link) ? [{ type: 'Action.OpenUrl', title: o.linkTitle || 'Open in CRM', url: o.link }] : [],
      },
    }],
  };
}

const safeId = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

/** The Teams message body for one CRM event. `payload` is the queued payload ({ event, occurred_at, data }) or its data. */
export function buildCard(event: string, payload: any, siteUrl: string, personName?: string | null) {
  const site = String(siteUrl || '').replace(/\/+$/, '');
  const d = isObj(payload) && isObj(payload.data) ? payload.data : obj(payload);
  const cand = obj(d.candidate), lead = obj(d.lead);
  const candLink = safeId(cand.id) ? `${site}/candidate/${cand.id}` : `${site}/`;
  const leadLink = safeId(lead.id) ? `${site}/p/lead?person=lead:${lead.id}` : `${site}/`;
  const cName = clean(cand.name || personName, 80) || 'a student';
  const lName = clean(lead.name || personName, 80) || 'a lead';

  switch (event) {
    case 'candidate.created':
      return card({
        title: `New student joined: ${cName}`,
        facts: facts([['Code', cand.code], ['Program', cand.program], ['Batch', d.batch], ['Counsellor', cand.owner], ['Joined on', day(d.joined_on)],
          ['Came from', d.from_lead === true ? 'A lead' : d.from_lead === false ? 'Walk-in at the desk' : '']]),
        link: candLink,
      });
    case 'payment.recorded':
      return card({
        title: `Fee received: ${money(d.amount) || 'payment'} from ${cName}`,
        facts: facts([['Program', cand.program], ['Mode', d.mode], ['Receipt no', d.receipt_no], ['For', d.for], ['Paid on', day(d.paid_on)]]),
        link: candLink,
      });
    case 'placement.recorded':
      return card({
        title: d.company ? `${cName} is placed at ${clean(d.company, 80)}` : `${cName} is placed`,
        facts: facts([['Role', d.role], ['CTC (LPA)', d.ctc_lpa], ['Joining on', day(d.joining_on)]]),
        link: candLink,
      });
    case 'attendance.absent':
      return card({ title: `${cName} was absent`, facts: facts([['Batch', d.batch], ['Day', day(d.day)]]), link: candLink });
    case 'mock.result':
    case 'mock.booked':
      return card({ title: `Mock ${clean(d.status, 30).toLowerCase() || (event === 'mock.booked' ? 'booked' : 'result')}: ${cName}`, facts: facts([['Level', d.level]]), link: candLink });
    case 'resume.rejected':
      return card({ title: `Resume rejected: ${cName}`, facts: facts([['Version', d.version], ['Reason', d.reason]]), link: candLink });
    case 'vendor_request.created':
      return card({ title: `Vendor request for ${cName}`, facts: facts([['Program', cand.program]]), link: candLink });
    case 'counselling.booked':
      return card({ title: `Counselling booked: ${lName}`, facts: facts([['Program', lead.program], ['Counsellor', d.counsellor], ['When', when(d.scheduled_at)]]), link: leadLink });
    case 'quote.sent':
      return card({
        title: `Fee quote sent to ${lName}`,
        facts: facts([['Program', d.program || lead.program], ['Amount', money(d.amount)],
          ['Discount %', d.discount_pct === null || d.discount_pct === undefined || d.discount_pct === '' ? '' : `${Number(d.discount_pct)}%`], ['Valid until', day(d.valid_until)]]),
        link: leadLink,
      });
    case 'lead.created':
    case 'lead.assigned':
    case 'lead.converted': {
      const title = event === 'lead.created' ? `New lead: ${lName}`
        : event === 'lead.assigned' ? (lead.owner ? `Lead assigned: ${lName} → ${clean(lead.owner, 60)}` : `Lead assigned: ${lName}`)
        : `Lead converted: ${lName}`;
      return card({ title, facts: facts([['Program', lead.program], ['Source', lead.source], ['Stage', lead.stage], ['Owner', lead.owner]]), link: leadLink });
    }
    case 'brochure.opened': {
      const n = Number(d.open_count);
      return card({
        title: `${lName} is reading the brochure now — call now`,
        facts: facts([['Brochure', d.brochure], ['Opened', Number.isFinite(n) && n > 1 ? `${n} times` : 'First time'], ['Program', lead.program], ['Owner', lead.owner]]),
        link: leadLink,
      });
    }
    case 'lead.won_back': {
      const n = Number(d.days_since);
      return card({
        title: `Lead won back: ${lName}`,
        facts: facts([['Why', d.reason], ['Quiet for', Number.isFinite(n) && n > 0 ? `${n} days` : ''], ['Program', lead.program], ['Owner', lead.owner], ['Put back by', d.by]]),
        link: leadLink,
      });
    }
    case 'conversation.new':
      // The sender's WhatsApp name can be a phone number, so it is never shown here.
      return card({ title: 'New WhatsApp conversation', subtitle: 'Someone new wrote in. Open New conversations to reply or make them a lead.', facts: facts([['Received', when(d.received_at)]]), link: `${site}/p/inbox` });
    case 'alert.high': {
      const a = obj(d.alert);
      return card({
        title: `High-priority alert: ${clean(a.title, 150) || 'needs attention'}`,
        facts: facts([['About', personName], ['Area', a.area], ['Owner', a.owner]]),
        link: `${site}/p/alert`,
      });
    }
    case 'summary.weekly': {
      const w = obj(d.week);
      const span = w.from && w.to ? ` · ${day(w.from)}–${day(w.to)}` : '';
      const list = (v: unknown) => (Array.isArray(v) ? v : []);
      return card({
        title: `Last week in one minute${span}`,
        subtitle: clean(d.headline) || undefined,
        sections: [
          { heading: 'Went well', items: list(d.went_well).map((x) => clean(x)) },
          { heading: 'Needs attention', items: list(d.needs_attention).map((x) => { const n = obj(x); return [clean(n.issue), clean(n.action)].filter(Boolean).join(' → '); }) },
          { heading: 'Keep an eye on', items: list(d.keep_an_eye_on).map((x) => clean(x)) },
        ],
        link: `${site}/`,
      });
    }
    default: {
      const label = TEAMS_EVENT_LABEL[event] || clean(event, 60) || 'CRM update';
      const who = clean(personName || cand.name || lead.name, 80);
      const link = safeId(cand.id) ? candLink : safeId(lead.id) ? leadLink : `${site}/`;
      return card({ title: who ? `${label}: ${who}` : label, link });
    }
  }
}

export type TeamsResult = { ok: true } | { ok: false; error: string };

/** Post a message to a Teams Workflows link. Only Teams/Power Automate addresses are allowed (no SSRF), redirects are
 *  not followed, and the link is never put in an error or a log. */
export async function postToTeams(url: string, body: unknown): Promise<TeamsResult> {
  if (typeof url !== 'string' || teamsUrlProblem(url)) return { ok: false, error: 'This is not a Teams Workflows link — check the link' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const r = await fetch(url.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
      redirect: 'manual',
      cache: 'no-store',
    });
    await r.arrayBuffer().catch(() => null); // drain; the body is not shown (it can echo the link)
    if (r.status >= 200 && r.status < 300) return { ok: true };
    if (r.status === 429) return { ok: false, error: 'Teams is busy (429) — will try again' };
    if (r.status >= 500) return { ok: false, error: `Teams said ${r.status} — will try again` };
    return { ok: false, error: `Teams said ${r.status || 'no'} — check the link` };
  } catch (e) {
    if (ctl.signal.aborted || (e instanceof Error && e.name === 'AbortError')) return { ok: false, error: 'Timed out' };
    return { ok: false, error: 'Could not reach Teams' };
  } finally {
    clearTimeout(timer);
  }
}

/** This CRM's public address, for the "Open in CRM" buttons. */
export async function siteUrl(): Promise<string> {
  const env = (process.env.NEXT_PUBLIC_SITE_URL || '').trim();
  if (env) return env.replace(/\/+$/, '');
  const { data } = await service().from('integration_config').select('value').eq('key', 'app_url').maybeSingle();
  return String(data?.value || '').trim().replace(/\/+$/, '');
}
