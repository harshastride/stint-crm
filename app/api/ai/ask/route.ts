import { NextResponse } from 'next/server';
import { crossSite, limited } from '@/lib/server/guard';
import { asCaller, service } from '@/lib/server/recordings';
import { askJson, MODEL_FAST, obj, oneOfOrNull, SafeError, scrub, str, strOrNull } from '@/lib/server/ai';

export const maxDuration = 60;

// Ask the CRM. Staff type a plain question; the AI only FILLS A REQUEST over the report builder catalogue
// (report_source / report_field). It never writes SQL. This route checks every source, field, operator and value
// against the catalogue the caller can read, then calls run_report() AS THE CALLER (row security and page rights apply).
// The one-line summary is written here from the numbers that came back, never by the AI.

type FieldType = 'text' | 'number' | 'money' | 'date' | 'stage';
type Source = { key: string; label: string; page_id: string; date_field: string | null; sort: number };
type Field = { source_key: string; col: string; label: string; type: FieldType; groupable: boolean; aggregatable: boolean; sort: number };
type Catalogue = { sources: Source[]; fields: Field[]; values: Record<string, { list: string[]; complete: boolean }> };
type Row = Record<string, unknown>;
type RunResult = { columns: string[]; rows: Row[] };
type Def = {
  source: string; columns?: string[]; group_by?: { field: string; bucket?: 'day' | 'week' | 'month' }[];
  measures?: { agg: 'count' | 'sum' | 'avg'; field?: string }[];
  filters: { field: string; op: 'eq' | 'in' | 'between' | 'contains'; value?: string; values?: string[]; from?: string; to?: string }[];
  sort?: { key: string; dir: 'asc' | 'desc' }; limit?: number;
};

const OPS = ['is', 'is_any_of', 'contains', 'at_least', 'at_most', 'between'] as const;
type Op = (typeof OPS)[number];
const PRESETS = ['today', 'yesterday', 'this_week', 'last_week', 'next_week', 'this_month', 'last_month', 'next_month', 'this_year', 'last_year',
  'last_7_days', 'last_30_days', 'last_90_days', 'next_7_days', 'next_30_days', 'before_today', 'custom'] as const;
type Preset = (typeof PRESETS)[number];
type ModelOut = {
  can_answer: boolean; cannot_answer_reason: string | null; source: string | null; shape: 'total' | 'breakdown' | 'list';
  fields: string[]; group_by: { field: string; bucket: 'day' | 'week' | 'month' | null }[];
  measure: { agg: 'count' | 'sum' | 'avg'; field: string | null };
  filters: { field: string; op: Op; value: string | null; values: string[]; to: string | null }[];
  period: { field: string; preset: Preset; from: string | null; to: string | null } | null;
  sort: { key: string; dir: 'asc' | 'desc' } | null; limit: number | null; summary_hint: string;
};
type ColOut = { key: string; label: string; kind: FieldType | 'count' | 'day' | 'week' | 'month' };

const MAX_ROWS = 200;
const PER_MINUTE = 10, PER_HOUR = 80;
const NOUN: Record<string, [string, string]> = {
  leads: ['lead', 'leads'], candidates: ['candidate', 'candidates'], payments: ['fee payment', 'fee payments'], placements: ['placement', 'placements'],
  calls: ['call', 'calls'], followups: ['follow-up', 'follow-ups'], attendance: ['attendance mark', 'attendance marks'], mocks: ['mock interview', 'mock interviews'],
};
const noun = (src: Source, n: number) => (NOUN[src.key] || [src.label.toLowerCase(), src.label.toLowerCase()])[n === 1 ? 0 : 1];
/** Lower-case a label for use inside a sentence, keeping short forms such as LPA. */
const lc = (s: string) => s.split(' ').map((w) => (/^[A-Z][a-z]/.test(w) ? w.toLowerCase() : w)).join(' ');
const nf = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const rupees = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const one = (s: unknown, max = 200) => { const t = scrub(String(s ?? '')).replace(/\s+/g, ' ').trim(); return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t; };

