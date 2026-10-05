// One entry per list page. The four generic blocks (list, board, editor panel, create form) read this,
// so adding or changing a page is mostly a change here.
import type { RefRow } from './session';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>;
export type Col = { key: string; label: string; type?: 'text' | 'money' | 'date' | 'datetime' | 'pill' | 'pct' | 'duration' | 'number' | 'tags' | 'person' | 'people' | 'due' | 'progress'; get?: (r: Row) => unknown; /** 'due': no warning once this is true (e.g. lead closed) */ doneWhen?: (r: Row) => boolean; /** 'progress': dropdown list giving the stage order */ list?: string; /** low-value: hidden by default, still available under Columns */ optional?: boolean };
export type Field = {
  key: string; label: string;
  type: 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'select' | 'ref' | 'person' | 'instalments' | 'file' | 'phone' | 'tags';
  list?: string;                 // dropdown list id (values come from Dropdown values)
  options?: string[];            // fixed options
  ref?: string;                  // small reference table: staff, program, batch, branch, company, lead_source, campaign
  person?: 'lead' | 'candidate'; // search-as-you-type picker
  required?: boolean; other?: boolean; addable?: boolean; cards?: boolean; // cards: show a short option list as big tappable cards
  slider?: { max: number; limitSetting?: string }; // a number picked with a slider (e.g. discount %)
  // addable: a ref picker where a missing name can be added on the spot
  createOnly?: boolean; readOnly?: boolean;
  def?: (ctx: { me: string }) => unknown;
};
/** A bulk action: set one field on all ticked rows, to a fixed `value` or one picked from a list / options / reference table. */
export type Bulk = { field: string; label: string; value?: string; list?: string; options?: string[]; ref?: string };
export type PersonRef = { kind: 'lead' | 'candidate'; id: string };
/** A database query builder (PostgREST). Server lists add filters to it. */
export type Q = any;
/** where: rows already in the browser; filter: the same rule for the database (pages with `server`). */
export type View = { label: string; where?: (r: Row, me: string) => boolean; filter?: (q: Q, me: string) => Q; order?: { col: string; asc?: boolean } };
/** One number in the summary strip. Clicking it applies `where` / `filter`. `sumKey`: value comes from the page's summaryRpc. */
export type Kpi = { label: string; calc: (rows: Row[]) => string | number; where?: (r: Row) => boolean; filter?: (q: Q) => Q; sumKey?: string; money?: boolean };
export type PageCfg = {
  id: string; table: string; readFrom?: string; /** readFrom view has the same rows/ids as table, so editing in the list still works */ sameRows?: boolean; select?: string; order?: { col: string; asc?: boolean };
  kind: string; purpose: string; cta?: string; readOnly?: boolean; noCreate?: boolean; csv?: boolean;
  columns: Col[]; views?: View[]; kpis?: Kpi[];
  board?: { field: string; list: string };
  person?: (r: Row) => PersonRef | null;
  fields?: Field[];
  rowTitle: (r: Row) => string;
  /** big list: the database pages, sorts, searches and filters (50 rows at a time); views and kpis need `filter` */
  server?: boolean;
  /** rpc returning { sumKey: number } for kpis with sumKey */
  summaryRpc?: string;
  derive?: (values: Row, refs: Record<string, RefRow[]>) => Row;  // fill fields from other fields
  empty?: string;                // what an empty list means on this page
  bulk?: Bulk[];                 // actions for ticked rows (shown only to roles that can edit the page)
  top?: string;                  // id of an extra block shown above the list (see ListPage TOP)
  assignee?: { field: string; status: string; label: string };   // only this person (or their team head) changes the status; the database enforces it
};

type Me = { id: string; role: string; level?: string | null };
/** Mirrors the database's may_act_for: you, or you are Head of that person's team. */
export const mayActFor = (who: string, me: Me, staff: RefRow[]) =>
  who === me.id || (me.level === 'Head' && staff.find((x) => x.id === who)?.extra?.role === me.role);
/** Name of the assigned person when someone else may not change this row's status; null when you may. */
export function statusLockedBy(cfg: PageCfg, row: Row, me: Me, staff: RefRow[]): string | null {
  const a = cfg.assignee; const who = a && row[a.field];
  if (!who || mayActFor(who, me, staff)) return null;
  return staff.find((x) => x.id === who)?.label || 'the assigned person';
}
/** Can you hand this row to someone else? Admin, the assignee, or their team head. */
export const mayReassign = (cfg: PageCfg, row: Row, me: Me, staff: RefRow[]) => {
  const who = cfg.assignee && row[cfg.assignee.field];
  return !who || me.role === 'Admin' || mayActFor(who, me, staff);
};

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const count = (label: string, where?: (r: Row) => boolean, filter?: (q: Q) => Q): Kpi => ({ label, where, filter, calc: (rows) => (where ? rows.filter(where).length : rows.length) });
/** Local midnight as an ISO timestamp, `days` from today (0 = today, 1 = tomorrow). */
export const dayStart = (days = 0) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days); return d.toISOString(); };
const today = (col: string) => (q: Q) => q.gte(col, dayStart()).lt(col, dayStart(1));
const CLOSED_LEAD = ['Converted', 'Not interested'];
const openLead = (q: Q) => q.not('stage', 'in', '("Converted","Not interested")');
const sum = (label: string, key: string, where?: (r: Row) => boolean): Kpi => ({ label, calc: (rows) => inr(rows.filter((r) => !where || where(r)).reduce((a, r) => a + Number(r[key] || 0), 0)) });
const isToday = (v: unknown) => !!v && new Date(String(v)).toDateString() === new Date().toDateString();
const isPast = (v: unknown) => !!v && new Date(String(v)).getTime() < Date.now();
const me = (_key: string) => ({ me: id }: { me: string }) => id;
const cand: Field = { key: 'candidate_id', label: 'Candidate', type: 'person', person: 'candidate', required: true, createOnly: true };
const lead: Field = { key: 'lead_id', label: 'Lead', type: 'person', person: 'lead', required: true, createOnly: true };
const candCol: Col = { key: 'candidate.full_name', label: 'Candidate' };
const leadCol: Col = { key: 'lead.full_name', label: 'Lead' };
const candPerson = (r: Row): PersonRef | null => { const id = r.candidate_id || r.candidate?.id; return id ? { kind: 'candidate', id } : null; };
const leadPerson = (r: Row): PersonRef | null => { const id = r.lead_id || r.lead?.id; return id ? { kind: 'lead', id } : null; };

