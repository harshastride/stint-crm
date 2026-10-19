'use client';
import { plainMessage } from '@/lib/plainMessage';
import { friendlyError } from '@/components/Fields';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Download, MessageCircleQuestion, Save, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { PageHeader } from '../kit/PageHeader';
import { EmptyState } from '../kit/EmptyState';
import { Table, THead, TBody, Th, Td, Tr } from '../kit/Table';
import { VoiceInput } from '../kit/VoiceInput';
import { Button, Notice, Pill, cx, fmtDate, money } from '../ui';

// Ask the CRM: one plain question → one sentence and a table. The question is turned into a report request on the
// server (/api/ai/ask), checked against the report builder catalogue and run as the signed-in person, so only rows
// their role can see are counted. The sentence is written from the real numbers, not by the AI.

type Kind = 'text' | 'number' | 'money' | 'date' | 'stage' | 'count' | 'day' | 'week' | 'month';
type Col = { key: string; label: string; kind: Kind };
type Answer = {
  question: string; title: string; summary: string; total: number; columns: Col[]; rows: Record<string, unknown>[];
  counted: { source: string; filters: string[] }; spec: Record<string, unknown> & { mode: 'summary' | 'list' };
};
type Problem = { tone: 'warn' | 'bad'; message: string } | null;

const HANDOFF = 'stint-ask-question';
const RECENT = 'stint-ask-recent';
const MAX_LEN = 300;

// Suggestions by the page each one needs; shown in the order that suits the person's role.
const SUGGEST: { page: string; q: string }[] = [
  { page: 'lead', q: 'Meta leads last month still at New' },
  { page: 'lead', q: 'New leads this week by source' },
  { page: 'lead', q: 'Leads by owner and stage' },
  { page: 'payment', q: 'Fees overdue over ₹10,000' },
  { page: 'payment', q: 'Fees received this month by payment mode' },
  { page: 'payment', q: 'Fees due in the next 7 days' },
  { page: 'candidate', q: 'Enrolments by course this month' },
  { page: 'candidate', q: 'Candidates by stage' },
  { page: 'call', q: 'Calls today by outcome' },
  { page: 'call', q: 'Calls by caller this week' },
  { page: 'followups', q: 'Open follow-ups by owner' },
  { page: 'placement', q: 'Placements this year by company' },
  { page: 'placement', q: 'Average salary by course' },
  { page: 'attendance', q: 'Absent marks this week by batch' },
  { page: 'mock', q: 'Mock interviews this month by status' },
];
const ROLE_FIRST: Record<string, string[]> = {
  Telecaller: ['lead', 'call', 'followups'], Sales: ['lead', 'payment', 'call', 'candidate'], Finance: ['payment', 'candidate'],
  'Front desk': ['lead', 'candidate'], Marketing: ['lead'], 'HR / Counsellor': ['candidate', 'mock', 'placement'],
  Trainer: ['attendance', 'mock'], SME: ['mock'], Placement: ['placement', 'candidate'],
};

const readRecent = (): string[] => { try { const v = JSON.parse(localStorage.getItem(RECENT) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 5) : []; } catch { return []; } };
const saveRecent = (q: string) => { try { localStorage.setItem(RECENT, JSON.stringify([q, ...readRecent().filter((x) => x !== q)].slice(0, 5))); } catch { /* private window */ } };

const cell = (c: Col, v: unknown) => {
  if (v == null || v === '') return '—';
  if (c.kind === 'money') return money(v);
  if (c.kind === 'month') return new Date(String(v)).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (c.kind === 'week') return 'Week of ' + fmtDate(v);
  if (c.kind === 'date' || c.kind === 'day') return fmtDate(v);
  if (c.kind === 'count' || c.kind === 'number') return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return String(v);
};
const numeric = (k: Kind) => k === 'count' || k === 'number' || k === 'money';