/* ---------- India-time dates ---------- */
const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const d0 = (s: string) => new Date(s + 'T00:00:00Z');
const iso = (d: Date) => d.toISOString().slice(0, 10);
const add = (s: string, days: number) => { const d = d0(s); d.setUTCDate(d.getUTCDate() + days); return iso(d); };
const monthStart = (s: string, delta = 0) => { const d = d0(s); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1))); };
const monthEnd = (s: string, delta = 0) => { const d = d0(s); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta + 1, 0))); };
const weekStart = (s: string) => add(s, -((d0(s).getUTCDay() + 6) % 7)); // Monday
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(d0(s).getTime()) && iso(d0(s)) === s;
const dmy = (s: string) => d0(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const PRESET_WORDS: Record<Preset, string> = {
  today: 'today', yesterday: 'yesterday', this_week: 'this week', last_week: 'last week', next_week: 'next week', this_month: 'this month',
  last_month: 'last month', next_month: 'next month', this_year: 'this year', last_year: 'last year', last_7_days: 'the last 7 days',
  last_30_days: 'the last 30 days', last_90_days: 'the last 90 days', next_7_days: 'the next 7 days', next_30_days: 'the next 30 days',
  before_today: 'before today', custom: '',
};

function resolvePeriod(p: Preset, from: string | null, to: string | null, today: string): { from: string | null; to: string | null } | null {
  switch (p) {
    case 'today': return { from: today, to: today };
    case 'yesterday': return { from: add(today, -1), to: add(today, -1) };
    case 'this_week': return { from: weekStart(today), to: add(weekStart(today), 6) };
    case 'last_week': return { from: add(weekStart(today), -7), to: add(weekStart(today), -1) };
    case 'next_week': return { from: add(weekStart(today), 7), to: add(weekStart(today), 13) };
    case 'this_month': return { from: monthStart(today), to: monthEnd(today) };
    case 'last_month': return { from: monthStart(today, -1), to: monthEnd(today, -1) };
    case 'next_month': return { from: monthStart(today, 1), to: monthEnd(today, 1) };
    case 'this_year': return { from: today.slice(0, 4) + '-01-01', to: today.slice(0, 4) + '-12-31' };
    case 'last_year': { const y = String(Number(today.slice(0, 4)) - 1); return { from: y + '-01-01', to: y + '-12-31' }; }
    case 'last_7_days': return { from: add(today, -6), to: today };
    case 'last_30_days': return { from: add(today, -29), to: today };
    case 'last_90_days': return { from: add(today, -89), to: today };
    case 'next_7_days': return { from: today, to: add(today, 6) };
    case 'next_30_days': return { from: today, to: add(today, 29) };
    case 'before_today': return { from: null, to: add(today, -1) };
    case 'custom': {
      const f = from && isDate(from) ? from : null, t = to && isDate(to) ? to : null;
      if ((from && !f) || (to && !t) || (!f && !t)) return null;
      return f && t && f > t ? { from: t, to: f } : { from: f, to: t };
    }
  }
}
const rangeWords = (r: { from: string | null; to: string | null }) =>
  r.from && r.to ? (r.from === r.to ? dmy(r.from) : `${dmy(r.from)} – ${dmy(r.to)}`) : r.from ? `from ${dmy(r.from)}` : `up to ${dmy(r.to!)}`;

/* ---------- catalogue (as the caller), cached briefly per person ---------- */
const cache = new Map<string, { at: number; cat: Catalogue }>();
const SAMPLE = 25;

async function loadCatalogue(caller: Awaited<ReturnType<typeof asCaller>>, staffId: string): Promise<Catalogue> {
  const hit = cache.get(staffId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.cat;
  const [s, f] = await Promise.all([
    caller.from('report_source').select('key,label,page_id,date_field,sort').order('sort'),
    caller.from('report_field').select('source_key,col,label,type,groupable,aggregatable,sort').order('sort'),
  ]);
  if (s.error || f.error) throw new Error('catalogue read' + (s.error?.code || f.error?.code ? ' (' + (s.error?.code || f.error?.code) + ')' : ''));
  const sources = (s.data || []) as Source[];
  const keys = new Set(sources.map((x) => x.key));
  const fields = ((f.data || []) as Field[]).filter((x) => keys.has(x.source_key));
  // The most common real values of each text field (as the caller sees them), so "Meta" can match "Meta lead form".
  const values: Catalogue['values'] = {};
  await Promise.all(fields.filter((x) => x.groupable && (x.type === 'text' || x.type === 'stage')).map(async (x) => {
    const r = await caller.rpc('run_report', { p_def: { source: x.source_key, group_by: [{ field: x.col }], measures: [{ agg: 'count' }], sort: { key: 'count', dir: 'desc' }, limit: SAMPLE + 1 } });
    if (r.error) return;
    const rows = ((r.data as RunResult)?.rows || []).map((row) => row[x.col]).filter((v) => v != null && v !== '').map((v) => one(v, 60));
    values[`${x.source_key}.${x.col}`] = { list: rows.slice(0, SAMPLE), complete: rows.length <= SAMPLE };
  }));
  const cat = { sources, fields, values };
  cache.set(staffId, { at: Date.now(), cat });
  if (cache.size > 2000) for (const k of cache.keys()) { cache.delete(k); if (cache.size < 1500) break; }
  return cat;
}

const OPS_FOR: Record<FieldType, Op[]> = {
  text: ['is', 'is_any_of', 'contains'], stage: ['is', 'is_any_of', 'contains'],
  number: ['is', 'at_least', 'at_most', 'between'], money: ['is', 'at_least', 'at_most', 'between'], date: ['is', 'at_least', 'at_most', 'between'],
};

function cataloguePrompt(cat: Catalogue) {
  return cat.sources.map((src) => {
    const fs = cat.fields.filter((f) => f.source_key === src.key);
    const lines = fs.map((f) => {
      const v = cat.values[`${src.key}.${f.col}`];
      const vals = v && v.list.length ? ` · ${v.complete ? 'values' : 'common values'}: ${v.list.map((x) => JSON.stringify(x)).join(', ')}` : '';
      const can = [f.groupable ? 'can split by' : '', f.aggregatable ? 'can total/average' : ''].filter(Boolean).join(', ');
      return `  - ${f.col} (${f.label}; ${f.type}${can ? '; ' + can : ''}; filters: ${OPS_FOR[f.type].join(', ')})${vals}`;
    });
    return `source "${src.key}" = ${src.label}${src.date_field ? ` (main date field: ${src.date_field})` : ''}\n${lines.join('\n')}`;
  }).join('\n\n');
}

const SYSTEM = [
  'You turn a staff member’s plain question about Stint Academy’s CRM (a training and placement institute in India) into a report request.',
  'You never write SQL and never answer with numbers yourself. You only choose a source, fields, filters, a period and a shape from the catalogue given.',
  'shape: "total" = one number (how many / how much in all); "breakdown" = counts or totals split by 1 or 2 fields (questions with "by", "each", "per", "which ... most"); "list" = rows (questions with "list", "show", "who", "which ones").',
  'fields: for "list", the 2 to 6 most useful fields to show; otherwise an empty list. group_by: for "breakdown" only, 1 or 2 fields that "can split by"; for a date field add bucket day, week or month ("by month" → month), else bucket null.',
  'measure: count unless the question asks for an amount or average; sum/avg only on a field that "can total/average" (money questions about fees → sum of amount).',
  'filters: only fields of the chosen source, only the filters listed for that field. Use the exact value from the values list when one fits (match spelling and case). If you are not sure of a name, use contains with the key word (for example "Meta" → Lead source contains "Meta"). Money and numbers as plain digits in rupees (₹10,000 → 10000; 1 lakh → 100000; "over"/"more than" → at_least). For is_any_of put the choices in values; for between put the low number in value and the high one in to. Leave values empty and to null when not used.',
  'period: when the question names a time ("today", "this week", "last month", "in September", "since 1 Oct"), set period on the date field that fits the meaning (paid on for money received, due on for money due or overdue, created on for new leads, called on for calls). Use a preset when one fits, otherwise preset custom with from/to as YYYY-MM-DD (either may be null). Weeks start on Monday. No time named → period null.',
  'Common meanings: a lead "not called yet" or "untouched" → lead stage New; "overdue fees" → payment status Overdue; "enrolments" or "joined" → candidates created on (or joined on); "absent" → attendance mark A.',
  'sort: key must be one of the output columns (a group field, "count", "sum_<field>", "avg_<field>", or a list field) with dir; null for the natural order. limit: only when the question asks for a number of rows ("top 5"), else null.',
  'can_answer false (with a short plain reason, no technical words) when the question needs data not in the catalogue, asks for phone numbers, emails or other private details, or asks to change data. Otherwise can_answer true and cannot_answer_reason null.',
  'summary_hint: a short title for the answer, 3 to 8 words, no numbers you have not been given.',
].join('\n');

function schemaFor(cat: Catalogue) {
  const keys = cat.sources.map((s) => s.key);
  const cols = [...new Set(cat.fields.map((f) => f.col))];
  const dateCols = [...new Set(cat.fields.filter((f) => f.type === 'date').map((f) => f.col))];
  const aggCols = [...new Set(cat.fields.filter((f) => f.aggregatable).map((f) => f.col))];
  const colEnum = { type: 'string', enum: cols };
  return obj({
    can_answer: { type: 'boolean' },
    cannot_answer_reason: strOrNull,
    source: oneOfOrNull(keys),
    shape: { type: 'string', enum: ['total', 'breakdown', 'list'] },
    fields: { type: 'array', items: colEnum },
    group_by: { type: 'array', items: obj({ field: colEnum, bucket: oneOfOrNull(['day', 'week', 'month']) }) },
    measure: obj({ agg: { type: 'string', enum: ['count', 'sum', 'avg'] }, field: oneOfOrNull(aggCols) }),
    filters: { type: 'array', items: obj({ field: colEnum, op: { type: 'string', enum: [...OPS] }, value: strOrNull, values: { type: 'array', items: str }, to: strOrNull }) },
    period: { anyOf: [{ type: 'null' }, obj({ field: { type: 'string', enum: dateCols.length ? dateCols : ['none'] }, preset: { type: 'string', enum: [...PRESETS] }, from: strOrNull, to: strOrNull })] },
    sort: { anyOf: [{ type: 'null' }, obj({ key: str, dir: { type: 'string', enum: ['asc', 'desc'] } })] },
    limit: { type: ['integer', 'null'] },
    summary_hint: str,
  });
}

/* ---------- checking the model's request ---------- */
class Reject extends Error {}
const num = (v: unknown) => { const n = Number(String(v ?? '').replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '')); return Number.isFinite(n) ? n : null; };

function check(out: ModelOut, cat: Catalogue, today: string) {
  const src = cat.sources.find((s) => s.key === out.source);
  if (!src) throw new Reject('source');
  const fs = cat.fields.filter((f) => f.source_key === src.key);
  const field = (col: string) => { const f = fs.find((x) => x.col === col); if (!f) throw new Reject('field'); return f; };
  const valueWords = (f: Field, v: string) => (f.type === 'money' ? rupees(Number(v)) : f.type === 'date' ? dmy(v) : f.type === 'number' ? nf(Number(v)) : `“${v}”`);
  const canon = (f: Field, v: string) => {
    const list = cat.values[`${src.key}.${f.col}`]?.list || [];
    return list.find((x) => x.toLowerCase() === v.toLowerCase()) ?? v;
  };
  const scalar = (f: Field, v: unknown): string => {
    if (f.type === 'money' || f.type === 'number') { const n = num(v); if (n === null) throw new Reject('number'); return String(n); }
    if (f.type === 'date') { if (!isDate(v)) throw new Reject('date'); return v; }
    const t = one(v, 80); if (!t) throw new Reject('empty value'); return canon(f, t);
  };

  const filters: Def['filters'] = [];
  const words: string[] = [];
  for (const x of (out.filters || []).slice(0, 10)) {
    const f = field(x.field);
    if (!OPS_FOR[f.type].includes(x.op)) throw new Reject('op');
    if (x.op === 'is') {
      const v = scalar(f, x.value);
      const known = cat.values[`${src.key}.${f.col}`];
      // a name that is not one of the (complete) real values, but is part of one: match on the part, and say so
      if ((f.type === 'text' || f.type === 'stage') && known?.complete && !known.list.includes(v) && known.list.some((k) => k.toLowerCase().includes(v.toLowerCase()))) {
        filters.push({ field: f.col, op: 'contains', value: v }); words.push(`${f.label} contains “${v}”`);
      } else { filters.push({ field: f.col, op: 'eq', value: v }); words.push(`${f.label} is ${valueWords(f, v)}`); }
    } else if (x.op === 'is_any_of') {
      const vs = [...new Set((x.values || []).slice(0, 20).map((v) => scalar(f, v)))];
      if (!vs.length) throw new Reject('values');
      filters.push({ field: f.col, op: 'in', values: vs });
      words.push(vs.length === 1 ? `${f.label} is “${vs[0]}”` : `${f.label} is one of ${vs.map((v) => `“${v}”`).join(', ')}`);
    } else if (x.op === 'contains') {
      const v = one(x.value, 80); if (!v) throw new Reject('empty value');
      filters.push({ field: f.col, op: 'contains', value: v }); words.push(`${f.label} contains “${v}”`);
    } else if (x.op === 'at_least') {
      const v = scalar(f, x.value); filters.push({ field: f.col, op: 'between', from: v }); words.push(`${f.label} ${f.type === 'date' ? 'on or after' : 'at least'} ${valueWords(f, v)}`);
    } else if (x.op === 'at_most') {
      const v = scalar(f, x.value); filters.push({ field: f.col, op: 'between', to: v }); words.push(`${f.label} ${f.type === 'date' ? 'on or before' : 'at most'} ${valueWords(f, v)}`);
    } else {
      let a = scalar(f, x.value), b = scalar(f, x.to);
      if ((f.type === 'date' ? a > b : Number(a) > Number(b))) [a, b] = [b, a];
      filters.push({ field: f.col, op: 'between', from: a, to: b }); words.push(`${f.label} from ${valueWords(f, a)} to ${valueWords(f, b)}`);
    }
  }

  let period: { field: string; label: string; from: string | null; to: string | null; words: string } | null = null;
  if (out.period) {
    const f = field(out.period.field);
    if (f.type !== 'date') throw new Reject('period field');
    const r = resolvePeriod(out.period.preset, out.period.from, out.period.to, today);
    if (!r) throw new Reject('period');
    const w = out.period.preset === 'custom' ? rangeWords(r) : `${PRESET_WORDS[out.period.preset]} (${rangeWords(r)})`;
    period = { field: f.col, label: f.label, ...r, words: `${f.label}: ${w}` };
    filters.push({ field: f.col, op: 'between', ...(r.from ? { from: r.from } : {}), ...(r.to ? { to: r.to } : {}) });
    words.push(period.words);
  }

  const groups = out.shape === 'breakdown' ? (out.group_by || []).slice(0, 2).map((g) => {
    const f = field(g.field); if (!f.groupable) throw new Reject('group');
    return { f, bucket: f.type === 'date' ? (g.bucket || 'month') : undefined };
  }) : [];
  if (groups.length === 2 && groups[0].f.col === groups[1].f.col) groups.pop();
  const shape = out.shape === 'breakdown' && !groups.length ? 'total' : out.shape;

  let measure: { agg: 'count' | 'sum' | 'avg'; f: Field | null } = { agg: 'count', f: null };
  if (out.measure?.agg === 'sum' || out.measure?.agg === 'avg') {
    const f = out.measure.field ? fs.find((x) => x.col === out.measure.field && x.aggregatable) : null;
    if (!f) throw new Reject('measure');
    measure = { agg: out.measure.agg, f };
  }

  let columns = shape === 'list' ? [...new Set((out.fields || []).map((c) => field(c).col))].slice(0, 8) : [];
  if (shape === 'list' && !columns.length) columns = fs.slice(0, 4).map((f) => f.col);
  const limit = out.limit && out.limit > 0 ? Math.min(Math.round(out.limit), MAX_ROWS) : null;
  return { src, fs, shape: shape as ModelOut['shape'], filters, words, period, groups, measure, columns, limit, sort: out.sort };
}

/* ---------- the answer ---------- */
type Checked = ReturnType<typeof check>;

function splitField(c: Checked) {
  return c.fs.find((f) => f.groupable && f.type === 'stage') || c.fs.find((f) => f.groupable && f.type !== 'date') || c.fs.find((f) => f.groupable)!;
}
const alias = (m: Checked['measure']) => (m.f ? `${m.agg}_${m.f.col}` : 'count');
const sumOf = (rows: Row[], key: string) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);

