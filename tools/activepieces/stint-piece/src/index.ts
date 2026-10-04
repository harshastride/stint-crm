// Stint CRM block for Activepieces. Triggers subscribe themselves to CRM events; actions call the CRM's integration API.
import { createAction, createPiece, createTrigger, PieceAuth, Property, TriggerStrategy } from '@activepieces/pieces-framework';

type AuthProps = { base_url: string; api_key: string };
const props = (auth: unknown): AuthProps => ((auth as { props?: AuthProps })?.props ?? (auth as AuthProps));

async function call<T = any>(auth: unknown, method: string, path: string, body?: unknown): Promise<T> {
  const a = props(auth);
  const base = String(a.base_url || '').replace(/\/+$/, '');
  const res = await fetch(base + path, {
    method, headers: { 'x-api-key': a.api_key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any; try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 300) }; }
  if (!res.ok) throw new Error(`Stint CRM said ${res.status}: ${data?.error || text.slice(0, 200)}`);
  return data as T;
}

export const stintAuth = PieceAuth.CustomAuth({
  displayName: 'Stint CRM connection',
  description: 'CRM address and the Incoming API key from Admin settings → Automation log. On this Mac use http://host.docker.internal:3100',
  required: true,
  props: {
    base_url: Property.ShortText({ displayName: 'CRM address', description: 'e.g. https://crm.stintacademy.com (or http://host.docker.internal:3100 on this Mac)', required: true }),
    api_key: PieceAuth.SecretText({ displayName: 'API key', description: 'Incoming API key from the CRM’s Automation log page', required: true }),
  },
  validate: async ({ auth }) => {
    try { await call(auth, 'GET', '/api/integrations/me'); return { valid: true }; }
    catch (e) { return { valid: false, error: e instanceof Error ? e.message : 'Could not reach the CRM.' }; }
  },
});

// ---------- triggers: one per CRM event ----------
const LEAD = { id: 'b1c2…', name: 'Meena S', mobile: '9800000310', email: 'meena@example.com', city: 'Bengaluru', stage: 'New', program: 'Python', source: 'Meta lead form', owner: 'Teja', owner_email: 'teja@demo.stint.local', marketing_consent: true };
const CAND = { id: 'c3d4…', code: 'STA-2026-0413', name: 'Priya Reddy', stage: 'Training', program: 'Data Engineering', mobile: '9800010401', email: 'priya@example.com', owner: 'Praveen', owner_email: 'praveen@demo.stint.local' };
const TRIGGERS: { event: string; name: string; title: string; about: string; data: Record<string, unknown> }[] = [
  { event: 'lead.created', name: 'new_lead', title: 'New lead', about: 'A lead is added (enquiry form, import, Meta/Google, phone).', data: { lead: LEAD } },
  { event: 'lead.assigned', name: 'lead_assigned', title: 'Lead assigned', about: 'A lead gets a new owner.', data: { lead: LEAD } },
  { event: 'counselling.booked', name: 'counselling_booked', title: 'Counselling booked', about: 'A counselling session is booked for a lead.', data: { lead: LEAD, scheduled_at: '2026-10-06T05:30:00Z', counsellor: 'Manish' } },
  { event: 'quote.sent', name: 'quote_sent', title: 'Fee quote sent', about: 'A fee quote is marked Sent.', data: { lead: LEAD, program: 'Python', amount: 297500, discount_pct: 15, valid_until: '2026-10-10', instalments: [{ label: 'On joining', amount: 99100 }] } },
  { event: 'lead.converted', name: 'lead_converted', title: 'Lead converted to student', about: 'A lead becomes a candidate.', data: { lead: LEAD, candidate: CAND } },
  { event: 'payment.recorded', name: 'payment_recorded', title: 'Payment recorded', about: 'Finance records a payment (with receipt number).', data: { candidate: CAND, amount: 25000, mode: 'UPI', receipt_no: 'RCPT-2026-05001', paid_on: '2026-10-04', for: 'On joining' } },
  { event: 'attendance.absent', name: 'student_absent', title: 'Student absent', about: 'A student is marked absent in a class.', data: { candidate: CAND, day: '2026-10-04', batch: 'DE-13' } },
  { event: 'mock.booked', name: 'mock_booked', title: 'Mock interview booked', about: 'A mock interview is booked.', data: { candidate: CAND, status: 'Booked', level: 'L1' } },
  { event: 'mock.result', name: 'mock_result', title: 'Mock interview result', about: 'A mock interview is marked Passed or Failed.', data: { candidate: CAND, status: 'Failed', level: 'L1' } },
  { event: 'resume.rejected', name: 'resume_rejected', title: 'Resume rejected', about: 'A resume version is rejected.', data: { candidate: CAND, version: 'v2', reason: 'Format' } },
  { event: 'vendor_request.created', name: 'vendor_request', title: 'Vendor request created', about: 'A request to a vendor is raised for a candidate.', data: { candidate: CAND, request: {} } },
  { event: 'placement.recorded', name: 'placement_recorded', title: 'Placement recorded', about: 'A candidate gets an offer.', data: { candidate: CAND, company: 'Fractal', role: 'ML Engineer', ctc_lpa: 9.5, joining_on: '2026-10-15' } },
];

