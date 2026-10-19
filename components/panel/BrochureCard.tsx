'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, ExternalLink, FileText, MessageCircle, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { plainMessage } from '@/lib/plainMessage';
import type { Row } from '@/lib/pages';
import { Button, cx } from '../ui';
import { CardRow, Chip, RailCard } from './RailCard';

// Brochure line in the lead panel: send a course brochure as a private link, and see who opened it, how long, and
// whether they are reading it right now (a view in the last 2 minutes). Hidden for roles without the Brochures page.

const IST = 'Asia/Kolkata';
const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: IST });
/** "10:42 am" today, else "12 Oct, 10:42 am" (India time). */
export function istWhen(v: unknown) {
  if (!v) return '—';
  const d = new Date(String(v));
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: IST });
  return dayKey(d) === dayKey(new Date()) ? time : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: IST }) + ', ' + time;
}
/** Reading time from seconds: "under 1 min", "4 min". */
export const readTime = (s: unknown) => { const n = Number(s || 0); return n <= 0 ? '0 min' : n < 60 ? 'under 1 min' : Math.round(n / 60) + ' min'; };
/** "Opened 2× · 4 min · last 10:42 am", or "Not opened yet". */
export const openedLine = (r: Row) => (Number(r.open_count) > 0 ? `Opened ${r.open_count}× · ${readTime(r.total_seconds)} · last ${istWhen(r.last_opened_at)}` : 'Not opened yet');

const field = 'h-11 w-full min-w-0 rounded-[10px] border border-line2 bg-surface px-2.5 text-[13px] text-text md:h-9';
const rowBtn = 'btn inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-text2 hover:bg-surface2 hover:text-text';

type Result = { url: string; whatsappText: string; intro: { greeting: string; why: string[]; answers: { q: string; a: string }[]; next_step: string; by: string } };

