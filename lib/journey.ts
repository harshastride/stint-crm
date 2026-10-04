// The 9-step student journey, shared by the quick panel, the full profile and the student portal.
export const STAGES = ['Lead', 'Calls', 'Counselling', 'Enrolled', 'Training', 'Mocks', 'Resume + docs', 'Placement', 'Alumni'];
export const STAGE_OWNER = ['Marketing', 'Telecaller', 'Sales', 'Front desk and HR', 'Trainer', 'SME', 'HR', 'Placement', 'Placement'];
export const STAGE_INDEX: Record<string, number> = { New: 0, Callback: 1, Interested: 1, Counselling: 2, Converted: 3, 'Not interested': 1, Enrolled: 3, Training: 4, Mocks: 5, Resume: 6, Docs: 6, Ready: 7, Placed: 7, Alumni: 8 };

export type StageChange = { to_value: string | null; at: string; by_name?: string | null };
export type Step = { name: string; owner: string; state: 'done' | 'current' | 'next'; reachedAt: string | null; by: string | null; days: number | null };

/** When each step was first reached (from stage history), and how long it took to move on. */
export function journey(changes: StageChange[], current: string, startedAt?: string | null): Step[] {
  const cur = STAGE_INDEX[current] ?? 0;
  const first: (StageChange | null)[] = STAGES.map(() => null);
  [...changes].sort((a, b) => +new Date(a.at) - +new Date(b.at)).forEach((c) => {
    const i = c.to_value ? STAGE_INDEX[c.to_value] : undefined;
    if (i !== undefined && !first[i]) first[i] = c;
  });
  if (!first[0] && startedAt) first[0] = { to_value: 'New', at: startedAt };
  const reached = first.map((c) => c?.at ?? null);
  return STAGES.map((name, i) => {
    const at = i <= cur ? reached[i] : null;
    const nextAt = reached.slice(i + 1).find(Boolean) || (i === cur ? new Date().toISOString() : null);
    return {
      name, owner: STAGE_OWNER[i], state: i < cur ? 'done' : i === cur ? 'current' : 'next',
      reachedAt: at, by: i <= cur ? first[i]?.by_name ?? null : null,
      days: at && nextAt ? Math.max(0, Math.round((+new Date(nextAt) - +new Date(at)) / 864e5)) : null,
    };
  });
}
