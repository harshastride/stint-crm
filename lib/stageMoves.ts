// Stage moves for one lead or candidate, shared by the quick panel and the full profile.
// The database decides what is allowed (row security per page, and stage rules: migration 073); this file loads the rules,
// says which moves need a second look, and turns a database refusal into plain words with a fix.
import { useEffect, useState } from 'react';
import { STAGE_INDEX, STAGE_OWNER, STAGES } from './journey';
import { supabase } from './supabase';

export type Kind = 'lead' | 'candidate';

/** Moves that are hard to take back or close the person's journey: ask once before doing them. */
const CONFIRM: Record<string, { title: string; body: string; yes: string; undo: boolean }> = {
  Converted: { title: 'Convert to student?', body: 'This creates a candidate record with follow-ups for front desk, HR and finance. It cannot be undone from here.', yes: 'Yes, convert', undo: false },
  'Not interested': { title: 'Mark as not interested?', body: 'The lead leaves the active pipeline and stops showing in call lists.', yes: 'Yes, mark it', undo: true },
  Alumni: { title: 'Move to Alumni?', body: 'Placement work ends here; only alumni check-ins follow.', yes: 'Yes, move to Alumni', undo: true },
};
export const confirmFor = (stage: string) => CONFIRM[stage] || null;

/** Where the person sits in the 9-step journey, and who is working on it. */
export function stagePosition(stage: string, changedAt?: string | null) {
  const i = STAGE_INDEX[stage] ?? 0;
  const days = changedAt ? Math.max(0, Math.floor((Date.now() - new Date(changedAt).getTime()) / 864e5)) : null;
  return { index: i, step: STAGES[i], owner: STAGE_OWNER[i], days, total: STAGES.length };
}

/** Allowed moves from the Stage rules page (stage_transition), cached for the session. key "kind:from" → to-stages. */
let rulesP: Promise<Record<string, string[]>> | null = null;
export function clearStageRules() { rulesP = null; }
export function loadStageRules() {
  if (!rulesP) rulesP = Promise.resolve(supabase().from('stage_transition').select('kind, from_stage, to_stage').eq('active', true)).then(({ data, error }) => {
    if (error) { rulesP = null; return {}; }
    const out: Record<string, string[]> = {};
    for (const r of data || []) (out[r.kind + ':' + r.from_stage] ||= []).push(r.to_stage);
    return out;
  });
  return rulesP;
}
/** (from) → allowed next stages in list order; null while loading (callers then allow nothing new). */
export function useStageRules(kind: Kind, list: string[]) {
  const [rules, setRules] = useState<Record<string, string[]> | null>(null);
  useEffect(() => { let on = true; loadStageRules().then((r) => on && setRules(r)); return () => { on = false; }; }, []);
  return (from: string): string[] | null => {
    if (!rules) return null;
    const to = rules[kind + ':' + from] || [];
    return [...to].sort((a, b) => (list.indexOf(a) + 1 || 99) - (list.indexOf(b) + 1 || 99));
  };
}

export type Unmet = { code: string; label: string; detail: string | null; met?: boolean };
/** missing = what blocks the move; checks = every active requirement of the move, met or not */
export type StageOption = { to_stage: string; ok: boolean; missing: Unmet[]; checks: Unmet[] };
/** Each allowed next stage with what is still missing (database function stage_check). */
export async function stageCheck(kind: Kind, id: string): Promise<{ options: StageOption[]; error: { code?: string; message?: string } | null }> {
  const { data, error } = await supabase().rpc('stage_check', { p_kind: kind, p_id: id });
  return { options: (data as StageOption[]) || [], error };
}

/** The usual next stage first (forward in the list), then the other allowed stages. A converted lead cannot move. */
export function stageMoves(kind: Kind, stage: string, list: string[], allowed: string[]): { next: string | null; others: string[]; blocked: string | null } {
  if (kind === 'lead' && stage === 'Converted') return { next: null, others: [], blocked: 'This lead is now a student. Change the stage on the candidate record.' };
  const at = list.indexOf(stage);
  const forward = allowed.filter((s) => s !== 'Not interested' && list.indexOf(s) > at);
  const next = forward[0] || (allowed.includes('New') && stage === 'Not interested' ? 'New' : null);
  return { next, others: allowed.filter((s) => s !== next), blocked: allowed.length ? null : `No moves are allowed from ${stage}. An Admin can change this in Stage rules.` };
}

/** A refused move in plain words, plus what fixes it. */
export function explainStageError(e: { code?: string; message?: string } | null, stage: string, role: string): { text: string; fix: string } {
  const m = e?.message || '';
  const owner = STAGE_OWNER[STAGE_INDEX[stage] ?? 0];
  if (e?.code === '42501' || /row-level security|permission denied/i.test(m)) return { text: `Your role (${role}) can’t move this record to ${stage}.`, fix: `Ask ${owner} or an Admin to make the move.` };
  if (/fetch|network|Failed to/i.test(m)) return { text: 'Could not reach the server, so the stage did not change.', fix: 'Check the connection and try again.' };
  if (e?.code === '23514' || e?.code === 'P0001') return { text: m.replace(/^ERROR:\s*/, '') || 'This move is not allowed yet.', fix: /isn.t allowed/.test(m) ? 'Pick one of the allowed stages.' : 'Complete the missing steps, then try again.' };
  if (e?.code === 'PGRST116' || /0 rows/.test(m)) return { text: 'The record was not changed. It may have moved out of your view.', fix: 'Reload the page to see its current stage.' };
  return { text: m || 'The stage did not change.', fix: 'Try again. If it keeps failing, tell an Admin.' };
}
