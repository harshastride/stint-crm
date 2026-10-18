'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { cx, fmtDate, money } from '../ui';
import { Meter } from '../kit/Meter';
import { CardRow, Chip, MiniMeter, RailCard } from './RailCard';

const btn = 'btn inline-flex h-8 items-center rounded-lg px-2.5 text-[12.5px] font-medium';

/** "(today)" / "(tomorrow)" / "(yesterday)" for a yyyy-mm-dd date, else nothing. */
function nearWord(d: unknown): string {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  if (!y || !m || !day) return '';
  const t = new Date();
  const diff = Math.round((new Date(y, m - 1, day).getTime() - new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()) / 86400000);
  return diff === 0 ? ' (today)' : diff === 1 ? ' (tomorrow)' : diff === -1 ? ' (yesterday)' : '';
}

const tone = (status: string): 'good' | 'warn' | 'bad' | 'plain' => (status === 'Received' ? 'good' : status === 'Due' ? 'warn' : status === 'Overdue' ? 'bad' : 'plain');

/** Fees line in the person panel: paid of total, opens to the instalments. Hidden without access or without a fee plan. */
export function FeesCard({ candidateId, open, onToggle, reloadKey }: { candidateId: string; open: boolean; onToggle: (id: string) => void; reloadKey?: number }) {
  const s = useSession();
  const allowed = s.can('plan') && s.can('payment');
  const canRecord = s.can('payment', 'w');
  const [plan, setPlan] = useState<Row | null>(null);
  const [pays, setPays] = useState<Row[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!allowed) return;
    let stale = false;
    const db = supabase();
    setState((cur) => (cur === 'ready' ? cur : 'loading'));
    Promise.all([
      db.from('fee_plan_summary').select('*').eq('candidate_id', candidateId),
      db.from('fee_payment').select('*').eq('candidate_id', candidateId).order('due_on'),
    ]).then(([p, f]) => {
      if (stale) return;
      if (p.error || f.error) { setState('error'); return; }
      setPlan(p.data?.[0] ?? null);
      setPays(f.data || []);
      setState('ready');
    }, () => { if (!stale) setState('error'); });
    return () => { stale = true; };
  }, [candidateId, reloadKey, retry, allowed]);

  // A different person: do not show the previous person's numbers while loading.
  useEffect(() => { setPlan(null); setPays([]); setState('loading'); }, [candidateId]);

  const again = useCallback(() => { setState('loading'); setRetry((n) => n + 1); }, []);

  if (!allowed) return null;
  if (state === 'ready' && !plan) return null;

  if (state === 'loading') {
    return <RailCard id="fees" label="Fees" testId="card-fees" open={open} onToggle={onToggle} summary={<span className="t text-muted">Loading…</span>}><p className="m-0 text-muted">Loading…</p></RailCard>;
  }
  if (state === 'error') {
    return (
      <RailCard id="fees" label="Fees" testId="card-fees" open={open} onToggle={onToggle} summary={<span className="t text-muted">Could not load</span>}>
        <p className="m-0 text-text2">The fee details did not load.</p>
        <button type="button" onClick={again} className={cx(btn, 'mt-2 text-text2 hover:bg-surface2')}>Try again</button>
      </RailCard>
    );
  }

  const total = Number(plan?.total || 0);
  const paid = Number(plan?.paid || 0);
  const late = pays.filter((p) => p.status === 'Overdue').length;

  return (
    <RailCard id="fees" label="Fees" testId="card-fees" open={open} onToggle={onToggle}
      summary={<>
        {late > 0 && <Chip tone="bad">{late} late</Chip>}
        <span className="t num">{money(paid)} of {money(total)}</span>
        <MiniMeter value={paid} max={total} tone={late > 0 ? 'bad' : 'accent'} />
      </>}>
      {total > 0 && <Meter label="Fees paid" value={paid} max={total} text={`${money(paid)} of ${money(total)}`} tone={late > 0 ? 'bad' : 'accent'} className="mb-2 mt-1" />}
      {pays.length === 0 ? (
        <p className="m-0 py-2 text-text2">No instalments set up yet.</p>
      ) : (
        <div>
          {pays.map((p) => {
            const received = p.status === 'Received';
            const day = received && p.paid_on ? p.paid_on : p.due_on;
            const sub = day ? (received ? 'Received ' : 'Due ') + fmtDate(day) + (received ? '' : nearWord(day)) : (p.label || undefined);
            return <CardRow key={p.id} title={<span className="num">{money(p.amount)}</span>} sub={sub} right={<Chip tone={tone(String(p.status))}>{p.status}</Chip>} />;
          })}
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {canRecord && <Link href={`/p/payment?new=candidate:${candidateId}`} className={cx(btn, 'bg-accent text-white')}>Record a payment</Link>}
        <Link href={`/candidate/${candidateId}`} className={cx(btn, 'text-text2 hover:bg-surface2')}>Open fees in full profile</Link>
      </div>
    </RailCard>
  );
}
