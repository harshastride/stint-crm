'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';

// Calls, notes and follow-ups per day for the last 26 weeks, as coloured squares (darker = busier).
const WEEKS = 26;
const SHADES = ['bg-surface2', 'bg-[#C9D8EE] dark:bg-[#22385A]', 'bg-[#8FB0DD] dark:bg-[#2F5288]', 'bg-[#5F8FCB] dark:bg-[#3D6BB0]', 'bg-[#2F5C9C] dark:bg-[#6A9BE0]'];
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function ActivityHeatmap() {
  const s = useSession();
  const [staffId, setStaffId] = useState(s.staff.id);
  // Admin can look at anyone; a team head at people in their own team
  const team = s.staff.role === 'Admin' ? s.refs.staff : s.staff.level === 'Head' ? s.refs.staff.filter((x) => x.extra?.role === s.staff.role) : [];
  const title = staffId === s.staff.id ? 'My activity' : 'Activity: ' + (s.refs.staff.find((x) => x.id === staffId)?.label || '');
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    supabase().rpc('staff_activity', { p_staff: staffId ?? null, p_days: WEEKS * 7 + 7 }).then(({ data }: { data: { day: string; n: number }[] | null }) =>
      setCounts(Object.fromEntries((data || []).map((r) => [r.day, r.n]))));
  }, [staffId]);
  const days = useMemo(() => {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const start = new Date(t); start.setDate(t.getDate() - ((t.getDay() + 6) % 7) - (WEEKS - 1) * 7);   // a Monday
    return Array.from({ length: WEEKS * 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, []);
  if (!counts) return null;
  const vals = Object.values(counts), max = Math.max(1, ...vals), total = vals.reduce((a, b) => a + b, 0);
  const today = Date.now();
  const busiest = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  let streak = 0; for (let i = days.length - 1; i >= 0; i--) { if (days[i].getTime() > today) continue; if (counts[key(days[i])]) streak++; else if (key(days[i]) !== key(new Date())) break; }
  const shade = (n: number) => (n ? SHADES[Math.min(4, Math.ceil((4 * n) / max))] : SHADES[0]);
  return (
    <section className="rounded-card bg-surface shadow-1 px-4 py-3" aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div><h2 className="text-[13px] font-semibold">{title}</h2><p className="text-xs text-muted">Calls, notes and follow-ups, last 6 months</p></div>
        <div className="flex flex-wrap items-center gap-4 text-[12.5px] text-text2">
          {team.length > 1 && (
            <select aria-label="Whose activity" value={staffId} onChange={(e) => setStaffId(e.target.value)} className="h-9 px-2 text-[13px]">
              {team.map((x) => <option key={x.id} value={x.id}>{x.id === s.staff.id ? 'Me' : x.label}</option>)}
            </select>
          )}
          <span><b className="num text-text">{total}</b> in all</span><span><b className="num text-text">{streak}</b> day streak</span>
          {busiest && <span>Busiest: <b className="text-text">{new Date(busiest[0]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</b> ({busiest[1]})</span>}
        </div>
      </div>
      <div className="mt-3 overflow-x-auto">
        <div className="grid w-max grid-flow-col grid-rows-7 gap-[3px]" role="img" aria-label={`${total} activities in the last 6 months`}>
          {days.map((d) => {
            const n = counts[key(d)] || 0, future = d.getTime() > today;
            return <span key={key(d)} title={future ? '' : `${d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}: ${n} done`}
              className={'h-[13px] w-[13px] rounded-[3px] ' + (future ? 'opacity-0' : shade(n))} />;
          })}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 text-[11px] text-muted">Less{SHADES.map((s) => <span key={s} className={'h-[11px] w-[11px] rounded-[3px] ' + s} />)}More</div>
    </section>
  );
}
