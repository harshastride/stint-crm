'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, cx, fmtDateTime } from '../ui';

// Daily call brief for telecallers and sales: the leads due today, most promising first, each with a two-line note
// written by AI from the last calls and notes. Advice only. Saved once per India day; prepared by /api/ai/call-brief.

type Item = { lead_id: string; name: string; stage: string; due: string | null; priority: 1 | 2 | 3; last_time: string; say_now: string };
type Brief = { body: { overview: string; items: Item[] }; created_at: string };
type Problem = { kind: 'setup' | 'error'; message: string } | null;

const PRIORITY: Record<number, { label: string; cls: string }> = {
  1: { label: 'Call first', cls: 'bg-accentSoft text-accentText' },
  2: { label: 'Then', cls: 'bg-surface2 text-text2' },
  3: { label: 'If time', cls: 'text-muted' },
};

const indiaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const timeOnly = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toLowerCase();

function dueLabel(iso: string | null, today: string) {
  if (!iso) return null;
  const d = new Date(iso), late = d.getTime() < Date.now();
  const isToday = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === today;
  if (isToday) return { text: late ? `Overdue · ${timeOnly(iso)}` : timeOnly(iso), late };
  return { text: `Overdue · ${fmtDateTime(iso)}`, late: true };
}

export function CallBrief() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const busy = useRef(false);
  const today = indiaToday();

  useEffect(() => {
    let alive = true;
    supabase().from('ai_brief').select('body, created_at').eq('kind', 'call_brief').eq('period_start', today).maybeSingle()
      .then(({ data }: { data: Brief | null }) => { if (alive) { setBrief(data && data.body && Array.isArray(data.body.items) ? data : null); setLoading(false); } },
        () => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [today]);

  const prepare = useCallback(async (refresh: boolean) => {
    if (busy.current) return;
    busy.current = true; setWorking(true); setProblem(null);
    try {
      const res = await fetch('/api/ai/call-brief', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh }) });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.brief?.body) setBrief(j.brief as Brief);
      else if (res.status === 503) setProblem({ kind: 'setup', message: j?.error || 'The call brief is not set up yet. Ask the admin to add the Claude key.' });
      else setProblem({ kind: 'error', message: typeof j?.error === 'string' && j.error.length < 160 ? j.error : 'Could not prepare the brief. Please try again.' });
    } catch {
      setProblem({ kind: 'error', message: 'Could not reach the server. Check your connection and try again.' });
    } finally {
      busy.current = false; setWorking(false);
    }
  }, []);

  const items = brief?.body.items || [];

  return (
    <section aria-label="Today's call brief" className="rounded-card bg-surface px-4 py-3 shadow-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 pt-2">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold"><Sparkles size={14} className="text-accentText" aria-hidden />Today&rsquo;s call brief</h2>
          <p className="mt-0.5 text-xs text-muted">Written by AI from your last calls and notes. Check the lead before you call.</p>
        </div>
        {!loading && problem?.kind !== 'setup' && (brief
          ? <Button variant="outline" size="lg" onClick={() => prepare(true)} loading={working} leftIcon={<RefreshCw size={15} />} aria-label="Refresh my call brief">Refresh</Button>
          : <Button variant="primary" size="lg" onClick={() => prepare(false)} loading={working}>Prepare my brief</Button>)}
      </div>

      <div aria-live="polite" className="text-[13px]">
        {working && <p className="mt-2 text-text2">Reading your last calls…</p>}
        {loading && <p className="mt-2 text-muted">Loading…</p>}
        {problem?.kind === 'setup' && <p className="mt-2 text-text2">{problem.message}</p>}
        {problem?.kind === 'error' && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-badText">{problem.message}</p>
            <Button variant="link" className="min-h-[44px]" onClick={() => prepare(!!brief)}>Try again</Button>
          </div>
        )}
      </div>

      {!loading && !brief && !working && !problem && (
        <p className="mt-2 text-[13px] text-text2">See who to call first today, what happened last time, and what to say now.</p>
      )}

      {brief && (
        <>
          <p className="mt-2 text-xs text-muted">Prepared {timeOnly(brief.created_at)}</p>
          {items.length === 0 ? (
            <p className="mt-2 text-text2">Nothing is due today. You&rsquo;re clear.</p>
          ) : (
            <>
              {brief.body.overview && <p className="mt-1 text-[13px] text-text2">{brief.body.overview}</p>}
              <ol className="mt-2" aria-label="Leads to call, most promising first">
                {items.map((it) => {
                  const p = PRIORITY[it.priority] || PRIORITY[3];
                  const due = dueLabel(it.due, today);
                  return (
                    <li key={it.lead_id} className="border-t border-line py-2 first:border-0">
                      <div className="flex items-center gap-2">
                        <Link href={`/p/lead?person=lead:${it.lead_id}`} title={it.name}
                          className="inline-flex min-h-[44px] min-w-0 items-center truncate text-[13px] font-medium text-accentText hover:underline md:min-h-[32px]">
                          <span className="truncate">{it.name}</span>
                        </Link>
                        <span className={cx('shrink-0 whitespace-nowrap rounded-full px-2 py-[2px] text-[11.5px] font-semibold', p.cls)}>{p.label}</span>
                        <span className="ml-auto flex min-w-0 shrink items-center gap-1 text-xs text-muted">
                          <span className="truncate">{it.stage}</span>
                          {due && <><span aria-hidden>·</span><span className={cx('whitespace-nowrap font-medium', due.late ? 'text-badText' : 'text-text2')}>{due.text}</span></>}
                        </span>
                      </div>
                      <p className="text-xs leading-snug text-text2"><span className="font-medium text-muted">Last time: </span>{it.last_time}</p>
                      {it.say_now && <p className="mt-0.5 text-xs leading-snug text-text"><span className="font-medium text-muted">Say: </span>{it.say_now}</p>}
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </>
      )}
    </section>
  );
}
