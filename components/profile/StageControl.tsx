'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { STAGES } from '@/lib/journey';
import { confirmFor, explainStageError, stageCheck, stageMoves, stagePosition, useStageRules, type Kind, type StageOption } from '@/lib/stageMoves';
import { Button, cx } from '../ui';
import { useToast } from '../Toasts';

/** Requirements staff can meet right here, in the same save as the move. */
const INLINE: Record<string, string> = { lost_reason: 'lost_reason', next_call_set: 'next_call_at' };
const field = 'h-11 w-full rounded-lg border border-line2 bg-surface px-2.5 text-[13.5px]';

/** The person's stage: the 9-step track, where they are, the allowed next stages with what each still needs,
 *  and (for Admin) an override with a reason. Used by the quick panel and the full profile.
 *  The database (stage rules, migration 073) refuses any move that is not allowed or not ready. */
export function StageControl({ kind, id, stage, changedAt, onMoved, compact, request, onRequestSeen }: {
  kind: Kind; id: string; stage: string; changedAt?: string | null; onMoved: (stage: string, message?: string) => void; compact?: boolean;
  /** a move asked for elsewhere (e.g. the "Convert to student" next step): it goes through the same checks and error handling */
  request?: string | null; onRequestSeen?: () => void;
}) {
  const s = useSession();
  const toast = useToast();
  const canWrite = s.can(kind, 'w');
  const isAdmin = s.staff.role === 'Admin';
  const pos = stagePosition(stage, changedAt);
  const list = s.lists[kind === 'lead' ? 'lead_stage' : 'candidate_stage'] || [];
  const rules = useStageRules(kind, list);
  const [opts, setOpts] = useState<StageOption[] | null>(null);
  const [target, setTarget] = useState<string | null>(null); // the move being looked at
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [override, setOverride] = useState<string | null>(null); // reason text while overriding
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; fix: string } | null>(null);

  const refresh = useCallback(async () => {
    const r = await stageCheck(kind, id);
    setOpts(r.error ? [] : r.options);
  }, [kind, id]);
  useEffect(() => { setOpts(null); setTarget(null); setOverride(null); setExtra({}); refresh(); }, [refresh, stage]);

  const allowed = (opts || []).map((o) => o.to_stage);
  const moves = stageMoves(kind, stage, list, allowed);
  const opt = (to: string | null) => (opts || []).find((o) => o.to_stage === to) || null;
  const nextOpt = opt(moves.next);

  const inlineCodes = (o: StageOption | null) => (o?.missing || []).filter((m) => INLINE[m.code]).map((m) => m.code);
  const blockers = (o: StageOption | null) => (o?.missing || []).filter((m) => !(INLINE[m.code] && extra[INLINE[m.code]]));

  const done = (to: string, msg?: string) => {
    setTarget(null); setOverride(null); setExtra({});
    if (to === 'Converted') { onMoved(to, 'Converted. A candidate record was created with follow-ups for front desk, HR and finance.'); return; }
    onMoved(to);
    const back = rules(to)?.includes(stage);
    const c = confirmFor(to);
    toast(msg || 'Moved to ' + to + '. Recorded in status history.', !back || (c && !c.undo) ? undefined : {
      undo: async () => { const r = await supabase().from(kind).update({ stage }).eq('id', id).select('stage'); if (r.error || !r.data?.length) toast('Could not move it back: ' + explainStageError(r.error, stage, s.staff.role).text, { tone: 'bad' }); else { toast('Moved back to ' + stage + '.'); onMoved(stage); } },
    });
  };

  const run = async (to: string) => {
    setErr(null); setBusy(true);
    const patch: Record<string, unknown> = { stage: to };
    for (const code of inlineCodes(opt(to))) {
      const col = INLINE[code], v = extra[col];
      if (v) patch[col] = col === 'next_call_at' ? new Date(v).toISOString() : v;
    }
    // row security turns a refused update into "0 rows changed", so ask for the row back
    const { data, error } = await supabase().from(kind).update(patch).eq('id', id).select('stage');
    setBusy(false);
    if (error || !data?.length) { setErr(explainStageError(error || { code: '42501' }, to, s.staff.role)); refresh(); return; }
    done(to);
  };
  const force = async (to: string) => {
    setErr(null); setBusy(true);
    const { error } = await supabase().rpc('force_stage', { p_kind: kind, p_id: id, p_to: to, p_reason: override || '' });
    setBusy(false);
    if (error) { setErr({ text: error.message, fix: 'Check the reason and try again.' }); return; }
    done(to, 'Moved to ' + to + ' by Admin override. The reason is in status history.');
  };
  /** Ready routine moves happen at once; anything with a question, a missing step or a field opens the checklist. */
  const ask = (to: string) => {
    setErr(null); setOverride(null);
    const o = opt(to);
    if (o?.ok && !confirmFor(to)) { run(to); return; }
    setTarget(to);
  };
  useEffect(() => { if (request && opts) { onRequestSeen?.(); if (canWrite && request !== stage) { if (allowed.includes(request) || isAdmin) ask(request); else setErr({ text: `Can’t move from ${stage} to ${request}: that move isn’t allowed.`, fix: 'Pick one of the allowed stages.' }); } } }, [request, opts]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = opt(target);
  const c = target ? confirmFor(target) : null;
  const left = blockers(t);

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

      {!canWrite ? <p className="text-[12.5px] text-text2" role="note">Only {pos.owner} or an Admin can change the stage. You can still add notes and follow-ups.</p>
        : opts === null ? <p className="text-[12.5px] text-muted">Checking what’s next…</p>
        : moves.blocked && !isAdmin ? <p className="text-[12.5px] text-text2" role="note">{moves.blocked}</p>
        : !target && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {moves.next && <Button size="sm" variant="outline" disabled={busy} loading={busy} onClick={() => ask(moves.next!)} rightIcon={<ArrowRight size={14} />} aria-label={'Move to ' + moves.next}>Move to {moves.next}</Button>}
              {(moves.others.length > 0 || isAdmin) && (
                <select aria-label="Move to another stage" disabled={busy} value="" onChange={(e) => e.target.value && ask(e.target.value)}
                  className="h-9 min-w-0 flex-1 rounded-lg border border-line2 bg-surface px-2.5 text-[13px] font-medium text-text2 sm:max-w-[220px]">
                  <option value="">Other stage…</option>
                  {moves.others.map((st) => <option key={st} value={st}>{st}{opt(st)?.ok ? '' : ' (steps missing)'}</option>)}
                  {isAdmin && list.filter((st) => st !== stage && !allowed.includes(st)).length > 0 && (
                    <optgroup label="Admin override">
                      {list.filter((st) => st !== stage && !allowed.includes(st)).map((st) => <option key={st} value={st}>{st} (not an allowed move)</option>)}
                    </optgroup>
                  )}
                </select>
              )}
            </div>
            {moves.blocked && <p className="text-[12.5px] text-text2" role="note">{moves.blocked}</p>}
            {nextOpt && nextOpt.missing.length > 0 && (
              <Checklist title={`Before ${moves.next}`} opt={nextOpt} compact={compact} />
            )}
          </>
        )}

      {target && (
        <div role="alertdialog" aria-label={c?.title || 'Move to ' + target} className="anim-fade rounded-[10px] border border-line2 bg-surface2 p-3" data-testid="stage-move-panel">
          <div className="text-[13.5px] font-semibold">{c?.title || 'Move to ' + target + '?'}</div>
          {c && <p className="mt-0.5 text-[12.5px] text-text2">{c.body}</p>}
          {t ? <Checklist title="Needed first" opt={t} compact={compact} extra={extra} /> : <p className="mt-1 text-[12.5px] text-text2">{stage} → {target} is not an allowed move. Only an Admin override can make it.</p>}
          {t && inlineCodes(t).includes('lost_reason') && (
            <label className="mt-2 block text-[12.5px] font-medium">Reason
              <select className={field} value={extra.lost_reason || ''} onChange={(e) => setExtra({ ...extra, lost_reason: e.target.value })} aria-label="Reason not interested">
                <option value="">Choose a reason…</option>
                {(s.lists.lost_reason || []).map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          )}
          {t && inlineCodes(t).includes('next_call_set') && (
            <label className="mt-2 block text-[12.5px] font-medium">Next call
              <input type="datetime-local" className={field} value={extra.next_call_at || ''} onChange={(e) => setExtra({ ...extra, next_call_at: e.target.value })} aria-label="Next call date and time" />
            </label>
          )}
          {override !== null && (
            <label className="mt-2 block text-[12.5px] font-medium">Why override the rules? (kept in status history)
              <textarea className="mt-1 w-full rounded-lg border border-line2 bg-surface p-2 text-[13.5px]" rows={2} value={override} onChange={(e) => setOverride(e.target.value)} aria-label="Override reason" autoFocus />
            </label>
          )}
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="quiet" autoFocus={override === null} onClick={() => { setTarget(null); setOverride(null); }}>Cancel</Button>
            {override !== null
              ? <Button size="sm" variant="primary" loading={busy} disabled={override.trim().length < 5} onClick={() => force(target)}>Override and move</Button>
              : <>
                  {isAdmin && (!t || left.length > 0) && <Button size="sm" variant="outline" onClick={() => setOverride('')}>Override…</Button>}
                  <Button size="sm" variant="primary" loading={busy} disabled={!t || left.length > 0} onClick={() => run(target)}
                    title={!t ? 'Not an allowed move' : left.length ? 'Finish the missing steps first' : undefined}>{c?.yes || 'Move to ' + target}</Button>
                </>}
          </div>
          {t && left.length > 0 && override === null && <p className="mt-1 text-right text-[12px] text-muted">Move is off until every step is ticked.</p>}
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

function Checklist({ title, opt, compact, extra }: { title: string; opt: StageOption; compact?: boolean; extra?: Record<string, string> }) {
  const items = opt.checks?.length ? opt.checks : opt.missing;
  const met = (m: { code: string; met?: boolean }) => !!m.met || !!extra?.[INLINE[m.code]];
  if (!items.length) return <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-goodText"><Check size={14} aria-hidden /> Everything needed is done.</p>;
  return (
    <div className="mt-1" data-testid="stage-checklist">
      <div className={cx('font-medium text-text2', compact ? 'text-[11.5px]' : 'text-[12px]')}>{title}</div>
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {items.map((m) => (
          <li key={m.code} className="flex items-start gap-1.5 text-[12.5px]">
            {met(m) ? <Check size={14} className="mt-0.5 shrink-0 text-goodText" aria-label="done" /> : <X size={14} className="mt-0.5 shrink-0 text-badText" aria-label="missing" />}
            <span><span className="font-medium">{m.label}</span>{!met(m) && m.detail && m.code !== 'not_allowed' && <span className="text-text2"> — {m.detail}</span>}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
