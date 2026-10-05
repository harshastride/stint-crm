// Stage moves for one lead or candidate, shared by the quick panel and the full profile.
// The database decides what is allowed (row security per page); this file only orders the choices,
// says which moves need a second look, and turns a database refusal into plain words with a fix.
import { STAGE_INDEX, STAGE_OWNER, STAGES } from './journey';

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

/** The usual next stage first, then every other stage. A converted lead cannot move (its journey continues on the candidate). */
export function stageMoves(kind: Kind, stage: string, list: string[]): { next: string | null; others: string[]; blocked: string | null } {
  if (kind === 'lead' && stage === 'Converted') return { next: null, others: [], blocked: 'This lead is now a student. Change the stage on the candidate record.' };
  const forward = list.filter((s) => s !== 'Not interested');
  const at = forward.indexOf(stage);
  const next = stage === 'Not interested' ? (list.includes('Callback') ? 'Callback' : forward[0] || null) : at >= 0 && at < forward.length - 1 ? forward[at + 1] : null;
  return { next, others: list.filter((s) => s !== stage && s !== next), blocked: null };
}

/** A refused move in plain words, plus what fixes it. */
export function explainStageError(e: { code?: string; message?: string } | null, stage: string, role: string): { text: string; fix: string } {
  const m = e?.message || '';
  const owner = STAGE_OWNER[STAGE_INDEX[stage] ?? 0];
  if (e?.code === '42501' || /row-level security|permission denied/i.test(m)) return { text: `Your role (${role}) can’t move this record to ${stage}.`, fix: `Ask ${owner} or an Admin to make the move.` };
  if (/fetch|network|Failed to/i.test(m)) return { text: 'Could not reach the server, so the stage did not change.', fix: 'Check the connection and try again.' };
  if (e?.code === '23514' || e?.code === 'P0001') return { text: m.replace(/^ERROR:\s*/, '') || 'This move is not allowed yet.', fix: 'Complete the missing step above, then try again.' };
  if (e?.code === 'PGRST116' || /0 rows/.test(m)) return { text: 'The record was not changed. It may have moved out of your view.', fix: 'Reload the page to see its current stage.' };
  return { text: m || 'The stage did not change.', fix: 'Try again. If it keeps failing, tell an Admin.' };
}