const makeTrigger = (t: (typeof TRIGGERS)[number]) => (createTrigger({
  auth: stintAuth,
  name: t.name,
  displayName: t.title,
  description: t.about,
  props: {},
  type: TriggerStrategy.WEBHOOK,
  sampleData: { id: 'event-id', event: t.event, occurred_at: '2026-10-04T09:00:00Z', data: t.data },
  async onEnable(ctx) {
    const sub = await call<{ id: string }>(ctx.auth, 'POST', '/api/integrations/hooks', { event: t.event, url: ctx.webhookUrl, label: 'Activepieces: ' + t.title });
    await ctx.store.put('stint_subscription', sub.id);
  },
  async onDisable(ctx) {
    const id = await ctx.store.get<string>('stint_subscription');
    if (id) await call(ctx.auth, 'DELETE', '/api/integrations/hooks?id=' + encodeURIComponent(id)).catch(() => undefined);
  },
  async run(ctx) {
    const body = ctx.payload.body as { id?: string; event?: string };
    if (!body?.id || body.event !== t.event) return [];
    // confirm with the CRM: only events the CRM really raised start the flow
    const real = await call(ctx.auth, 'GET', '/api/integrations/event?id=' + encodeURIComponent(body.id)).catch(() => null);
    return real && real.event === t.event ? [real] : [];
  },
  async test(ctx) {
    const out = await call<{ items: unknown[] }>(ctx.auth, 'GET', '/api/integrations/sample?event=' + t.event);
    return out.items.length ? out.items : [{ id: 'event-id', event: t.event, occurred_at: new Date().toISOString(), data: t.data }];
  },
}));

// ---------- actions ----------
const who = {
  mobile: Property.ShortText({ displayName: 'Mobile', description: 'The person’s mobile. Or give a lead / candidate ID below.', required: false }),
  lead_id: Property.ShortText({ displayName: 'Lead ID', required: false }),
  candidate_id: Property.ShortText({ displayName: 'Candidate ID', required: false }),
};
const pick = (v: Record<string, unknown>) => Object.fromEntries(['mobile', 'lead_id', 'candidate_id'].filter((k) => v[k]).map((k) => [k, v[k]]));

const createLead = createAction({
  auth: stintAuth, name: 'create_lead', displayName: 'Create lead',
  description: 'Add a lead (same mobile again adds a note instead). It is assigned by the CRM’s assignment rule.',
  props: {
    full_name: Property.ShortText({ displayName: 'Full name', required: true }),
    mobile: Property.ShortText({ displayName: 'Mobile', required: true }),
    email: Property.ShortText({ displayName: 'Email', required: false }),
    city: Property.ShortText({ displayName: 'City', required: false }),
    course: Property.ShortText({ displayName: 'Course', description: 'Program name as in the CRM, e.g. Python', required: false }),
    source: Property.ShortText({ displayName: 'Lead source', description: 'As in Marketing → Lead sources, e.g. Meta lead form', required: false }),
    campaign: Property.ShortText({ displayName: 'Campaign', required: false }),
    notes: Property.LongText({ displayName: 'Notes', required: false }),
    marketing_consent: Property.Checkbox({ displayName: 'Agreed to marketing messages', required: false, defaultValue: false }),
  },
  async run(ctx) { return call(ctx.auth, 'POST', '/api/integrations/lead', ctx.propsValue); },
});