function colsFor(c: Checked, keys: string[], buckets: Record<string, 'day' | 'week' | 'month'>): ColOut[] {
  return keys.map((k) => {
    if (k === 'count') return { key: k, label: c.shape === 'list' ? 'Count' : `Number of ${noun(c.src, 2)}`, kind: 'count' };
    const m = k.match(/^(sum|avg)_(.+)$/);
    if (m) { const f = c.fs.find((x) => x.col === m[2]); return { key: k, label: `${m[1] === 'sum' ? 'Total' : 'Average'} ${lc(f?.label || m[2])}`, kind: f?.type === 'money' ? 'money' : 'number' }; }
    const f = c.fs.find((x) => x.col === k);
    return { key: k, label: f?.label || k, kind: buckets[k] || f?.type || 'text' };
  });
}

const bucketWords = (v: unknown, b?: 'day' | 'week' | 'month') => {
  if (!isDate(v)) return v == null || v === '' ? '(blank)' : String(v);
  if (b === 'month') return d0(v).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (b === 'week') return `week of ${dmy(v)}`;
  return dmy(v);
};
const measureWords = (m: Checked['measure'], v: number) => (m.f ? (m.f.type === 'money' ? rupees(v) : nf(v)) : nf(v));

async function run(caller: Awaited<ReturnType<typeof asCaller>>, def: Def): Promise<RunResult> {
  const r = await caller.rpc('run_report', { p_def: def });
  if (r.error) throw Object.assign(new Error('run_report'), { code: r.error.code });
  return r.data as RunResult;
}

