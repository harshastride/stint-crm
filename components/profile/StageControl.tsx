'use client';
import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { STAGES } from '@/lib/journey';
import { confirmFor, explainStageError, stageMoves, stagePosition, type Kind } from '@/lib/stageMoves';
import { Button, cx } from '../ui';
import { useToast } from '../Toasts';

/** The person's stage: the 9-step track, where they are, and (for roles that may) the move to the next stage.
 *  Used by the quick panel and the full profile so both look and behave the same. */
export function StageControl({ kind, id, stage, changedAt, onMoved, compact, request, onRequestSeen }: {
  kind: Kind; id: string; stage: string; changedAt?: string | null; onMoved: (stage: string, message?: string) => void; compact?: boolean;
  /** a move asked for elsewhere (e.g. the "Convert to student" next step): it goes through the same confirm and error handling */
  request?: string | null; onRequestSeen?: () => void;
}) {
  const s = useSession();
  const toast = useToast();
  const canWrite = s.can(kind, 'w');
  const pos = stagePosition(stage, changedAt);
  const list = s.lists[kind === 'lead' ? 'lead_stage' : 'candidate_stage'] || [];
  const moves = stageMoves(kind, stage, list);
  const [pending, setPending] = useState<string | null>(null); // a move waiting for "Yes"
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; fix: string } | null>(null);

  const run = async (to: string) => {
    setPending(null); setErr(null); setBusy(true);
    const db = supabase();
    // row security turns a refused update into "0 rows changed", so ask for the row back
    const { data, error } = await db.from(kind).update({ stage: to }).eq('id', id).select('stage');
    setBusy(false);
    if (error || !data?.length) { setErr(explainStageError(error || { code: '42501' }, to, s.staff.role)); return; }
    const c = confirmFor(to);
    if (to === 'Converted') { onMoved(to, 'Converted. A candidate record was created with follow-ups for front desk, HR and finance.'); return; }
    onMoved(to);
    toast('Moved to ' + to + '. Recorded in status history.', c && !c.undo ? undefined : {
      undo: async () => { const r = await db.from(kind).update({ stage }).eq('id', id).select('stage'); if (r.error || !r.data?.length) toast('Could not move it back.', { tone: 'bad' }); else { toast('Moved back to ' + stage + '.'); onMoved(stage); } },
    });
  };
  const ask = (to: string) => { setErr(null); if (confirmFor(to)) setPending(to); else run(to); };
  useEffect(() => { if (request) { onRequestSeen?.(); if (canWrite && request !== stage) ask(request); } }, [request]); // eslint-disable-line react-hooks/exhaustive-deps
  const c = pending ? confirmFor(pending) : null;

  return (
    <div className="flex flex-col gap-2" data-testid="stage-control">
      <div>
        <div className="flex gap-0.5" role="img" aria-label={`Journey step ${pos.index + 1} of ${pos.total}: ${pos.step}`}>
          {STAGES.map((n, i) => <span key={n} className={cx('h-1.5 flex-1 rounded-full transition-colors duration-200', i < pos.index ? 'bg-accent' : i === pos.index ? 'bg-coral' : 'bg-line2')} />)}
        </div>
        <div className={cx('mt-1.5 flex flex-wrap justify-between gap-x-2 text-muted', compact ? 'text-[11.5px]' : 'text-[12.5px]')}>
          <span><span className="font-semibold text-text">Stage: {stage}</span> · step {pos.index + 1} of {pos.total} · with {pos.owner}</span>
          {pos.days !== null && <span>{pos.days === 0 ? 'moved today' : `${pos.days} day${pos.days > 1 ? 's' : ''} in this stage`}</span>}
        </div>
      </div>

      {moves.blocked ? <p className="text-[12.5px] text-text2" role="note">{moves.blocked}</p>
        : !canWrite ? <p className="text-[12.5px] text-text2" role="note">Only {pos.owner} or an Admin can change the stage. You can still add notes and follow-ups.</p>
        : (
          <div className="flex flex-wrap items-center gap-2">
            {moves.next && <Button size="sm" variant="outline" disabled={busy} loading={busy && !pending} onClick={() => ask(moves.next!)} rightIcon={<ArrowRight size={14} />} aria-label={'Move to ' + moves.next}>Move to {moves.next}</Button>}
            {moves.others.length > 0 && (
              <select aria-label="Move to another stage" disabled={busy} value="" onChange={(e) => e.target.value && ask(e.target.value)}
                className="h-9 min-w-0 flex-1 rounded-lg border border-line2 bg-surface px-2.5 text-[13px] font-medium text-text2 sm:max-w-[200px]">
                <option value="">Other stage…</option>
                {moves.others.map((st) => <option key={st} value={st}>{st}</option>)}
              </select>
            )}
          </div>
        )}

      {c && pending && (
        <div role="alertdialog" aria-label={c.title} className="anim-fade rounded-[10px] border border-line2 bg-surface2 p-3">
          <div className="text-[13.5px] font-semibold">{c.title}</div>
          <p className="mt-0.5 text-[12.5px] text-text2">{c.body}</p>
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="quiet" autoFocus onClick={() => setPending(null)}>Cancel</Button>
            <Button size="sm" variant="primary" loading={busy} onClick={() => run(pending)}>{c.yes}</Button>
          </div>
        </div>
      )}
      {err && (
        <div role="alert" className="rounded-[10px] bg-badBg px-3 py-2 text-[12.5px] text-badText">
          <div className="font-semibold">{err.text}</div><div>{err.fix}</div>
        </div>
      )}
    </div>
  );
}