const findLead = createAction({
  auth: stintAuth, name: 'find_by_mobile', displayName: 'Find person by mobile',
  description: 'Look up a lead or candidate by mobile number.',
  props: { mobile: Property.ShortText({ displayName: 'Mobile', required: true }) },
  async run(ctx) { return call(ctx.auth, 'GET', '/api/integrations/find?mobile=' + encodeURIComponent(ctx.propsValue.mobile)); },
});

const addNote = createAction({
  auth: stintAuth, name: 'add_note', displayName: 'Add note to timeline',
  description: 'Write a note on a lead’s or candidate’s timeline.',
  props: { ...who, text: Property.LongText({ displayName: 'Note', required: true }) },
  async run(ctx) { return call(ctx.auth, 'POST', '/api/integrations/note', { ...pick(ctx.propsValue), text: ctx.propsValue.text }); },
});

const addFollowUp = createAction({
  auth: stintAuth, name: 'create_follow_up', displayName: 'Create follow-up',
  description: 'Give someone a task about this person. Goes to the person’s owner unless you pick a staff email.',
  props: {
    ...who,
    title: Property.ShortText({ displayName: 'What needs doing', required: true }),
    due_in_hours: Property.Number({ displayName: 'Due in (hours)', required: false, defaultValue: 24 }),
    owner_email: Property.ShortText({ displayName: 'Give to (staff email)', required: false }),
  },
  async run(ctx) { const v = ctx.propsValue; return call(ctx.auth, 'POST', '/api/integrations/follow-up', { ...pick(v), title: v.title, due_in_hours: v.due_in_hours, owner_email: v.owner_email || undefined }); },
});

const moveStage = createAction({
  auth: stintAuth, name: 'move_stage', displayName: 'Move stage',
  description: 'Move a lead or candidate to another stage (the CRM’s own rules run, e.g. converting creates the student).',
  props: {
    ...who,
    stage: Property.Dropdown({
      displayName: 'Stage', required: true, auth: stintAuth, refreshers: [],
      options: async ({ auth }) => {
        if (!auth) return { disabled: true, options: [], placeholder: 'Connect Stint CRM first' };
        const me = await call<{ lead_stages: string[]; candidate_stages: string[] }>(auth, 'GET', '/api/integrations/me');
        return { disabled: false, options: [...me.lead_stages.map((s) => ({ label: 'Lead · ' + s, value: s })), ...me.candidate_stages.map((s) => ({ label: 'Candidate · ' + s, value: s }))] };
      },
    }),
  },
  async run(ctx) { return call(ctx.auth, 'POST', '/api/integrations/stage', { ...pick(ctx.propsValue), stage: ctx.propsValue.stage }); },
});

const feesDue = createAction({
  auth: stintAuth, name: 'fees_due_today', displayName: 'Get fee reminders for today',
  description: 'Instalments to remind today: 3 days before, on the day, and every 3 days late (with name, mobile, email).',
  props: { all: Property.Checkbox({ displayName: 'Every unpaid instalment instead', required: false, defaultValue: false }) },
  async run(ctx) { return call(ctx.auth, 'GET', '/api/integrations/fees-due' + (ctx.propsValue.all ? '?all=1' : '')); },
});

export const stintCrm = createPiece({
  displayName: 'Stint CRM',
  description: 'Leads, students, fees and placements from Stint CRM',
  auth: stintAuth,
  minimumSupportedRelease: '0.36.1',
  logoUrl: 'https://cdn.activepieces.com/pieces/webhook.svg',
  authors: ['stint'],
  actions: [createLead, findLead, addNote, addFollowUp, moveStage, feesDue],
  triggers: TRIGGERS.map(makeTrigger),
});