export function BrochureCard({ leadId, programId, open, onToggle }: { leadId: string; programId?: string | null; open: boolean; onToggle: (id: string) => void }) {
  const s = useSession();
  const allowed = s.can('brochures');
  const [brochures, setBrochures] = useState<Row[]>([]);
  const [sends, setSends] = useState<Row[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => { setSends([]); setResult(null); setErr(''); setState('loading'); }, [leadId]);

  useEffect(() => {
    if (!allowed) return;
    let stale = false;
    const db = supabase();
    Promise.all([
      db.from('brochure').select('id, title, program_id, file_path').eq('status', 'Live').not('file_path', 'is', null).order('title'),
      db.from('brochure_send_list').select('id, token, brochure_title, sent_at, sent_by_name, open_count, total_seconds, last_opened_at, pages_seen, reading_now')
        .eq('lead_id', leadId).order('sent_at', { ascending: false }).limit(10),
    ]).then(([b, x]) => {
      if (stale) return;
      if (b.error || x.error) { setState('error'); return; }
      setBrochures(b.data || []); setSends(x.data || []); setState('ready');
    }, () => { if (!stale) setState('error'); });
    return () => { stale = true; };
  }, [allowed, leadId, tick]);

  // while there are sends, check every 30 s (only with the tab visible) so "Reading now" stays true
  useEffect(() => {
    if (!allowed || sends.length === 0) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') setTick((n) => n + 1); }, 30_000);
    return () => clearInterval(t);
  }, [allowed, sends.length]);

  // this course's brochure first, then the ones for every course, then the rest
  const ordered = useMemo(() => [...brochures].sort((a, b) => {
    const rank = (r: Row) => (programId && r.program_id === programId ? 0 : !r.program_id ? 1 : 2);
    return rank(a) - rank(b) || String(a.title).localeCompare(String(b.title));
  }), [brochures, programId]);
  useEffect(() => { if (!ordered.some((b) => b.id === pick)) setPick(ordered[0]?.id || ''); }, [ordered, pick]);

  const send = async () => {
    if (!pick || busy) return;
    setBusy(true); setErr(''); setResult(null);
    try {
      const r = await fetch('/api/brochures/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lead_id: leadId, brochure_id: pick }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(plainMessage(j.error, 'Couldn’t make the link. Please try again.')); return; }
      setResult(j as Result); setTick((n) => n + 1);
    } catch (e) {
      setErr(plainMessage(e instanceof Error ? e.message : '', 'Couldn’t make the link. Please try again.'));
    } finally { setBusy(false); }
  };

  const copy = async (what: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 2000); }
    catch { setErr('Copying is blocked in this browser. Select the link and copy it by hand.'); }
  };

  if (!allowed) return null;
  const reading = sends.find((x) => x.reading_now);
  const last = sends[0];
  const summary = state === 'loading' ? <span className="t text-muted">Loading…</span>
    : state === 'error' ? <span className="t text-muted">Could not load</span>
    : reading ? <><Chip tone="good">Reading now</Chip></>
    : last ? <span className="t">{Number(last.open_count) > 0 ? `Opened ${last.open_count}× · last ${istWhen(last.last_opened_at)}` : 'Sent, not opened yet'}</span>
    : <span className="t text-muted">Not sent</span>;

  return (
    <RailCard id="brochure" label="Brochure" testId="card-brochure" open={open} onToggle={onToggle} summary={summary}>
      {state === 'error' ? (
        <div>
          <p className="m-0 text-text2">The brochure details did not load.</p>
          <button type="button" onClick={() => setTick((n) => n + 1)} className={cx(rowBtn, 'mt-2')}>Try again</button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {ordered.length === 0 ? (
            <p className="m-0 text-text2">{state === 'loading' ? 'Loading…' : 'No brochures are ready to send yet. The admin adds them on the Brochures page.'}</p>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="sr-only" htmlFor={`bro-pick-${leadId}`}>Brochure to send</label>
              <select id={`bro-pick-${leadId}`} className={field} value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy}>
                {ordered.map((b) => <option key={b.id} value={b.id}>{b.title}{programId && b.program_id === programId ? ' (this course)' : !b.program_id ? ' (all courses)' : ''}</option>)}
              </select>
              <Button variant="primary" className="h-11 md:h-9" onClick={send} loading={busy} disabled={!pick} leftIcon={<Send size={14} />}>Send brochure</Button>
            </div>
          )}
          {busy && <p className="m-0 text-[12.5px] text-muted" role="status">Writing the first page for this lead…</p>}
          {err && <div role="alert" className="rounded-[10px] bg-badBg px-3 py-2 text-[12.5px] font-medium text-badText">{err}</div>}

          {result && (
            <div data-testid="brochure-result" className="flex flex-col gap-2 rounded-xl border border-line bg-surface2 p-3">
              <div className="text-[12.5px] font-semibold text-text">Link ready. Read the first page, then share it.</div>
              <input readOnly aria-label="Brochure link" value={result.url} onFocus={(e) => e.currentTarget.select()} className={cx(field, 'font-mono text-[12px]')} />
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="primary" className="h-11 md:h-8" onClick={() => copy('link', result.url)} leftIcon={<Copy size={13} />}>{copied === 'link' ? 'Copied ✓' : 'Copy link'}</Button>
                <Button size="sm" variant="outline" className="h-11 md:h-8" onClick={() => copy('wa', result.whatsappText)} leftIcon={<MessageCircle size={13} />}>{copied === 'wa' ? 'Copied ✓' : 'Copy WhatsApp message'}</Button>
                <a href={result.url} target="_blank" rel="noreferrer" className={cx(rowBtn, 'h-11 md:h-8')}><ExternalLink size={13} aria-hidden />Open page</a>
              </div>
              <details className="text-[12.5px]">
                <summary className="btn flex min-h-[36px] cursor-pointer items-center font-medium text-accentText">First page the lead will see</summary>
                <div className="mt-1 flex flex-col gap-1.5 rounded-lg bg-surface p-2.5 text-text">
                  <p className="m-0">{result.intro.greeting}</p>
                  {result.intro.why.length > 0 && <ul className="m-0 list-disc pl-4">{result.intro.why.map((w, i) => <li key={i}>{w}</li>)}</ul>}
                  {result.intro.answers.map((a, i) => <p key={i} className="m-0"><b>{a.q}</b> {a.a}</p>)}
                  <p className="m-0 text-text2">{result.intro.next_step}</p>
                </div>
                <p className="m-0 mt-1 text-[11.5px] text-muted">{result.intro.by === 'ai' ? 'Drafted by AI from this lead’s details and the Sales playbook only. Don’t share it if something is wrong.' : 'A plain first page (the AI draft wasn’t available).'} Opening the link while signed in is not counted.</p>
              </details>
            </div>
          )}

          {sends.length > 0 && (
            <div>
              <div className="pb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Sent to this lead</div>
              {sends.map((x) => (
                <CardRow key={x.id}
                  title={<span className="inline-flex min-w-0 items-center gap-1.5"><FileText size={13} aria-hidden className="shrink-0 text-muted" /><span className="truncate">{x.brochure_title || 'Brochure'}</span></span>}
                  sub={<>{x.reading_now ? <span className="font-semibold text-goodText">Reading now · </span> : null}{openedLine(x)}{Number(x.pages_seen) > 0 ? ` · ${x.pages_seen} page${x.pages_seen === 1 ? '' : 's'}` : ''}<br />Sent {istWhen(x.sent_at)}{x.sent_by_name ? ' by ' + String(x.sent_by_name).split(' ')[0] : ''}</>}
                  right={<button type="button" aria-label="Copy this link again" title="Copy this link again" onClick={() => copy(x.id, `${window.location.origin}/b/${x.token}`)} className="btn flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text2 hover:bg-surface2 hover:text-text">{copied === x.id ? '✓' : <Copy size={14} aria-hidden />}</button>} />
              ))}
              <p className="m-0 pt-1 text-[11.5px] text-muted">One “open” is one visit; reading again after 30 minutes counts as a new open. Times are India time.</p>
            </div>
          )}
        </div>
      )}
    </RailCard>
  );
}
