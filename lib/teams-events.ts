// Teams alerts: which CRM events can be posted to a Teams channel, in the order the Admin page lists them.
// `defaults` are the role channels that receive the event out of the box (migration 084 seeds the same pairs).
// Shared by the Admin page and the server sender; holds no secrets.

export type TeamsEvent = { event: string; label: string; about: string; group: string; defaults: string[] };

export const TEAMS_EVENTS: TeamsEvent[] = [
  { event: 'candidate.created', label: 'New student joined', about: 'A student is enrolled (from a lead or at the desk).', group: 'Students', defaults: ['Admin', 'Front desk', 'HR / Counsellor', 'Finance'] },
  { event: 'attendance.absent', label: 'Student absent', about: 'A student is marked absent in a batch.', group: 'Students', defaults: ['Trainer'] },
  { event: 'mock.result', label: 'Mock result', about: 'A mock interview is marked Passed or Failed.', group: 'Students', defaults: [] },
  { event: 'resume.rejected', label: 'Resume rejected', about: 'A resume version is rejected.', group: 'Students', defaults: ['HR / Counsellor'] },
  { event: 'vendor_request.created', label: 'Vendor request', about: 'A new vendor request is raised for a student.', group: 'Students', defaults: ['Placement'] },
  { event: 'placement.recorded', label: 'Student placed', about: 'A placement is recorded.', group: 'Students', defaults: ['Admin', 'Placement', 'Everyone'] },
  { event: 'lead.created', label: 'New lead', about: 'A lead comes in (any source). Can be busy.', group: 'Leads and sales', defaults: [] },
  { event: 'lead.assigned', label: 'Lead assigned', about: 'A lead gets a new owner.', group: 'Leads and sales', defaults: [] },
  { event: 'counselling.booked', label: 'Counselling booked', about: 'A counselling session is booked for a lead.', group: 'Leads and sales', defaults: ['Sales'] },
  { event: 'quote.sent', label: 'Fee quote sent', about: 'A fee quote is sent to a lead.', group: 'Leads and sales', defaults: [] },
  { event: 'lead.converted', label: 'Lead converted', about: 'A lead becomes a student. Usually covered by “New student joined”.', group: 'Leads and sales', defaults: [] },
  { event: 'brochure.opened', label: 'Brochure opened', about: 'A lead opens a brochure link (first time, or again after 30 minutes).', group: 'Leads and sales', defaults: ['Telecaller', 'Sales'] },
  { event: 'conversation.new', label: 'New conversation', about: 'Someone new messages the institute on WhatsApp (not a lead yet).', group: 'Leads and sales', defaults: [] },
  { event: 'lead.won_back', label: 'Lead won back', about: 'A lost or quiet lead is put back into calling from the Win-back list.', group: 'Leads and sales', defaults: [] },
  { event: 'payment.recorded', label: 'Fee received', about: 'A fee payment is marked Received.', group: 'Money', defaults: ['Admin', 'Finance'] },
  { event: 'alert.high', label: 'High-priority alert', about: 'The CRM raises a High priority alert (for example a fee long overdue).', group: 'For the owner', defaults: ['Admin'] },
  { event: 'summary.weekly', label: 'Weekly owner summary', about: 'Monday 8 am: last week in one minute, written by AI.', group: 'For the owner', defaults: ['Admin'] },
];

export const TEAMS_EVENT_LABEL: Record<string, string> = Object.fromEntries(TEAMS_EVENTS.map((e) => [e.event, e.label]));

/** A channel is for one role, or for everyone. Admin is the owner's channel. */
export const EVERYONE = 'Everyone';

/** Teams “Workflows” webhook addresses (Teams → channel → Workflows → “Post to a channel when a webhook request is received”). */
export const TEAMS_HOSTS = [/\.logic\.azure\.com$/i, /\.powerplatform\.com$/i, /\.powerautomate\.com$/i, /\.webhook\.office\.com$/i];
export function teamsUrlProblem(url: string): string | null {
  let u: URL;
  try { u = new URL(url.trim()); } catch { return 'That is not a web address. Paste the full link Teams gave you.'; }
  if (u.protocol !== 'https:') return 'The link must start with https://';
  if (!TEAMS_HOSTS.some((h) => h.test(u.hostname))) return 'This does not look like a Teams Workflows link. In Teams, open the channel → Workflows → “Post to a channel when a webhook request is received”, and copy that link.';
  return null;
}
