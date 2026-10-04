// What to do next for a lead or candidate: buttons in the quick panel, by stage and for each follow-up.
// "page" is the page the button needs (shown only to roles that can edit it). "href" opens that page with the person filled in.
import type { PersonRef } from './pages';

export type Step = { key: string; label: string; page: string; inline?: 'call' | 'convert'; href?: (p: PersonRef) => string };

const newOn = (page: string) => (p: PersonRef) => `/p/${page}?new=${p.kind}:${p.id}`;
const edit = (p: PersonRef) => `/p/${p.kind}?edit=${p.kind}:${p.id}`;

export const STEPS: Record<string, Step> = {
  call:        { key: 'call', label: 'Log call', page: 'call', inline: 'call' },
  counsel:     { key: 'counsel', label: 'Book counselling', page: 'counsel', href: newOn('counsel') },
  quote:       { key: 'quote', label: 'Send fee quote', page: 'quote', href: newOn('quote') },
  convert:     { key: 'convert', label: 'Convert to student', page: 'lead', inline: 'convert' },
  datasheet:   { key: 'datasheet', label: 'Open data sheet', page: 'enrolform', href: (p) => `/p/enrolform?candidate=${p.id}` },
  batch:       { key: 'batch', label: 'Assign batch', page: 'candidate', href: edit },
  payment:     { key: 'payment', label: 'Record payment', page: 'payment', href: newOn('payment') },
  plan:        { key: 'plan', label: 'Fee plan', page: 'plan', href: newOn('plan') },
  attendance:  { key: 'attendance', label: 'Mark attendance', page: 'attendance', href: () => '/p/attendance' },
  note:        { key: 'note', label: 'Training note', page: 'note', href: newOn('note') },
  mock:        { key: 'mock', label: 'Book mock', page: 'mock', href: newOn('mock') },
  resume:      { key: 'resume', label: 'Add resume', page: 'resume', href: newOn('resume') },
  doc:         { key: 'doc', label: 'Request document', page: 'doc', href: newOn('doc') },
  vendor:      { key: 'vendor', label: 'Send to vendor', page: 'vendor', href: newOn('vendor') },
  placement:   { key: 'placement', label: 'Record placement', page: 'placement', href: newOn('placement') },
  checklist:   { key: 'checklist', label: 'Joining checklist', page: 'checklist', href: newOn('checklist') },
  alumni:      { key: 'alumni', label: 'Log check-in', page: 'alumni', href: newOn('alumni') },
};

// The usual next steps for each stage (first ones first)
const BY_STAGE: Record<string, string[]> = {
  New: ['call', 'counsel'], Callback: ['call', 'counsel'], Interested: ['counsel', 'call'],
  Counselling: ['quote', 'counsel', 'convert'], 'Not interested': ['call'],
  Enrolled: ['datasheet', 'batch', 'payment'], Training: ['attendance', 'note', 'payment'],
  Mocks: ['mock', 'note'], Resume: ['resume', 'doc'], Docs: ['doc', 'resume'],
  Ready: ['vendor', 'placement'], Placed: ['checklist', 'placement'], Alumni: ['alumni'],
};
export const stepsForStage = (stage: string | null | undefined) => (BY_STAGE[stage || ''] || []).map((k) => STEPS[k]);

// A follow-up's button, recognised from its wording (rules and automations write these titles)
const BY_TITLE: [RegExp, string][] = [
  [/call|ring|phone/i, 'call'], [/counsel/i, 'counsel'], [/quote/i, 'quote'],
  [/data ?sheet|details/i, 'datasheet'], [/batch/i, 'batch'],
  [/payment|instal|fee|receipt/i, 'payment'], [/attendance|absent/i, 'attendance'],
  [/mock/i, 'mock'], [/resume|cv/i, 'resume'], [/document|certificate|proof|\bdoc/i, 'doc'],
  [/vendor/i, 'vendor'], [/placement|offer|joining/i, 'placement'], [/check-?in|alumni/i, 'alumni'],
];
export function stepForFollowUp(title: string, kind: PersonRef['kind']): Step | null {
  const hit = BY_TITLE.find(([re]) => re.test(title));
  if (!hit) return null;
  const s = STEPS[hit[1]];
  if (kind === 'lead' && ['datasheet', 'batch', 'payment', 'attendance', 'mock', 'resume', 'doc', 'vendor', 'placement', 'alumni'].includes(s.key)) return null;
  if (kind === 'candidate' && ['call', 'counsel', 'quote', 'convert'].includes(s.key)) return null;
  return s;
}
