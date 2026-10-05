'use client';
import { useCallback, useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { clearStageRules, type Kind } from '@/lib/stageMoves';
import { PageHeader } from '../kit/PageHeader';
import { Notice, cx } from '../ui';
import { friendlyError } from '../Fields';

function Switch({ on, label, disabled, onClick }: { on: boolean; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick} className="flex h-11 w-14 shrink-0 items-center disabled:opacity-50">
      <span className={cx('relative h-6 w-11 rounded-full transition-colors duration-150', on ? 'bg-accent' : 'bg-line')}>
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-150', on ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </span>
    </button>
  );
}

/** Admin: which stage moves are allowed, and what must be done before each move. The database enforces both. */
export function StageRules() {
  const s = useSession();
  const canEdit = s.can('stage_rules', 'w');
  const [kind, setKind] = useState<Kind>('lead');
  const [moves, setMoves] = useState<Row[] | null>(null);
  const [reqs, setReqs] = useState<Row[]>([]);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const stages = s.lists[kind === 'lead' ? 'lead_stage' : 'candidate_stage'] || [];

  const load = useCallback(async () => {
    const db = supabase();
    const [t, r] = await Promise.all([
      db.from('stage_transition').select('*').eq('kind', kind),
      db.from('stage_requirement').select('*').eq('kind', kind).order('sort').order('label'),
    ]);
    if (t.error || r.error) setMsg({ tone: 'bad', text: friendlyError((t.error || r.error)!) });
    setMoves(t.data || []); setReqs(r.data || []);
  }, [kind]);
  useEffect(() => { load(); }, [load]);

  const isOn = (from: string, to: string) => !!moves?.some((m) => m.from_stage === from && m.to_stage === to && m.active);
  const toggleMove = async (from: string, to: string) => {
    const on = !isOn(from, to);
    const { error } = await supabase().from('stage_transition').upsert({ kind, from_stage: from, to_stage: to, active: on, updated_at: new Date().toISOString() });
    if (error) { setMsg({ tone: 'bad', text: friendlyError(error) }); return; }
    clearStageRules();
    setMsg({ tone: 'good', text: `${from} → ${to} is ${on ? 'allowed' : 'no longer allowed'}.` }); load();
  };
  const toggleReq = async (r: Row) => {
    const { error } = await supabase().from('stage_requirement').update({ active: !r.active, updated_at: new Date().toISOString() }).eq('id', r.id);
    if (error) { setMsg({ tone: 'bad', text: friendlyError(error) }); return; }
    setMsg({ tone: 'good', text: `“${r.label}” is ${r.active ? 'off. Staff can move without it' : 'on'}.` }); load();
  };
  const when = (r: Row) => r.from_stage && r.to_stage ? `${r.from_stage} → ${r.to_stage}` : r.to_stage ? `Any move into ${r.to_stage}` : `Any move out of ${r.from_stage}`;

  return (
    <main className="flex flex-1 flex-col gap-6 overflow-y-auto p-4 md:p-6" data-testid="stage-rules">
      <PageHeader title="Stage rules"
        description={'Which stage moves staff can make, and what must be done first. The database checks these on every move, from every screen and import. An Admin can still override one move with a reason.' + (canEdit ? '' : ' View only.')}
        filters={(
          <div role="tablist" aria-label="Rules for" className="flex gap-1 rounded-[10px] bg-surface2 p-1">
            {(['lead', 'candidate'] as const).map((k) => (
              <button key={k} role="tab" type="button" aria-selected={kind === k} onClick={() => { setKind(k); setMsg(null); }}
                className={cx('min-h-[40px] rounded-lg px-4 text-[13.5px] font-medium', kind === k ? 'bg-surface text-text shadow-1' : 'text-text2')}>
                {k === 'lead' ? 'Leads' : 'Candidates'}
              </button>
            ))}
          </div>
        )} />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <section className="rounded-[14px] bg-surface p-4 shadow-1" aria-labelledby="sr-moves">
        <h2 id="sr-moves" className="text-[15px] font-semibold">Allowed moves</h2>
        <p className="mb-3 text-[13px] text-text2">Each row is where the {kind} is now; tick the stages it can move to next.</p>
        {moves === null ? <p className="text-muted">Loading…</p> : (
          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-0 text-[13px]" aria-label="Allowed stage moves">
              <thead><tr><th className="sticky left-0 bg-surface p-2 text-left font-medium text-muted">From ↓ / To →</th>
                {stages.map((to) => <th key={to} scope="col" className="min-w-[84px] p-2 text-center font-medium text-text2">{to}</th>)}</tr></thead>
              <tbody>
                {stages.map((from) => (
                  <tr key={from} className="border-t border-line">
                    <th scope="row" className="sticky left-0 whitespace-nowrap border-t border-line bg-surface p-2 text-left font-semibold">{from}</th>
                    {stages.map((to) => {
                      const on = isOn(from, to);
                      const self = from === to && !(kind === 'lead' && from === 'Callback');
                      return (
                        <td key={to} className="border-t border-line p-0 text-center">
                          {self ? <span className="text-line2" aria-hidden>—</span> : (
                            <button type="button" role="checkbox" aria-checked={on} aria-label={`${from} to ${to}`} disabled={!canEdit} onClick={() => toggleMove(from, to)}
                              className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg hover:bg-surface2 disabled:cursor-default">
                              <span className={cx('flex h-6 w-6 items-center justify-center rounded-md border', on ? 'border-accent bg-accent text-white' : 'border-line2 bg-surface')}>{on && <Check size={15} aria-hidden />}</span>
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-[14px] bg-surface p-4 shadow-1" aria-labelledby="sr-reqs">
        <h2 id="sr-reqs" className="text-[15px] font-semibold">Must be done first</h2>
        <p className="mb-2 text-[13px] text-text2">When a check is on, staff see it as a checklist and the move stays blocked until it is met.</p>
        <ul className="divide-y divide-line">
          {reqs.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-1" data-req={r.code}>
              <Switch on={!!r.active} label={`${r.label} (${when(r)}) on or off`} disabled={!canEdit} onClick={() => toggleReq(r)} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{r.label}</div>
                <div className="text-[12.5px] text-text2">{when(r)}{r.code === 'attendance_min' ? ' · minimum from the attendance setting' : ''}{!r.active ? ' · off' : ''}</div>
              </div>
            </li>
          ))}
          {reqs.length === 0 && <li className="py-3 text-muted">No checks for {kind === 'lead' ? 'leads' : 'candidates'}.</li>}
        </ul>
      </section>
    </main>
  );
}