export function AskCrm() {
  const s = useSession();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [problem, setProblem] = useState<Problem>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'done'>('idle');
  const [saveErr, setSaveErr] = useState('');
  const inFlight = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  const order = ROLE_FIRST[s.staff.role] || [];
  const chips = SUGGEST.filter((x) => s.can(x.page))
    .sort((a, b) => (order.indexOf(a.page) + 1 || 99) - (order.indexOf(b.page) + 1 || 99)).slice(0, 6);

  const ask = useCallback(async (text: string) => {
    const question = text.trim().slice(0, MAX_LEN);
    if (question.length < 3 || inFlight.current) return;
    inFlight.current = true; setBusy(true); setProblem(null); setSaved('idle'); setSaveErr('');
    try {
      const r = await fetch('/api/ai/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.cannot) { setAnswer(null); setProblem({ tone: 'warn', message: plainMessage(j.message, 'I can’t answer that one yet. Try one of the suggestions.') }); }
      else if (r.ok && Array.isArray(j.rows)) { setAnswer({ ...(j as Omit<Answer, 'question'>), question }); saveRecent(question); setRecent(readRecent()); }
      else setProblem({ tone: r.status === 503 || r.status === 429 ? 'warn' : 'bad', message: plainMessage(j.error, 'Could not answer that. Please try again.') });
    } catch {
      setProblem({ tone: 'bad', message: 'Couldn’t reach the server. Check the internet and try again.' });
    } finally { inFlight.current = false; setBusy(false); }
  }, []);

  // A question handed over from the Dashboard box (kept in this tab only, never in the address bar).
  useEffect(() => {
    setRecent(readRecent());
    try {
      const h = sessionStorage.getItem(HANDOFF);
      if (h) { sessionStorage.removeItem(HANDOFF); setQ(h); ask(h); }
    } catch { /* storage off */ }
  }, [ask]);

  const submit = (e: FormEvent) => { e.preventDefault(); ask(q); };
  const pick = (text: string) => { setQ(text); ask(text); };

  const csv = () => {
    if (!answer) return;
    const esc = (v: unknown) => { let t = v == null ? '' : String(v); if (/^[=+\-@]/.test(t)) t = "'" + t; return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const text = [answer.columns.map((c) => esc(c.label)).join(','), ...answer.rows.map((r) => answer.columns.map((c) => esc(r[c.key])).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = (answer.title || 'answer').replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 60) + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Keep the answer as a saved report (Report builder rules apply: row security, the person's own report).
  const saveReport = async () => {
    if (!answer || saved !== 'idle') return;
    setSaved('saving'); setSaveErr('');
    const { error } = await supabase().from('saved_report').insert({ name: (answer.title || answer.question).slice(0, 120), def: answer.spec, shared_with_roles: [] });
    if (error) { setSaved('idle'); setSaveErr(friendlyError(error, 'saved reports', 'Could not save the report. Please try again.')); return; }
    setSaved('done');
  };

  const shownAll = answer ? answer.rows.length : 0;
  const isList = answer?.spec.mode === 'list';

  return (
    <main className="flex min-w-0 flex-col gap-4 p-page-sm md:p-page">
      <PageHeader group="Reports" title="Ask the CRM" description="Ask a question in plain words and get a table with one line of answer. Only rows your role can see are counted." />

      <section aria-label="Your question" className="flex flex-col gap-3 rounded-card bg-surface p-card shadow-1">
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor="ask-q" className="sr-only">Your question</label>
          <div className="relative min-w-0 flex-1">
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input id="ask-q" ref={input} value={q} maxLength={MAX_LEN} onChange={(e) => setQ(e.target.value)} autoComplete="off" enterKeyHint="search"
              placeholder="For example: fees overdue over ₹10,000"
              className="h-11 w-full rounded-[10px] border border-line2 bg-surface pl-9 pr-3 text-[14px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accentSoft" />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" size="lg" loading={busy} disabled={q.trim().length < 3} className="max-sm:flex-1">Ask</Button>
          </div>
        </form>
        <VoiceInput context="field" label="Speak your question" disabled={busy} onText={(t) => { setQ(t.slice(0, MAX_LEN)); input.current?.focus(); }} />
        {chips.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Try</span>
            <div className="flex flex-wrap gap-2">
              {chips.map((c) => (
                <button key={c.q} type="button" disabled={busy} onClick={() => pick(c.q)}
                  className="min-h-[44px] rounded-full border border-line2 bg-surface px-3.5 text-[13px] text-text2 hover:bg-surface2 hover:text-text disabled:opacity-50 md:min-h-9">{c.q}</button>
              ))}
            </div>
          </div>
        )}
        {recent.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Asked before on this device</span>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {recent.map((r) => (
                <button key={r} type="button" disabled={busy} onClick={() => pick(r)}
                  className="min-h-[44px] max-w-full truncate rounded-lg px-1 text-left text-[13px] text-accentText underline-offset-2 hover:underline disabled:opacity-50 md:min-h-9">{r}</button>
              ))}
            </div>
          </div>
        )}
      </section>

      <div aria-live="polite" className="flex flex-col gap-3">
        {busy && (
          <div className="rounded-card bg-surface p-card shadow-1" data-testid="ask-working">
            <p className="text-[13.5px] text-text2">Reading your question and counting…</p>
            <div className="mt-3 flex flex-col gap-2" aria-hidden>
              <div className="h-4 w-2/3 animate-pulse rounded bg-surface2" />
              <div className="h-24 w-full animate-pulse rounded bg-surface2" />
            </div>
          </div>
        )}

        {!busy && problem && <Notice tone={problem.tone}>{problem.message}</Notice>}

        {!busy && answer && (
          <article aria-label="Answer" className="flex min-w-0 flex-col gap-3 rounded-card bg-surface p-card shadow-1" data-testid="ask-answer">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-muted">{answer.title}</div>
                <p className="mt-1 text-[16px] font-semibold leading-snug" data-testid="ask-summary">{answer.summary}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="lg" className="md:h-9" leftIcon={<Download size={16} />} onClick={csv} disabled={!answer.rows.length}>Download CSV</Button>
                {s.can('reports_builder') && (saved === 'done'
                  ? <Link href="/p/reports_builder" className="inline-flex h-11 items-center gap-1.5 rounded-[10px] px-3 text-[13.5px] font-medium text-accentText underline-offset-4 hover:underline md:h-9"><Check size={16} aria-hidden />Saved · open Report builder</Link>
                  : <Button variant="outline" size="lg" className="md:h-9" leftIcon={<Save size={16} />} loading={saved === 'saving'} onClick={saveReport}>Save to Report builder</Button>)}
              </div>
            </div>
            {saveErr && <Notice tone="bad">{saveErr}</Notice>}

            <p className="text-[12.5px] leading-5 text-text2" data-testid="ask-counted">
              <span className="font-medium text-text">What I counted: </span>
              {[answer.counted.source, ...answer.counted.filters].join(' · ')}{answer.counted.filters.length ? '' : ' · everything'}. Only rows your role can see. Dates are India time.
              {' '}If this is not what you meant, ask again in other words.
            </p>

            {answer.rows.length > 0 ? (
              <>
                <Table label={answer.title} className="max-h-[60dvh]">
                  <THead>{answer.columns.map((c) => <Th key={c.key} numeric={numeric(c.kind)}>{c.label}</Th>)}</THead>
                  <TBody>
                    {answer.rows.map((r, i) => (
                      <Tr key={i}>
                        {answer.columns.map((c) => (
                          <Td key={c.key} numeric={numeric(c.kind)}>{c.kind === 'stage' && r[c.key] != null ? <Pill>{String(r[c.key])}</Pill> : cell(c, r[c.key])}</Td>
                        ))}
                      </Tr>
                    ))}
                  </TBody>
                </Table>
                <p className="text-xs text-muted">
                  {isList
                    ? `${shownAll.toLocaleString('en-IN')} of ${answer.total.toLocaleString('en-IN')} row${answer.total === 1 ? '' : 's'} shown.`
                    : `${shownAll.toLocaleString('en-IN')} group${shownAll === 1 ? '' : 's'} shown, ${answer.total.toLocaleString('en-IN')} row${answer.total === 1 ? '' : 's'} counted.`}
                  {' '}The CSV has the rows shown here.
                </p>
              </>
            ) : (
              <EmptyState kind="search" title="Nothing matches" body="Zero rows match these filters. Try a longer period or fewer conditions." />
            )}
          </article>
        )}

        {!busy && !answer && !problem && (
          <div className="flex items-start gap-3 px-1 text-[13px] text-text2">
            <MessageCircleQuestion size={18} aria-hidden className="mt-0.5 shrink-0 text-accentText" />
            <p>Ask about counts, totals and lists — for example “how many”, “by course”, “last month”, “over ₹10,000”. You get the numbers straight from the CRM, with a line that says exactly what was counted.</p>
          </div>
        )}
      </div>
    </main>
  );
}

/** Small question box for the Dashboard: hands the question to the Ask the CRM page (kept in this tab only). */
export function AskBox({ className }: { className?: string }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const go = (e: FormEvent) => {
    e.preventDefault();
    const t = q.trim().slice(0, MAX_LEN);
    if (t.length < 3) return;
    try { sessionStorage.setItem(HANDOFF, t); } catch { /* storage off: the page opens empty */ }
    router.push('/p/ask');
  };
  return (
    <form onSubmit={go} role="search" aria-label="Ask the CRM" className={cx('flex items-center gap-2', className)}>
      <label htmlFor="ask-box" className="sr-only">Ask the CRM a question</label>
      <div className="relative min-w-0 flex-1">
        <MessageCircleQuestion size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input id="ask-box" value={q} maxLength={MAX_LEN} onChange={(e) => setQ(e.target.value)} autoComplete="off" enterKeyHint="search"
          placeholder="Ask the CRM: e.g. enrolments by course this month"
          className="h-11 w-full rounded-[10px] border border-line2 bg-surface pl-9 pr-3 text-[13.5px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accentSoft md:h-9" />
      </div>
      <Button type="submit" variant="outline" size="lg" className="md:h-9" disabled={q.trim().length < 3}>Ask</Button>
    </form>
  );
}