async function answer(caller: Awaited<ReturnType<typeof asCaller>>, c: Checked) {
  const many = (n: number) => `${nf(n)} ${noun(c.src, n)}`;
  const split = splitField(c);
  const moneyCol = c.measure.f?.type === 'money' ? c.measure.f : c.shape === 'list' ? c.fs.find((f) => f.type === 'money' && f.aggregatable && c.columns.includes(f.col)) || null : null;
  // Exact totals for every shape: grouped by one low-variety field, so the reply stays small; counts are added up here.
  const totalsDef: Def = {
    source: c.src.key, filters: c.filters, limit: 5000, group_by: [{ field: split.col }],
    measures: [{ agg: 'count' }, ...(moneyCol ? [{ agg: 'sum' as const, field: moneyCol.col }] : [])],
  };

  if (c.shape === 'breakdown') {
    const buckets: Record<string, 'day' | 'week' | 'month'> = {};
    c.groups.forEach((g) => { if (g.bucket) buckets[g.f.col] = g.bucket; });
    const key = alias(c.measure);
    const outs = [...c.groups.map((g) => g.f.col), 'count', ...(c.measure.f ? [key] : [])];
    const sort = c.sort && outs.includes(c.sort.key) ? c.sort
      : c.groups[0].bucket ? { key: c.groups[0].f.col, dir: 'asc' as const } : { key, dir: 'desc' as const };
    const def: Def = {
      source: c.src.key, filters: c.filters, sort, limit: 5000,
      group_by: c.groups.map((g) => ({ field: g.f.col, ...(g.bucket ? { bucket: g.bucket } : {}) })),
      measures: [{ agg: 'count' }, ...(c.measure.f ? [{ agg: c.measure.agg, field: c.measure.f.col }] : [])],
    };
    const res = await run(caller, def);
    const all = res.rows, total = sumOf(all, 'count');
    const shown = all.slice(0, c.limit || MAX_ROWS);
    let summary: string;
    if (!total) summary = `No ${noun(c.src, 2)} match.`;
    else {
      const top = [...all].sort((a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0))[0];
      const gw = (g: Checked['groups'][number]) => (g.bucket ? `${g.bucket} (${lc(g.f.label)})` : lc(g.f.label));
      const what = c.groups.map(gw).join(' and ');
      const topName = c.groups.map((g) => bucketWords(top[g.f.col], g.bucket)).join(' · ');
      const head = c.measure.agg === 'sum' && c.measure.f ? `${measureWords(c.measure, sumOf(all, key))} in total from ${many(total)}` : many(total);
      const topVal = c.measure.f ? `${c.measure.agg === 'avg' ? 'average ' : ''}${measureWords(c.measure, Number(top[key]) || 0)}` : nf(Number(top.count) || 0);
      summary = `${head}, split by ${what} into ${nf(all.length)} group${all.length === 1 ? '' : 's'}; the ${c.measure.agg === 'avg' ? 'highest' : 'most'} is ${topName} (${topVal}).`;
      if (all.length > shown.length) summary += ` Showing the first ${shown.length}.`;
    }
    return { columns: colsFor(c, res.columns, buckets), rows: shown, total, summary, def: { ...def, limit: 500 }, mode: 'summary' as const };
  }

  if (c.shape === 'list') {
    const def: Def = { source: c.src.key, filters: c.filters, columns: c.columns, limit: c.limit || MAX_ROWS };
    const dateCol = c.period?.field && c.columns.includes(c.period.field) ? c.period.field : c.src.date_field && c.columns.includes(c.src.date_field) ? c.src.date_field : null;
    def.sort = c.sort && c.columns.includes(c.sort.key) ? c.sort : dateCol ? { key: dateCol, dir: 'desc' } : undefined;
    const [res, tot] = await Promise.all([run(caller, def), run(caller, totalsDef)]);
    const total = sumOf(tot.rows, 'count');
    let summary = !total ? `No ${noun(c.src, 2)} match.` : `${many(total)} match${total === 1 ? 'es' : ''}`;
    if (total && moneyCol) summary += `, ${rupees(sumOf(tot.rows, `sum_${moneyCol.col}`))} in total`;
    if (total) summary += '.';
    if (total > res.rows.length) summary += ` Showing the first ${nf(res.rows.length)}.`;
    return { columns: colsFor(c, res.columns, {}), rows: res.rows, total, summary, def: { ...def, limit: 500 }, mode: 'list' as const };
  }

  // total: one number, with the split shown as the table
  const def: Def = { ...totalsDef, measures: [{ agg: 'count' }, ...(c.measure.f ? [{ agg: c.measure.agg, field: c.measure.f.col }] : [])], sort: { key: 'count', dir: 'desc' } };
  const res = await run(caller, def);
  const total = sumOf(res.rows, 'count');
  let summary: string;
  if (!total) summary = `No ${noun(c.src, 2)} match.`;
  else if (c.measure.agg === 'sum' && c.measure.f) summary = `${measureWords(c.measure, sumOf(res.rows, alias(c.measure)))} in total from ${many(total)}.`;
  else if (c.measure.agg === 'avg' && c.measure.f) {
    // exact average over the rows that have a value (up to 5,000 rows)
    const vals = await run(caller, { source: c.src.key, filters: c.filters, columns: [c.measure.f.col], limit: 5000 });
    const nums = vals.rows.map((r) => r[c.measure.f!.col]).filter((v) => v != null && v !== '').map(Number).filter(Number.isFinite);
    summary = nums.length
      ? `Average ${lc(c.measure.f.label)} is ${measureWords(c.measure, nums.reduce((a, b) => a + b, 0) / nums.length)}, from ${nf(nums.length)} of ${many(total)} that have one${vals.rows.length >= 5000 ? ' (first 5,000 only)' : ''}.`
      : `None of the ${many(total)} have a ${lc(c.measure.f.label)} yet.`;
  } else summary = `${many(total)}.`;
  if (total) summary += ` Split by ${lc(split.label)} below.`;
  return { columns: colsFor(c, res.columns, {}), rows: res.rows.slice(0, MAX_ROWS), total, summary, def: { ...def, limit: 500 }, mode: 'summary' as const };
}