export const PAGES: Record<string, PageCfg> = {
  followups: {
    bulk: [{ field: 'status', label: 'Mark done', value: 'Done' }, { field: 'owner_id', label: 'Reassign to', ref: 'staff' }],
    assignee: { field: 'owner_id', status: 'status', label: 'owner' },
    id: 'followups', table: 'follow_up', kind: 'Follow-up', purpose: 'Everything you need to do, sorted by when it is due.', cta: 'Add follow-up',
    empty: 'You’re all caught up. Follow-ups given to you or your team, and ones the CRM raises from its rules, appear here.',
    select: '*, lead:lead_id(id,full_name), candidate:candidate_id(id,full_name), owner:owner_id(full_name)', order: { col: 'due_at', asc: true },
    columns: [{ key: 'title', label: 'Follow-up' }, { key: 'who', label: 'Person', get: (r) => r.lead?.full_name || r.candidate?.full_name || '—' }, { key: 'owner_role', label: 'Team' },
      { key: 'owner.full_name', label: 'Owner', type: 'person' }, { key: 'due_at', label: 'Due', type: 'due', doneWhen: (r) => r.status === 'Done' }, { key: 'status', label: 'Status', type: 'pill' }],
    server: true,
    views: [{ label: 'Open', where: (r) => r.status === 'Open', filter: (q) => q.eq('status', 'Open') }, { label: 'Overdue', where: (r) => r.status === 'Open' && isPast(r.due_at) && !isToday(r.due_at), filter: (q) => q.eq('status', 'Open').lt('due_at', dayStart()) },
      { label: 'Today', where: (r) => r.status === 'Open' && isToday(r.due_at), filter: (q) => today('due_at')(q.eq('status', 'Open')) }, { label: 'Mine', where: (r, id) => r.status === 'Open' && r.owner_id === id, filter: (q, id) => q.eq('status', 'Open').eq('owner_id', id) }, { label: 'Done', where: (r) => r.status === 'Done', filter: (q) => q.eq('status', 'Done') }],
    kpis: [count('Open', (r) => r.status === 'Open', (q) => q.eq('status', 'Open')), count('Overdue', (r) => r.status === 'Open' && isPast(r.due_at) && !isToday(r.due_at), (q) => q.eq('status', 'Open').lt('due_at', dayStart())),
      count('Due today', (r) => r.status === 'Open' && isToday(r.due_at), (q) => today('due_at')(q.eq('status', 'Open')))],
    person: (r) => (r.lead_id ? { kind: 'lead', id: r.lead_id } : r.candidate_id ? { kind: 'candidate', id: r.candidate_id } : null),
    fields: [{ key: 'title', label: 'What needs doing', type: 'text', required: true }, { key: 'lead_id', label: 'Lead (if it is about a lead)', type: 'person', person: 'lead', createOnly: true },
      { key: 'candidate_id', label: 'Candidate (if it is about a candidate)', type: 'person', person: 'candidate', createOnly: true },
      { key: 'owner_id', label: 'Owner', type: 'ref', ref: 'staff', def: me('owner_id') }, { key: 'due_at', label: 'Due', type: 'datetime', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['Open', 'Done'] }],
    rowTitle: (r) => r.title,
  },
  campaign: {
    id: 'campaign', table: 'campaign', kind: 'Campaign', purpose: 'Plan ads and drives; see which bring enrolments.', cta: 'New campaign', order: { col: 'created_at' },
    columns: [{ key: 'name', label: 'Campaign' }, { key: 'channel', label: 'Channel' }, { key: 'status', label: 'Status', type: 'pill' }, { key: 'budget', label: 'Budget', type: 'money' }, { key: 'starts_on', label: 'Starts', type: 'date' }],
    views: [{ label: 'All' }, { label: 'Live', where: (r) => r.status === 'Live' }, { label: 'Planned', where: (r) => r.status === 'Planned' }, { label: 'Ended', where: (r) => r.status === 'Ended' }],
    kpis: [count('Live', (r) => r.status === 'Live'), sum('Budget', 'budget')], board: { field: 'status', list: 'campaign_status' },
    fields: [{ key: 'name', label: 'Campaign', type: 'text', required: true }, { key: 'channel', label: 'Channel', type: 'select', list: 'campaign_channel', other: true },
      { key: 'status', label: 'Status', type: 'select', list: 'campaign_status' }, { key: 'budget', label: 'Budget (₹)', type: 'number' }, { key: 'starts_on', label: 'Starts on', type: 'date' }],
    rowTitle: (r) => r.name,
  },
  source: {
    id: 'source', table: 'lead_source', kind: 'Lead source', purpose: 'Where leads come from, so every lead is tagged.', cta: 'Add source', order: { col: 'name', asc: true },
    columns: [{ key: 'name', label: 'Source' }, { key: 'type', label: 'Type' }, { key: 'connection', label: 'Connection', type: 'pill' }, { key: 'cost_per_lead', label: 'Cost / lead', type: 'money' }, { key: 'last_lead_at', label: 'Last lead', type: 'datetime' }],
    kpis: [count('Sources'), count('Connected', (r) => r.connection === 'Connected'), count('Manual', (r) => r.connection === 'Manual')],
    fields: [{ key: 'name', label: 'Source', type: 'text', required: true }, { key: 'type', label: 'Type', type: 'select', list: 'lead_source_type' },
      { key: 'connection', label: 'Connection', type: 'select', options: ['Manual', 'Not set up', 'Connected', 'Token expired'] }, { key: 'cost_per_lead', label: 'Cost per lead (₹)', type: 'number' }],
    rowTitle: (r) => r.name,
  },
  lead: {
    bulk: [{ field: 'owner_id', label: 'Reassign to', ref: 'staff' }, { field: 'stage', label: 'Move to stage', list: 'lead_stage' }],
    id: 'lead', table: 'lead', readFrom: 'lead_list', sameRows: true, kind: 'Lead', purpose: 'Every enquiry, from first contact until it becomes a candidate.', cta: 'Add lead',
    select: '*, program:program_id(name), owner:owner_id(full_name), source:source_id(name)', order: { col: 'created_at' },
    server: true,
    columns: [{ key: 'full_name', label: 'Lead' }, { key: 'stage', label: 'Stage', type: 'pill' }, { key: 'next_call_at', label: 'Next call', type: 'due', doneWhen: (r) => CLOSED_LEAD.includes(r.stage) }, { key: 'program.name', label: 'Course' }, { key: 'owner.full_name', label: 'Owner', type: 'person' },
      { key: 'mobile_masked', label: 'Mobile' }, { key: 'source.name', label: 'Source', optional: true }, { key: 'consent', label: 'Marketing OK', get: (r) => (r.marketing_consent ? 'Yes' : 'No'), optional: true }, { key: 'tags', label: 'Tags', type: 'tags', optional: true }],
    views: [{ label: 'All leads' }, { label: 'Calls due', where: (r) => !CLOSED_LEAD.includes(r.stage) && !!r.next_call_at && new Date(r.next_call_at).getTime() < new Date(dayStart(1)).getTime(), filter: (q) => openLead(q).lt('next_call_at', dayStart(1)), order: { col: 'next_call_at', asc: true } },
      { label: 'My leads', where: (r, id) => r.owner_id === id, filter: (q, id) => q.eq('owner_id', id) }, { label: 'Open', where: (r) => !CLOSED_LEAD.includes(r.stage), filter: openLead }],
    kpis: [count('New today', (r) => isToday(r.created_at), today('created_at')), count('Overdue calls', (r) => !CLOSED_LEAD.includes(r.stage) && isPast(r.next_call_at) && !isToday(r.next_call_at), (q) => openLead(q).lt('next_call_at', dayStart())),
      count('Calls due today', (r) => !CLOSED_LEAD.includes(r.stage) && isToday(r.next_call_at), (q) => today('next_call_at')(openLead(q))),
      count('Interested', (r) => r.stage === 'Interested', (q) => q.eq('stage', 'Interested')), count('Converted', (r) => r.stage === 'Converted', (q) => q.eq('stage', 'Converted'))],
    board: { field: 'stage', list: 'lead_stage' }, person: (r) => ({ kind: 'lead', id: r.id }),
    fields: [{ key: 'full_name', label: 'Full name', type: 'text', required: true }, { key: 'mobile', label: 'Mobile', type: 'phone', required: true }, { key: 'email', label: 'Email', type: 'text' },
      { key: 'city', label: 'City', type: 'text' }, { key: 'program_id', label: 'Course interested', type: 'ref', ref: 'program' }, { key: 'source_id', label: 'Source', type: 'ref', ref: 'lead_source' },
      { key: 'stage', label: 'Stage', type: 'select', list: 'lead_stage' }, { key: 'owner_id', label: 'Owner', type: 'ref', ref: 'staff' },
      { key: 'next_call_at', label: 'Next call', type: 'datetime' }, { key: 'tags', label: 'Tags', type: 'tags', list: 'tag' }, { key: 'notes', label: 'Notes', type: 'textarea' }],
    rowTitle: (r) => r.full_name,
  },
  call: {
    id: 'call', table: 'call_log', kind: 'Call', purpose: 'Every call made, its outcome and the follow-up set.', cta: 'Log call',
    select: '*, lead:lead_id(id,full_name), caller:caller_id(full_name)', order: { col: 'called_at' },
    columns: [leadCol, { key: 'caller.full_name', label: 'Caller' }, { key: 'outcome', label: 'Outcome', type: 'pill' }, { key: 'duration_sec', label: 'Duration', type: 'duration' }, { key: 'notes', label: 'Notes', optional: true }, { key: 'called_at', label: 'When', type: 'datetime' }],
    server: true,
    views: [{ label: 'Today', where: (r) => isToday(r.called_at), filter: today('called_at') }, { label: 'All' }, { label: 'No answer', where: (r) => r.outcome === 'No answer', filter: (q) => q.eq('outcome', 'No answer') }],
    kpis: [count('Calls today', (r) => isToday(r.called_at), today('called_at')), count('Connected today', (r) => isToday(r.called_at) && r.outcome !== 'No answer', (q) => today('called_at')(q).neq('outcome', 'No answer')),
      count('No answer today', (r) => isToday(r.called_at) && r.outcome === 'No answer', (q) => today('called_at')(q).eq('outcome', 'No answer'))],
    person: leadPerson,
    fields: [lead, { key: 'outcome', label: 'Outcome', type: 'select', list: 'call_outcome', required: true }, { key: 'duration_sec', label: 'Duration (seconds)', type: 'number' },
      { key: 'notes', label: 'Notes', type: 'textarea' }, { key: 'caller_id', label: 'Caller', type: 'ref', ref: 'staff', def: me('caller_id') }],
    rowTitle: (r) => 'Call · ' + (r.lead?.full_name || ''),
  },
  recordings: {
    id: 'recordings', table: 'recording', kind: 'Recording', purpose: 'Calls and talks captured for transcripts. Unmatched ones wait here until someone picks the person.', noCreate: true,
    select: '*, lead:lead_id(id,full_name), candidate:candidate_id(id,full_name), by:captured_by(full_name)', order: { col: 'created_at' },
    columns: [{ key: 'who', label: 'Number / person', get: (r) => r.lead?.full_name || r.candidate?.full_name || r.number || 'No number' }, { key: 'by.full_name', label: 'Captured by' }, { key: 'source', label: 'From' },
      { key: 'length_sec', label: 'Length', type: 'duration' }, { key: 'summary', label: 'Summary' }, { key: 'status', label: 'Status', type: 'pill' }, { key: 'created_at', label: 'When', type: 'datetime' }],
    views: [{ label: 'To confirm', where: (r) => r.status === 'Waiting to confirm' }, { label: 'Unmatched', where: (r) => r.status === 'Unmatched' }, { label: 'Confirmed', where: (r) => r.status === 'Confirmed' }, { label: 'All' }],
    kpis: [count('Captured'), count('Unmatched', (r) => r.status === 'Unmatched'), count('Waiting to confirm', (r) => r.status === 'Waiting to confirm')],
    fields: [{ key: 'lead_id', label: 'Lead this belongs to', type: 'person', person: 'lead' }, { key: 'candidate_id', label: 'Or candidate', type: 'person', person: 'candidate' },
      { key: 'summary', label: 'Summary (confirmed)', type: 'textarea' }, { key: 'outcome', label: 'Outcome', type: 'select', list: 'call_outcome' }, { key: 'follow_up', label: 'Next step', type: 'text' }],
    rowTitle: (r) => r.lead?.full_name || r.candidate?.full_name || r.number || 'Recording',
  },
  counsel: {
    assignee: { field: 'counsellor_id', status: 'status', label: 'counsellor' },
    top: 'compare',
    id: 'counsel', table: 'counselling_session', kind: 'Counselling session', purpose: 'Sessions where sales explains the program and fees.', cta: 'Book session',
    select: '*, lead:lead_id(id,full_name), counsellor:counsellor_id(full_name), program:program_id(name)', order: { col: 'scheduled_at' },
    columns: [leadCol, { key: 'counsellor.full_name', label: 'Counsellor' }, { key: 'program.name', label: 'Program' }, { key: 'status', label: 'Status', type: 'pill' }, { key: 'scheduled_at', label: 'When', type: 'datetime' }],
    views: [{ label: 'Upcoming', where: (r) => r.status === 'Booked' }, { label: 'Done', where: (r) => ['Done', 'Won'].includes(r.status) }, { label: 'No-show', where: (r) => r.status === 'No-show' }, { label: 'All' }],
    kpis: [count('Booked', (r) => r.status === 'Booked'), count('Done', (r) => ['Done', 'Won'].includes(r.status)), count('No-show', (r) => r.status === 'No-show')],
    board: { field: 'status', list: 'counselling_status' }, person: leadPerson,
    fields: [lead, { key: 'counsellor_id', label: 'Counsellor', type: 'ref', ref: 'staff', def: me('counsellor_id') }, { key: 'program_id', label: 'Program', type: 'ref', ref: 'program' },
      { key: 'scheduled_at', label: 'When', type: 'datetime', required: true }, { key: 'status', label: 'Status', type: 'select', list: 'counselling_status' }, { key: 'notes', label: 'Notes', type: 'textarea' }],
    rowTitle: (r) => 'Counselling · ' + (r.lead?.full_name || ''),
  },
  quote: {
    id: 'quote', table: 'fee_quote', kind: 'Fee quote', purpose: 'Price offers sent to a lead, with discount and instalments.', cta: 'New quote',
    select: '*, lead:lead_id(id,full_name), program:program_id(name)', order: { col: 'created_at' },
    columns: [leadCol, { key: 'program.name', label: 'Program' }, { key: 'list_price', label: 'List price', type: 'money', optional: true }, { key: 'discount_pct', label: 'Discount', type: 'pct' }, { key: 'amount', label: 'Final amount', type: 'money' },
      { key: 'plan', label: 'Plan', optional: true }, { key: 'status', label: 'Status', type: 'pill' }, { key: 'approval', label: 'Approval', get: (r) => (r.needs_approval ? 'Needs Sales head' : '—') }],
    views: [{ label: 'Open', where: (r) => ['Sent', 'Negotiating'].includes(r.status) }, { label: 'Accepted', where: (r) => r.status === 'Accepted' }, { label: 'Expired', where: (r) => r.status === 'Expired' }, { label: 'All' }],
    kpis: [count('Sent', (r) => r.status === 'Sent'), count('Accepted', (r) => r.status === 'Accepted'), sum('Value open', 'amount', (r) => ['Sent', 'Negotiating'].includes(r.status))],
    board: { field: 'status', list: 'quote_status' }, person: leadPerson,
    fields: [lead, { key: 'program_id', label: 'Program', type: 'ref', ref: 'program', required: true }, { key: 'list_price', label: 'List price (₹, from the program)', type: 'number', readOnly: true },
      { key: 'discount_pct', label: 'Discount %', type: 'number', slider: { max: 25, limitSetting: 'discount_approval_limit_pct' } }, { key: 'instalments', label: 'Payment plan', type: 'instalments' },
      { key: 'valid_until', label: 'Valid until', type: 'date' }, { key: 'status', label: 'Status', type: 'select', list: 'quote_status' }],
    derive: (v, refs) => { const p = refs.program?.find((x) => x.id === v.program_id); return p ? { ...v, list_price: Number(p.extra?.fee || 0) } : v; },
    rowTitle: (r) => 'Quote · ' + (r.lead?.full_name || ''),
  },
  target: {
    id: 'target', table: 'sales_target', kind: 'Sales target', purpose: 'Monthly target per salesperson.', cta: 'Set target', select: '*, staff:staff_id(full_name)', order: { col: 'month' },
    columns: [{ key: 'staff.full_name', label: 'Person' }, { key: 'month', label: 'Month', type: 'date' }, { key: 'target', label: 'Target (enrolments)', type: 'number' }],
    fields: [{ key: 'staff_id', label: 'Person', type: 'ref', ref: 'staff', required: true }, { key: 'month', label: 'Month (first day)', type: 'date', required: true }, { key: 'target', label: 'Target', type: 'number', required: true }],
    rowTitle: (r) => r.staff?.full_name || 'Target',
  },
  candidate: {
    bulk: [{ field: 'batch_id', label: 'Assign batch', ref: 'batch' }, { field: 'poc_id', label: 'Change owner', ref: 'staff' }],
    id: 'candidate', table: 'candidate', kind: 'Candidate', purpose: 'Enrolled students. Tap one for the quick panel, or open the full profile.', cta: 'Add candidate',
    select: '*, program:program_id(name), batch:batch_id(code), poc:poc_id(full_name)', order: { col: 'created_at' },
    server: true,
    columns: [{ key: 'full_name', label: 'Candidate' }, { key: 'code', label: 'ID' }, { key: 'stage', label: 'Stage', type: 'progress', list: 'candidate_stage' }, { key: 'program.name', label: 'Program' }, { key: 'batch.code', label: 'Batch' }, { key: 'poc.full_name', label: 'Owner', type: 'person' }, { key: 'tags', label: 'Tags', type: 'tags' }],
    views: [{ label: 'All' }, { label: 'My candidates', where: (r, id) => r.poc_id === id, filter: (q, id) => q.eq('poc_id', id) }, { label: 'Ready', where: (r) => r.stage === 'Ready', filter: (q) => q.eq('stage', 'Ready') }],
    kpis: [count('Active', (r) => !['Placed', 'Alumni'].includes(r.stage), (q) => q.not('stage', 'in', '("Placed","Alumni")')), count('In training', (r) => r.stage === 'Training', (q) => q.eq('stage', 'Training')),
      count('Ready', (r) => r.stage === 'Ready', (q) => q.eq('stage', 'Ready')), count('Placed', (r) => ['Placed', 'Alumni'].includes(r.stage), (q) => q.in('stage', ['Placed', 'Alumni']))],
    board: { field: 'stage', list: 'candidate_stage' }, person: (r) => ({ kind: 'candidate', id: r.id }),
    fields: [{ key: 'full_name', label: 'Full name', type: 'text', required: true }, { key: 'program_id', label: 'Program', type: 'ref', ref: 'program' }, { key: 'batch_id', label: 'Batch', type: 'ref', ref: 'batch' },
      { key: 'stage', label: 'Stage', type: 'select', list: 'candidate_stage' }, { key: 'poc_id', label: 'Owner (point of contact)', type: 'ref', ref: 'staff' }, { key: 'joined_on', label: 'Joined on', type: 'date' }, { key: 'tags', label: 'Tags', type: 'tags', list: 'tag' }],
    rowTitle: (r) => r.full_name,
  },
  program: {
    id: 'program', table: 'program', kind: 'Program', purpose: 'Courses on offer: fee and duration.', cta: 'Add program', order: { col: 'name', asc: true },
    columns: [{ key: 'name', label: 'Program' }, { key: 'duration_weeks', label: 'Weeks', type: 'number' }, { key: 'fee', label: 'Fee', type: 'money' }, { key: 'active', label: 'On offer', get: (r) => (r.active ? 'Active' : 'Paused'), type: 'pill' }],
    fields: [{ key: 'name', label: 'Program', type: 'text', required: true }, { key: 'duration_weeks', label: 'Duration (weeks)', type: 'number' }, { key: 'fee', label: 'Fee (₹)', type: 'number', required: true }],
    rowTitle: (r) => r.name,
  },
  branch: {
    id: 'branch', table: 'branch', kind: 'Branch', purpose: 'Physical or online centres.', cta: 'Add branch', select: '*, manager:manager_id(full_name)', order: { col: 'name', asc: true },
    columns: [{ key: 'name', label: 'Branch' }, { key: 'city', label: 'City' }, { key: 'mode', label: 'Mode' }, { key: 'manager.full_name', label: 'Manager' }],
    fields: [{ key: 'name', label: 'Branch', type: 'text', required: true }, { key: 'city', label: 'City', type: 'text' }, { key: 'mode', label: 'Mode', type: 'select', list: 'branch_mode' }, { key: 'manager_id', label: 'Manager', type: 'ref', ref: 'staff' }],
    rowTitle: (r) => r.name,
  },
  batch: {
    id: 'batch', table: 'batch', kind: 'Batch', purpose: 'Class groups with trainer and start date.', cta: 'New batch',
    select: '*, program:program_id(name), trainer:trainer_id(id,full_name), branch:branch_id(name), students:candidate(count)', order: { col: 'code', asc: true },
    columns: [{ key: 'code', label: 'Batch' }, { key: 'program.name', label: 'Program' }, { key: 'trainer.full_name', label: 'Trainer', type: 'person' },
      { key: 'team', label: 'Class', type: 'people', get: (r) => { const n = Number(r.students?.[0]?.count || 0); return { people: r.trainer ? [{ id: r.trainer.id, name: r.trainer.full_name, role: 'Trainer' }] : [], more: n, moreLabel: n + (n === 1 ? ' student' : ' students'), text: (r.trainer?.full_name || 'No trainer') + ' + ' + n + ' students' }; } }, { key: 'branch.name', label: 'Branch' }, { key: 'starts_on', label: 'Starts', type: 'date' }, { key: 'status', label: 'Status', type: 'pill' }],
    views: [{ label: 'Live', where: (r) => r.status === 'Live' }, { label: 'Upcoming', where: (r) => r.status === 'Upcoming' }, { label: 'Completed', where: (r) => r.status === 'Completed' }, { label: 'All' }],
    kpis: [count('Live', (r) => r.status === 'Live'), count('Upcoming', (r) => r.status === 'Upcoming')],
    fields: [{ key: 'code', label: 'Batch code', type: 'text', required: true }, { key: 'program_id', label: 'Program', type: 'ref', ref: 'program', required: true }, { key: 'trainer_id', label: 'Trainer', type: 'ref', ref: 'staff' },
      { key: 'branch_id', label: 'Branch', type: 'ref', ref: 'branch' }, { key: 'starts_on', label: 'Starts on', type: 'date' }, { key: 'ends_on', label: 'Ends on', type: 'date' }, { key: 'class_start', label: 'Class starts (e.g. 10:00)', type: 'text' }, { key: 'class_end', label: 'Class ends (e.g. 12:00)', type: 'text' }, { key: 'status', label: 'Status', type: 'select', list: 'batch_status' }],
    rowTitle: (r) => r.code,
  },
  note: {
    id: 'note', table: 'training_note', kind: 'Training note', purpose: 'Trainer notes on each student’s progress.', cta: 'Add note', select: '*, candidate:candidate_id(id,full_name), trainer:trainer_id(full_name)', order: { col: 'created_at' },
    columns: [candCol, { key: 'trainer.full_name', label: 'Trainer' }, { key: 'note', label: 'Note' }, { key: 'flag', label: 'Flag', type: 'pill' }, { key: 'created_at', label: 'Date', type: 'date' }],
    kpis: [count('Notes'), count('Flagged', (r) => ['Needs help', 'At risk'].includes(r.flag))], person: candPerson,
    fields: [cand, { key: 'note', label: 'Note', type: 'textarea', required: true }, { key: 'flag', label: 'Progress', type: 'select', list: 'training_flag' }, { key: 'trainer_id', label: 'Trainer', type: 'ref', ref: 'staff', def: me('trainer_id') }],
    rowTitle: (r) => 'Note · ' + (r.candidate?.full_name || ''),
  },
  mock: {
    assignee: { field: 'trainer_id', status: 'status', label: 'mock trainer' },
    id: 'mock', table: 'mock_session', kind: 'Mock session', purpose: 'Mock interviews run by our own team.', cta: 'Book mock', select: '*, candidate:candidate_id(id,full_name), trainer:trainer_id(full_name)', order: { col: 'scheduled_at' },
    columns: [candCol, { key: 'trainer.full_name', label: 'Mock trainer' }, { key: 'level', label: 'Level' }, { key: 'status', label: 'Result', type: 'pill' }, { key: 'scheduled_at', label: 'When', type: 'datetime' }],
    views: [{ label: 'Upcoming', where: (r) => r.status === 'Booked' }, { label: 'Done', where: (r) => r.status === 'Passed' }, { label: 'Failed', where: (r) => r.status === 'Failed' }, { label: 'All' }],
    kpis: [count('Booked', (r) => r.status === 'Booked'), { label: 'Pass rate', calc: (rows) => { const d = rows.filter((r) => r.status !== 'Booked'); return d.length ? Math.round((100 * d.filter((r) => r.status === 'Passed').length) / d.length) + '%' : '—'; } }],
    board: { field: 'status', list: 'mock_status' }, person: candPerson,
    fields: [cand, { key: 'trainer_id', label: 'Mock trainer', type: 'ref', ref: 'staff' }, { key: 'level', label: 'Level', type: 'select', list: 'mock_level' }, { key: 'scheduled_at', label: 'When', type: 'datetime', required: true }, { key: 'status', label: 'Result', type: 'select', list: 'mock_status' }],
    rowTitle: (r) => 'Mock · ' + (r.candidate?.full_name || ''),
  },
  sme: {
    assignee: { field: 'sme_id', status: 'verdict', label: 'SME' },
    id: 'sme', table: 'sme_feedback', kind: 'SME feedback', purpose: 'Expert ratings and comments after each mock.', cta: 'Add feedback', select: '*, candidate:candidate_id(id,full_name), sme:sme_id(full_name)', order: { col: 'created_at' },
    columns: [candCol, { key: 'sme.full_name', label: 'SME' }, { key: 'rating', label: 'Rating', get: (r) => (r.rating ? r.rating + ' / 5' : '—') }, { key: 'verdict', label: 'Verdict', type: 'pill' }, { key: 'comments', label: 'Comments', optional: true }, { key: 'created_at', label: 'Date', type: 'date' }],
    kpis: [count('Feedback given'), { label: 'Avg rating', calc: (rows) => (rows.length ? (rows.reduce((a, r) => a + Number(r.rating || 0), 0) / rows.length).toFixed(1) + ' / 5' : '—') }], person: candPerson,
    fields: [cand, { key: 'rating', label: 'Rating (1 to 5)', type: 'select', options: ['1', '2', '3', '4', '5'], required: true }, { key: 'verdict', label: 'Verdict', type: 'select', list: 'verdict', required: true },
      { key: 'comments', label: 'Comments', type: 'textarea' }, { key: 'sme_id', label: 'SME', type: 'ref', ref: 'staff', def: me('sme_id') }],
    rowTitle: (r) => 'Feedback · ' + (r.candidate?.full_name || ''),
  },
  resume: {
    assignee: { field: 'reviewer_id', status: 'status', label: 'reviewer' },
    id: 'resume', table: 'resume_version', kind: 'Resume', purpose: 'Every resume version and whether it was approved.', cta: 'Add resume version', select: '*, candidate:candidate_id(id,full_name), reviewer:reviewer_id(full_name)', order: { col: 'created_at' },
    columns: [candCol, { key: 'version', label: 'Version' }, { key: 'reviewer.full_name', label: 'Reviewer' }, { key: 'status', label: 'Status', type: 'pill' }, { key: 'reason', label: 'Reason', optional: true }, { key: 'created_at', label: 'Date', type: 'date' }, { key: 'file', label: 'File', get: (r) => (r.file_path ? 'Attached' : '—') }],
    views: [{ label: 'Pending review', where: (r) => r.status === 'Pending' }, { label: 'Approved', where: (r) => r.status === 'Approved' }, { label: 'Rejected', where: (r) => r.status === 'Rejected' }, { label: 'All' }],
    kpis: [count('Pending', (r) => r.status === 'Pending'), count('Approved', (r) => r.status === 'Approved'), count('Rejected', (r) => r.status === 'Rejected')],
    board: { field: 'status', list: 'resume_status' }, person: candPerson,
    fields: [cand, { key: 'version', label: 'Version (v1, v2…)', type: 'text', required: true }, { key: 'reviewer_id', label: 'Reviewer', type: 'ref', ref: 'staff' }, { key: 'status', label: 'Status', type: 'select', list: 'resume_status' }, { key: 'reason', label: 'Reason if rejected', type: 'text' }, { key: 'file_path', label: 'Resume file', type: 'file' }],
    rowTitle: (r) => 'Resume ' + r.version + ' · ' + (r.candidate?.full_name || ''),
  },
  doc: {
    id: 'doc', table: 'candidate_document', kind: 'Document', purpose: 'ID, education and experience proofs.', cta: 'Request document', select: '*, candidate:candidate_id(id,full_name), verifier:verified_by(full_name)', order: { col: 'created_at' },
    columns: [candCol, { key: 'doc_type', label: 'Document' }, { key: 'status', label: 'Status', type: 'pill' }, { key: 'verifier.full_name', label: 'Verified by' }, { key: 'verified_at', label: 'Verified', type: 'date' }, { key: 'file', label: 'File', get: (r) => (r.file_path ? 'Attached' : '—') }],
    views: [{ label: 'Missing', where: (r) => r.status === 'Missing' }, { label: 'Received', where: (r) => r.status === 'Received' }, { label: 'Verified', where: (r) => r.status === 'Verified' }, { label: 'All' }],
    kpis: [count('Missing', (r) => r.status === 'Missing'), count('Verified', (r) => r.status === 'Verified')], board: { field: 'status', list: 'document_status' }, person: candPerson,
    fields: [cand, { key: 'doc_type', label: 'Document', type: 'select', list: 'document_type', required: true, other: true }, { key: 'status', label: 'Status', type: 'select', list: 'document_status' }, { key: 'reject_reason', label: 'Why rejected (student sees this)', type: 'textarea' }, { key: 'verified_by', label: 'Verified by', type: 'ref', ref: 'staff' }, { key: 'file_path', label: 'File', type: 'file' }],
    rowTitle: (r) => r.doc_type + ' · ' + (r.candidate?.full_name || ''),
  },
  vendor: {
    id: 'vendor', table: 'vendor_request', kind: 'Vendor request', purpose: 'Work sent to outside vendors (resume writing, checks).', cta: 'New request', select: '*, candidate:candidate_id(id,full_name)', order: { col: 'created_at' },
    columns: [candCol, { key: 'vendor', label: 'Vendor' }, { key: 'request', label: 'Request' }, { key: 'status', label: 'Status', type: 'pill' }, { key: 'due_on', label: 'Due', type: 'date' }],
    views: [{ label: 'Open', where: (r) => r.status !== 'Done' }, { label: 'Done', where: (r) => r.status === 'Done' }],
    kpis: [count('Open', (r) => r.status !== 'Done'), count('Late', (r) => r.status !== 'Done' && isPast(r.due_on) && !isToday(r.due_on))], board: { field: 'status', list: 'request_status' }, person: candPerson,
    fields: [cand, { key: 'vendor', label: 'Vendor', type: 'select', list: 'vendor', required: true, other: true }, { key: 'request', label: 'What is needed', type: 'select', list: 'vendor_request_type', required: true, other: true },
      { key: 'send_with', label: 'Send with it', type: 'select', options: ['Latest resume', 'Latest resume + documents', 'Nothing'] }, { key: 'due_on', label: 'Due', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', list: 'request_status' }, { key: 'note', label: 'Note for the vendor', type: 'textarea' }],
    rowTitle: (r) => r.request + ' · ' + (r.candidate?.full_name || ''),
  },
  jobdocs: {
    id: 'jobdocs', table: 'job_record', kind: 'Job papers', purpose: 'Candidates working at a partner company: the papers the company owes them, and PF.', cta: 'Add job record',
    select: '*, candidate:candidate_id(id,full_name), papers:job_paper(paper,status)', order: { col: 'created_at' },
    columns: [candCol, { key: 'company', label: 'Company' }, { key: 'role', label: 'Role' }, { key: 'joined_on', label: 'Joined', type: 'date' }, { key: 'last_working_day', label: 'Last day', type: 'date' },
      { key: 'papers', label: 'Papers in', get: (r) => (r.papers || []).filter((p: Row) => ['Received', 'Verified'].includes(p.status)).length + ' received' }, { key: 'pf_status', label: 'PF', type: 'pill' }, { key: 'status', label: 'Status', type: 'pill' }],
    views: [{ label: 'Open', where: (r) => r.status !== 'Done' }, { label: 'Done', where: (r) => r.status === 'Done' }],
    kpis: [count('Open', (r) => r.status !== 'Done'), count('PF not applied', (r) => r.pf_status === 'Not applied')], board: { field: 'status', list: 'request_status' }, person: candPerson,
    fields: [cand, { key: 'company', label: 'Company', type: 'text', required: true }, { key: 'role', label: 'Role', type: 'text' }, { key: 'joined_on', label: 'Joined on', type: 'date', required: true },
      { key: 'last_working_day', label: 'Last working day (leave empty if still working)', type: 'date' }, { key: 'pf_status', label: 'PF', type: 'select', list: 'pf_status' }, { key: 'status', label: 'Status', type: 'select', list: 'request_status' }],
    rowTitle: (r) => (r.candidate?.full_name || '') + ' · ' + r.company,
  },
  announcement: {
    id: 'announcement', table: 'announcement', kind: 'Announcement', purpose: 'Short notices every staff member sees at the top of the CRM, until the date you pick.', cta: 'Post announcement',
    select: '*, by:created_by(full_name)', order: { col: 'created_at' },
    empty: 'No announcements yet. Post one for holidays, new batches or rule changes.',
    columns: [{ key: 'message', label: 'Message' }, { key: 'tone', label: 'Type', type: 'pill' }, { key: 'show_until', label: 'Show until', type: 'date' }, { key: 'by.full_name', label: 'Posted by' }, { key: 'created_at', label: 'Posted', type: 'datetime' }],
    views: [{ label: 'Showing now', where: (r) => String(r.show_until) >= new Date().toISOString().slice(0, 10) }, { label: 'All' }],
    fields: [{ key: 'message', label: 'Message (one or two lines)', type: 'textarea', required: true }, { key: 'tone', label: 'Type', type: 'select', options: ['Info', 'Important', 'Good news'], required: true, cards: true },
      { key: 'show_until', label: 'Show until', type: 'date', required: true, def: () => new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) }],
    rowTitle: (r) => String(r.message || '').slice(0, 40),
  },
  placement: {
    id: 'placement', table: 'placement', kind: 'Placement', purpose: 'Offers accepted and joining status.', cta: 'Record placement', select: '*, candidate:candidate_id(id,full_name), company:company_id(name)', order: { col: 'created_at' },
    columns: [candCol, { key: 'company.name', label: 'Company' }, { key: 'role', label: 'Role' }, { key: 'ctc_lpa', label: 'CTC (LPA)', type: 'number' }, { key: 'joining_on', label: 'Joining', type: 'date' }, { key: 'status', label: 'Status', type: 'pill' }],
    views: [{ label: 'Joining soon', where: (r) => r.status === 'Joining soon' }, { label: 'Joined', where: (r) => r.status === 'Joined' }, { label: 'All' }],
    kpis: [count('Placed', (r) => r.status !== 'Dropped'), count('Joining soon', (r) => r.status === 'Joining soon'), count('Dropped', (r) => r.status === 'Dropped')],
    board: { field: 'status', list: 'placement_status' }, person: candPerson,
    fields: [cand, { key: 'company_id', label: 'Company', type: 'ref', ref: 'company', required: true, addable: true }, { key: 'role', label: 'Role', type: 'text' }, { key: 'ctc_lpa', label: 'CTC (lakhs per year)', type: 'number' },
      { key: 'joining_on', label: 'Joining on', type: 'date' }, { key: 'status', label: 'Status', type: 'select', list: 'placement_status' }],
    rowTitle: (r) => (r.candidate?.full_name || '') + ' · ' + (r.company?.name || ''),
  },
  checklist: {
    assignee: { field: 'owner_id', status: 'status', label: 'owner' },
    id: 'checklist', table: 'placement_checklist_item', kind: 'Checklist item', purpose: 'Steps after an offer: documents, background check, joining.', cta: 'Add item', select: '*, candidate:candidate_id(id,full_name), owner:owner_id(full_name)', order: { col: 'created_at' },
    columns: [candCol, { key: 'item', label: 'Item' }, { key: 'owner.full_name', label: 'Owner', type: 'person' }, { key: 'status', label: 'Status', type: 'pill' }, { key: 'due_on', label: 'Due', type: 'date' }],
    views: [{ label: 'Open', where: (r) => r.status !== 'Done' }, { label: 'Done', where: (r) => r.status === 'Done' }], kpis: [count('Open items', (r) => r.status !== 'Done')], person: candPerson,
    fields: [cand, { key: 'item', label: 'Item', type: 'text', required: true }, { key: 'owner_id', label: 'Owner', type: 'ref', ref: 'staff', def: me('owner_id') }, { key: 'status', label: 'Status', type: 'select', list: 'checklist_status' }, { key: 'due_on', label: 'Due', type: 'date' }],
    rowTitle: (r) => r.item + ' · ' + (r.candidate?.full_name || ''),
  },
  alumni: {
    id: 'alumni', table: 'alumni_followup', readFrom: 'alumni_summary', kind: 'Alumni follow-up', purpose: 'Everyone in the Alumni stage, their last check-in and the referrals they bring.', cta: 'Log follow-up', select: '*', order: { col: 'contacted_on' },
    columns: [{ key: 'full_name', label: 'Candidate' }, { key: 'company', label: 'Company' }, { key: 'note', label: 'Last note', get: (r) => r.note || 'Not contacted yet' }, { key: 'referrals', label: 'Referrals', type: 'number' }, { key: 'by_name', label: 'By' }, { key: 'contacted_on', label: 'Last contact', type: 'date' }],
    views: [{ label: 'All' }, { label: 'Not contacted yet', where: (r) => !r.id }, { label: 'Contacted', where: (r) => !!r.id }],
    kpis: [count('Alumni'), count('Not contacted yet', (r) => !r.id), { label: 'Referrals', calc: (rows) => rows.reduce((a, r) => a + Number(r.referrals || 0), 0) }], person: candPerson,
    fields: [cand, { key: 'note', label: 'Note', type: 'textarea' }, { key: 'referrals', label: 'Referrals from them', type: 'number' }, { key: 'contacted_on', label: 'Contacted on', type: 'date' }, { key: 'by_id', label: 'By', type: 'ref', ref: 'staff', def: me('by_id') }],
    rowTitle: (r) => r.full_name || r.candidate?.full_name || 'Alumni',
  },
  plan: {
    id: 'plan', table: 'fee_plan', readFrom: 'fee_plan_summary', kind: 'Fee plan', purpose: 'Each student’s total fee, what is paid and what is still due.', cta: 'New plan', select: '*', order: { col: 'created_at' },
    columns: [{ key: 'full_name', label: 'Student' }, { key: 'total', label: 'Total', type: 'money' }, { key: 'paid', label: 'Paid', type: 'money' }, { key: 'balance', label: 'Balance', type: 'money' }, { key: 'plan', label: 'Plan' },
      { key: 'next_due', label: 'Next due', get: (r) => (r.overdue ? 'Overdue' : Number(r.balance) <= 0 ? 'Paid in full' : r.next_due || '—'), type: 'pill' }],
    views: [{ label: 'Active', where: (r) => Number(r.balance) > 0 }, { label: 'Overdue', where: (r) => !!r.overdue }, { label: 'Completed', where: (r) => Number(r.balance) <= 0 }],
    kpis: [count('Plans'), sum('Total value', 'total'), sum('Balance due', 'balance'), count('Overdue', (r) => !!r.overdue)], person: candPerson,
    fields: [cand, { key: 'total', label: 'Total fee (₹)', type: 'number', required: true }, { key: 'instalments', label: 'Payment plan', type: 'instalments' }],
    rowTitle: (r) => 'Fee plan · ' + (r.full_name || ''),
  },
  payment: {
    id: 'payment', table: 'fee_payment', kind: 'Payment', purpose: 'Every payment received or due, with its receipt. Recording a payment settles the oldest due instalment.', cta: 'Record payment', select: '*, candidate:candidate_id(id,full_name)', order: { col: 'due_on' },
    columns: [candCol, { key: 'label', label: 'For' }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'mode', label: 'Mode', optional: true }, { key: 'receipt_no', label: 'Receipt', optional: true }, { key: 'status', label: 'Status', type: 'pill' }, { key: 'due_on', label: 'Due', type: 'date' }, { key: 'paid_on', label: 'Paid', type: 'date' }, { key: 'pdf', label: 'Receipt', get: (r) => (r.status === 'Received' ? (r.receipt_no || 'Ready') : '—') }],
    server: true, summaryRpc: 'list_summary_payment',
    views: [{ label: 'Due and overdue', where: (r) => ['Due', 'Overdue'].includes(r.status), filter: (q) => q.in('status', ['Due', 'Overdue']) }, { label: 'Received', where: (r) => r.status === 'Received', filter: (q) => q.eq('status', 'Received') },
      { label: 'Refunds', where: (r) => /Refund/.test(r.status), filter: (q) => q.ilike('status', '%Refund%') }, { label: 'All' }],
    kpis: [{ ...sum('Collected', 'amount', (r) => r.status === 'Received'), where: (r) => r.status === 'Received', filter: (q) => q.eq('status', 'Received'), sumKey: 'collected', money: true },
      { ...sum('Overdue', 'amount', (r) => r.status === 'Overdue'), where: (r) => r.status === 'Overdue', filter: (q) => q.eq('status', 'Overdue'), sumKey: 'overdue', money: true },
      { label: 'Students overdue', calc: (rows) => new Set(rows.filter((r) => r.status === 'Overdue').map((r) => r.candidate_id)).size, where: (r) => r.status === 'Overdue', filter: (q) => q.eq('status', 'Overdue'), sumKey: 'late_students' }], person: candPerson,
    fields: [cand, { key: 'amount', label: 'Amount (₹)', type: 'number', required: true }, { key: 'status', label: 'Status', type: 'select', list: 'payment_status', required: true }, { key: 'mode', label: 'Mode', type: 'select', list: 'payment_mode' },
      { key: 'receipt_no', label: 'Receipt number (blank = automatic)', type: 'text' }, { key: 'due_on', label: 'Due on', type: 'date' }, { key: 'paid_on', label: 'Paid on', type: 'date' }],
    rowTitle: (r) => 'Payment · ' + (r.candidate?.full_name || ''),
  },
  alert: {
    bulk: [{ field: 'status', label: 'Resolve', value: 'Resolved' }, { field: 'owner_id', label: 'Reassign to', ref: 'staff' }],
    assignee: { field: 'owner_id', status: 'status', label: 'owner' },
    id: 'alert', table: 'alert', kind: 'Alert', purpose: 'Warnings for work that is slipping. Tap one to change its owner or resolve it.', noCreate: true,
    select: '*, lead:lead_id(id,full_name), candidate:candidate_id(id,full_name), owner:owner_id(full_name)', order: { col: 'raised_at' },
    columns: [{ key: 'title', label: 'Alert', get: (r) => r.title + ': ' + (r.lead?.full_name || r.candidate?.full_name || '') }, { key: 'area', label: 'Area' }, { key: 'owner.full_name', label: 'Owner', type: 'person' }, { key: 'priority', label: 'Priority', type: 'pill' }, { key: 'status', label: 'Status', type: 'pill' }, { key: 'raised_at', label: 'Raised', type: 'date' }],
    views: [{ label: 'Open', where: (r) => r.status === 'Open' }, { label: 'Resolved', where: (r) => r.status === 'Resolved' }], kpis: [count('Open', (r) => r.status === 'Open'), count('High priority', (r) => r.status === 'Open' && r.priority === 'High')],
    fields: [{ key: 'owner_id', label: 'Owner', type: 'ref', ref: 'staff' }, { key: 'priority', label: 'Priority', type: 'select', list: 'priority' }, { key: 'status', label: 'Status', type: 'select', options: ['Open', 'Resolved'] }],
    rowTitle: (r) => r.title,
  },
  history: {
    id: 'history', table: 'status_history', kind: 'Change', purpose: 'Every stage or status change: who changed it, when, and from what to what.', readOnly: true, select: '*', order: { col: 'at' }, csv: true,
    columns: [{ key: 'person_name', label: 'Record' }, { key: 'what', label: 'What changed' }, { key: 'change', label: 'From → to', get: (r) => (r.from_value || '—') + ' → ' + (r.to_value || '—') }, { key: 'at', label: 'When', type: 'datetime' }],
    views: [{ label: 'All' }, { label: 'Leads', where: (r) => r.entity === 'lead' }, { label: 'Candidates', where: (r) => r.entity === 'candidate' }, { label: 'Fees', where: (r) => /fee/.test(r.entity) }],
    kpis: [count('Changes today', (r) => isToday(r.at))], rowTitle: (r) => r.person_name || 'Change',
  },
  accesslog: {
    id: 'accesslog', table: 'data_access_log', kind: 'Access', purpose: 'Every time someone tapped Show on a phone, email or address.', readOnly: true, noCreate: true, csv: true,
    select: '*, staff:staff_id(full_name, role)', order: { col: 'at' },
    columns: [{ key: 'at', label: 'When', type: 'datetime' }, { key: 'staff', label: 'Staff', get: (r) => r.staff?.full_name || '—' }, { key: 'role', label: 'Role', get: (r) => r.staff?.role || '—' },
      { key: 'kind', label: 'What', get: (r) => (r.kind === 'candidate' ? 'Student' : r.kind === 'lead' ? 'Lead' : r.kind) }, { key: 'field', label: 'Field' }, { key: 'entity_id', label: 'Record', get: (r) => String(r.entity_id || '').slice(0, 8) }],
    views: [{ label: 'All' }, { label: 'Today', where: (r) => isToday(r.at) }],
    kpis: [count('Shown today', (r) => isToday(r.at))], rowTitle: (r) => (r.staff?.full_name || 'Someone') + ' · ' + (r.field || ''),
  },
  company: {
    id: 'company', table: 'company', kind: 'Company', purpose: 'Client companies that hire our candidates.', cta: 'Add company', order: { col: 'name', asc: true },
    columns: [{ key: 'name', label: 'Company' }, { key: 'openings', label: 'Openings', type: 'number' }, { key: 'contact', label: 'Contact' }, { key: 'status', label: 'Status', type: 'pill' }],
    views: [{ label: 'Clients', where: (r) => r.status === 'Client' }, { label: 'Prospects', where: (r) => r.status === 'Prospect' }, { label: 'All' }], kpis: [count('Clients', (r) => r.status === 'Client'), { label: 'Openings', calc: (rows) => rows.reduce((a, r) => a + Number(r.openings || 0), 0) }],
    fields: [{ key: 'name', label: 'Company', type: 'text', required: true }, { key: 'openings', label: 'Active openings', type: 'number' }, { key: 'contact', label: 'Contact', type: 'text' }, { key: 'status', label: 'Status', type: 'select', list: 'company_status' }],
    rowTitle: (r) => r.name,
  },
  rep_funnel: {
    id: 'rep_funnel', table: 'rep_funnel', top: 'report', kind: 'Report row', purpose: 'Leads to placement, month by month.', readOnly: true, csv: true, order: { col: 'month' },
    columns: [{ key: 'month', label: 'Month', get: (r) => new Date(r.month).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) }, { key: 'leads', label: 'Leads', type: 'number' }, { key: 'enrolled', label: 'Enrolled', type: 'number' }, { key: 'placed', label: 'Placed', type: 'number' }, { key: 'collected', label: 'Fees collected', type: 'money' }],
    rowTitle: (r) => String(r.month),
  },
  rep_roi: {
    id: 'rep_roi', table: 'rep_roi', top: 'report', kind: 'Report row', purpose: 'Which lead sources turn into enrolments and fees.', readOnly: true, csv: true, order: { col: 'leads' },
    columns: [{ key: 'source', label: 'Source' }, { key: 'type', label: 'Type' }, { key: 'leads', label: 'Leads', type: 'number' }, { key: 'enrolled', label: 'Enrolled', type: 'number' }, { key: 'enrol_pct', label: 'Enrol %', type: 'pct' }, { key: 'fees_booked', label: 'Fees booked', type: 'money' }],
    rowTitle: (r) => r.source,
  },
  rep_batch: {
    id: 'rep_batch', table: 'rep_batch', top: 'report', kind: 'Report row', purpose: 'Attendance and mock pass rate per batch.', readOnly: true, csv: true, order: { col: 'batch', asc: true },
    columns: [{ key: 'batch', label: 'Batch' }, { key: 'trainer', label: 'Trainer' }, { key: 'students', label: 'Students', type: 'number' }, { key: 'attendance_pct', label: 'Attendance', type: 'pct' }, { key: 'mock_pass_pct', label: 'Mock pass', type: 'pct' }],
    rowTitle: (r) => r.batch,
  },
  rep_place: {
    id: 'rep_place', table: 'rep_place', top: 'report', kind: 'Report row', purpose: 'Placements, pay and days-to-place by program.', readOnly: true, csv: true, order: { col: 'program', asc: true },
    columns: [{ key: 'program', label: 'Program' }, { key: 'placed', label: 'Placed', type: 'number' }, { key: 'placement_rate', label: 'Placement rate', type: 'pct', get: (r) => (Number(r.candidates) > 0 ? Math.round((100 * Number(r.placed_candidates)) / Number(r.candidates)) : null) }, { key: 'avg_ctc_lpa', label: 'Avg CTC (LPA)', type: 'number' }, { key: 'days_to_place', label: 'Days to place', type: 'number' }],
    rowTitle: (r) => r.program,
  },
  rep_cash: {
    id: 'rep_cash', table: 'rep_cash', top: 'report', kind: 'Report row', purpose: 'Fees booked, collected and overdue by program.', readOnly: true, csv: true, order: { col: 'program', asc: true },
    columns: [{ key: 'program', label: 'Program' }, { key: 'booked', label: 'Booked', type: 'money' }, { key: 'collected', label: 'Collected', type: 'money' }, { key: 'overdue', label: 'Overdue', type: 'money' }, { key: 'collected_pct', label: 'Collected %', type: 'pct' }],
    rowTitle: (r) => r.program,
  },
  assign: {
    id: 'assign', table: 'assignment_rule', kind: 'Assignment rule', purpose: 'Who gets a new lead or candidate, decided automatically.', cta: 'New rule', order: { col: 'when_text', asc: true },
    columns: [{ key: 'when_text', label: 'When' }, { key: 'give_to', label: 'Give to' }, { key: 'method', label: 'Method' }, { key: 'limit_per_person', label: 'Limit' }, { key: 'status', label: 'Status', type: 'pill' }],
    fields: [{ key: 'when_text', label: 'When', type: 'select', options: ['New lead', 'Lead marked Interested', 'Lead converted'], required: true }, { key: 'give_to', label: 'Give to (role)', type: 'select', list: '__roles', required: true }, { key: 'method', label: 'Method', type: 'select', options: ['Round-robin, in turn', 'Least busy first', 'By branch', 'By course'] },
      { key: 'limit_per_person', label: 'Limit per person', type: 'text' }, { key: 'status', label: 'Status', type: 'select', options: ['Live', 'Off'] }],
    rowTitle: (r) => r.when_text,
  },
  followrules: {
    id: 'followrules', table: 'follow_rule', kind: 'Follow-up rule', purpose: 'What the quick panel suggests next, and when a record counts as stuck.', cta: 'New rule', order: { col: 'trigger', asc: true },
    columns: [{ key: 'trigger', label: 'When this is logged' }, { key: 'suggest_next', label: 'Suggest next' }, { key: 'after', label: 'After' }, { key: 'stage', label: 'Stage' }, { key: 'stuck_after_days', label: 'Stuck after (days)', type: 'number' }, { key: 'status', label: 'Status', type: 'pill' }],
    fields: [{ key: 'trigger', label: 'When this is logged', type: 'select', options: ['Call: No answer', 'Call: Callback', 'Call: Connected', 'Call: Interested', 'Call: Booked counselling', 'Call: Wrong number', 'Mock: Failed', 'Attendance: Absent', 'Resume: Rejected', 'Fee: Overdue'], required: true }, { key: 'suggest_next', label: 'Suggest next', type: 'text', required: true }, { key: 'after', label: 'After', type: 'select', options: ['Same day', '1 day', '2 days', '3 days', '7 days', 'Every 3 days', 'At agreed time'], other: true }, { key: 'stage', label: 'Stage', type: 'text' },
      { key: 'stuck_after_days', label: 'Stuck after (days)', type: 'number' }, { key: 'status', label: 'Status', type: 'select', options: ['Live', 'Off'] }],
    rowTitle: (r) => r.trigger,
  },
  imports: {
    id: 'imports', table: 'import_run', kind: 'Import', purpose: 'Bring leads in from Excel or CSV. Each import is listed here with what went in and what failed.', readOnly: true, select: '*, by:by_id(full_name)', order: { col: 'created_at' },
    columns: [{ key: 'file', label: 'File' }, { key: 'into_table', label: 'Into' }, { key: 'total_rows', label: 'Rows', type: 'number' }, { key: 'result', label: 'Result', get: (r) => r.ok_rows + ' ok · ' + r.duplicate_rows + ' already there · ' + r.failed_rows + ' failed' }, { key: 'by.full_name', label: 'By' }, { key: 'created_at', label: 'When', type: 'datetime' }],
    kpis: [count('Imports'), { label: 'Rows imported', calc: (rows) => rows.reduce((a, r) => a + Number(r.ok_rows || 0), 0) }], rowTitle: (r) => r.file,
  },
  automations: {
    id: 'automations', table: 'automation', top: 'builder', kind: 'Automation', purpose: 'Everything the CRM sends or receives on its own. Flows run in Activepieces; this list controls them.', cta: 'New automation', order: { col: 'direction', asc: true },
    columns: [{ key: 'name', label: 'Flow' }, { key: 'direction', label: 'Direction' }, { key: 'trigger', label: 'When' }, { key: 'channel', label: 'Channel' }, { key: 'recipient', label: 'To' }, { key: 'status', label: 'Status', type: 'pill' }],
    views: [{ label: 'All' }, { label: 'Incoming', where: (r) => r.direction === 'Incoming' }, { label: 'Outgoing', where: (r) => r.direction === 'Outgoing' }, { label: 'Live', where: (r) => r.status === 'Live' }],
    kpis: [count('Flows'), count('Live', (r) => r.status === 'Live'), count('Paused', (r) => r.status === 'Paused')],
    fields: [{ key: 'name', label: 'Name', type: 'text', required: true }, { key: 'direction', label: 'Direction', type: 'select', options: ['Outgoing', 'Incoming'] }, { key: 'trigger', label: 'When this happens', type: 'text' },
      { key: 'channel', label: 'Channel', type: 'select', options: ['WhatsApp', 'Email', 'WhatsApp + email', 'WhatsApp + in-app', 'In-app only'] }, { key: 'recipient', label: 'To', type: 'text' },
      { key: 'message', label: 'Message ({name}, {course}, {amount}, {date}, {link} are filled in)', type: 'textarea' }, { key: 'status', label: 'Status', type: 'select', options: ['Paused', 'Live'] }],
    rowTitle: (r) => r.name,
  },
  deliveries: {
    id: 'deliveries', table: 'integration_event', kind: 'Delivery', purpose: 'Every event sent to Activepieces, and whether it arrived. Failed ones retry by themselves five times; tap one to retry now.', noCreate: true, readOnly: true, top: 'activepieces',
    select: '*', order: { col: 'created_at' },
    columns: [{ key: 'event', label: 'Flow event' }, { key: 'person_name', label: 'About' }, { key: 'status', label: 'Status', type: 'pill' }, { key: 'attempts', label: 'Tries', type: 'number' },
      { key: 'last_error', label: 'Problem' }, { key: 'created_at', label: 'Raised', type: 'datetime' }, { key: 'sent_at', label: 'Sent', type: 'datetime' }],
    views: [{ label: 'All' }, { label: 'Failed', where: (r) => r.status === 'Failed' }, { label: 'Waiting', where: (r) => ['Pending', 'Sending'].includes(r.status) }, { label: 'Sent', where: (r) => r.status === 'Sent' }],
    kpis: [count('Sent', (r) => r.status === 'Sent'), count('Waiting', (r) => ['Pending', 'Sending'].includes(r.status)), count('Failed', (r) => r.status === 'Failed')],
    fields: [{ key: 'event', label: 'Event', type: 'text', readOnly: true }, { key: 'status', label: 'Status', type: 'text', readOnly: true }, { key: 'last_error', label: 'Problem', type: 'text', readOnly: true }, { key: 'response_code', label: 'Answer code', type: 'number', readOnly: true }],
    rowTitle: (r) => r.event + (r.person_name ? ' · ' + r.person_name : ''),
  },
  fields: {
    id: 'fields', table: 'custom_field', kind: 'Custom field', purpose: 'Your own extra fields on leads, students, placements, batches and companies. They appear under “More details” in the form.', cta: 'Add field',
    order: { col: 'page_id', asc: true },
    columns: [{ key: 'label', label: 'Field' }, { key: 'page', label: 'On', get: (r) => ({ lead: 'Leads', candidate: 'Students', placement: 'Placements', batch: 'Batches', company: 'Companies' } as Record<string, string>)[r.page_id] || r.page_id },
      { key: 'type', label: 'Type' }, { key: 'options', label: 'Choices' }, { key: 'in_list', label: 'Column in list' }, { key: 'key', label: 'Key' }],
    fields: [{ key: 'page_id', label: 'Add it to', type: 'select', options: ['lead', 'candidate', 'placement', 'batch', 'company'], required: true, createOnly: true },
      { key: 'label', label: 'Field name', type: 'text', required: true }, { key: 'type', label: 'Type', type: 'select', options: ['Text', 'Number', 'Date', 'Yes / No', 'Choice'], required: true },
      { key: 'options', label: 'Choices (for Choice, comma-separated)', type: 'text' }, { key: 'in_list', label: 'Show as a column in the list', type: 'select', options: ['No', 'Yes'] },
      { key: 'sort', label: 'Order (small numbers first)', type: 'number' }],
    rowTitle: (r) => r.label,
  },
  templates: {
    id: 'templates', table: 'message_template', kind: 'Template', purpose: 'Ready-made WhatsApp and email messages staff can pick in the Chat tab. {{first_name}} and {{name}} are filled in. WhatsApp templates must also be approved in Meta with the same name.', cta: 'Add template',
    order: { col: 'name', asc: true },
    columns: [{ key: 'name', label: 'Template' }, { key: 'channel', label: 'Channel', get: (r) => (r.channel === 'email' ? 'Email' : 'WhatsApp') },
      { key: 'approved', label: 'Ready to use', get: (r) => (r.approved ? 'Yes' : 'No') }, { key: 'body', label: 'Message' }],
    fields: [{ key: 'name', label: 'Name (same as in Meta for WhatsApp)', type: 'text', required: true }, { key: 'channel', label: 'Channel', type: 'select', options: ['whatsapp', 'email'], required: true },
      { key: 'subject', label: 'Email subject', type: 'text' }, { key: 'body', label: 'Message', type: 'textarea', required: true }, { key: 'approved', label: 'Ready to use', type: 'select', options: ['Yes', 'No'] }],
    rowTitle: (r) => r.name,
  },
  connections: {
    id: 'connections', table: 'connection', kind: 'Connection', purpose: 'The outside services the CRM talks to. They are connected inside Activepieces; record the state here.', cta: 'Add connection', order: { col: 'service', asc: true },
    columns: [{ key: 'service', label: 'Service' }, { key: 'used_for', label: 'Used for' }, { key: 'status', label: 'Status', type: 'pill' }, { key: 'last_checked_at', label: 'Last checked', type: 'datetime' }],
    kpis: [count('Connected', (r) => r.status === 'Connected'), count('Not set up', (r) => r.status === 'Not set up')],
    fields: [{ key: 'service', label: 'Service', type: 'text', required: true }, { key: 'used_for', label: 'Used for', type: 'text' }, { key: 'status', label: 'Status', type: 'select', options: ['Not set up', 'Connected', 'Token expired'], required: true }],
    rowTitle: (r) => r.service,
  },
  branding: {
    id: 'branding', table: 'setting', kind: 'Setting', purpose: 'App name, colours and limits used across the CRM.', noCreate: true, order: { col: 'key', asc: true },
    columns: [{ key: 'key', label: 'Setting', get: (r) => String(r.key).replace(/_/g, ' ') }, { key: 'value', label: 'Value' }, { key: 'updated_at', label: 'Updated', type: 'date' }],
    fields: [{ key: 'value', label: 'Value', type: 'text', required: true }], rowTitle: (r) => String(r.key).replace(/_/g, ' '),
  },
  users: {
    id: 'users', table: 'staff', kind: 'User', purpose: 'Everyone who logs in: their role, level, branch and status.', cta: 'Invite user', select: '*, branch:branch_id(name)', order: { col: 'full_name', asc: true },
    columns: [{ key: 'full_name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'role', label: 'Role' }, { key: 'level', label: 'Level' }, { key: 'branch.name', label: 'Branch' }, { key: 'status', label: 'Status', type: 'pill' }],
    views: [{ label: 'Active', where: (r) => r.status === 'Active' }, { label: 'Invited', where: (r) => r.status === 'Invited' }, { label: 'Disabled', where: (r) => r.status === 'Disabled' }],
    kpis: [count('Active users', (r) => r.status === 'Active'), count('Team heads', (r) => r.level === 'Head')],
    fields: [{ key: 'full_name', label: 'Name', type: 'text', required: true }, { key: 'email', label: 'Email', type: 'text', required: true, createOnly: true }, { key: 'role', label: 'Role', type: 'select', list: '__roles', required: true },
      { key: 'level', label: 'Level', type: 'select', options: ['Junior', 'Head'] }, { key: 'branch_id', label: 'Branch', type: 'ref', ref: 'branch' }, { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Invited', 'Disabled'] }],
    rowTitle: (r) => r.full_name,
  },
};

// Pages with their own screen instead of the generic list
export const SPECIAL = ['home', 'enquiry', 'enrolform', 'attendance', 'roles', 'dropdowns'];

export const getPath = (r: Row, path: string): unknown => path.split('.').reduce<any>((o, k) => (o == null ? o : o[k]), r);