/* ---------- route ---------- */
export async function POST(request: Request) {
  const bad = crossSite(request); if (bad) return bad;
  const caller = await asCaller();
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const { data: staff } = await service().from('staff').select('id').eq('id', user.id).eq('status', 'Active').maybeSingle();
  if (!staff) return NextResponse.json({ error: 'Only active staff can ask questions here.' }, { status: 403 });
  const { data: canAsk } = await caller.rpc('can_page', { p: 'ask', need: 'r' });
  if (canAsk !== true) return NextResponse.json({ error: 'Ask the CRM isn’t open to your role.' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { question?: unknown };
  const question = one(body?.question, 300);
  if (question.length < 3) return NextResponse.json({ error: 'Type a question first.' }, { status: 400 });
  if (limited('ask:' + user.id, PER_MINUTE) || limited('ask-h:' + user.id, PER_HOUR, 3_600_000))
    return NextResponse.json({ error: 'You have asked a lot of questions in a short time. Please wait a minute and try again.' }, { status: 429 });

  const log = (spec: unknown, ok: boolean) => service().from('ask_log').insert({ staff_id: user.id, question, spec, ok })
    .then(({ error }) => { if (error) console.error('ask_log insert failed', error.code || ''); });

  let cat: Catalogue;
  try { cat = await loadCatalogue(caller, user.id); }
  catch (e) { console.error('ai/ask: ' + (e instanceof Error ? e.message : 'catalogue')); return NextResponse.json({ error: 'Could not get ready to answer. Please try again.' }, { status: 502 }); }
  if (!cat.sources.length) return NextResponse.json({ error: 'There is nothing your role can report on yet. Ask the admin.' }, { status: 403 });

  const today = istToday();
  const can = cat.sources.map((s) => s.label.toLowerCase()).join(', ');
  const prompt = `Today in India is ${today} (${d0(today).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' })}).\n\nCatalogue (only these sources and fields exist for this person):\n\n${cataloguePrompt(cat)}\n\nQuestion: ${question}`;

  let out: ModelOut;
  try {
    out = await askJson<ModelOut>({ feature: 'ask_crm', staffId: user.id, model: MODEL_FAST, system: SYSTEM, prompt, schema: schemaFor(cat), maxTokens: 1500, effort: 'low' });
  } catch (e) {
    if (e instanceof SafeError) return NextResponse.json({ error: e.message }, { status: 502 });
    console.error('ai/ask: model call failed');
    return NextResponse.json({ error: 'Could not read the question. Please try again.' }, { status: 502 });
  }

  const cannot = (why: string | null) => {
    void log({ cannot: true }, false);
    const reason = why ? one(why, 160).replace(/\.?$/, '.') + ' ' : '';
    return NextResponse.json({ cannot: true, message: `${reason}I can count, split and list ${can}. Try one of the suggestions below.` });
  };
  if (!out || !out.can_answer || !out.source) return cannot(out?.cannot_answer_reason ?? null);

  let checked: Checked;
  try { checked = check(out, cat, today); }
  catch (e) {
    console.error('ai/ask: request rejected: ' + (e instanceof Reject ? e.message : 'unknown'));
    return cannot('I couldn’t turn that into a report.');
  }

  try {
    const a = await answer(caller, checked);
    void log(a.def, true);
    return NextResponse.json({
      title: one(out.summary_hint, 80) || 'Answer',
      summary: a.summary, total: a.total, columns: a.columns, rows: a.rows,
      counted: { source: checked.src.label, filters: checked.words },
      spec: { ...a.def, mode: a.mode },
    });
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
    console.error('ai/ask: run failed' + (code ? ' (' + code + ')' : ''));
    void log(null, false);
    if (code === '42501') return NextResponse.json({ error: 'That information isn’t open to your role.' }, { status: 403 });
    return NextResponse.json({ error: 'I couldn’t run that question. Try asking it another way.' }, { status: 422 });
  }
}
