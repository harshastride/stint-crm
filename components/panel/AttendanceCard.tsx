'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { cx } from '../ui';
import { MiniMeter, RailCard } from './RailCard';

type Mark = 'P' | 'A' | 'L';
type Att = { day: string; mark: Mark };

// Marks in the attendance table: P = Present, A = Absent, L = Late. Late counts as attended (same as the
// training rules and QR check-in, which treat P and L as "came to class").
const WORD: Record<Mark, string> = { P: 'Present', A: 'Absent', L: 'Late' };
const TONE: Record<Mark, string> = { P: 'bg-goodBg text-goodText', A: 'bg-badBg text-badText', L: 'bg-warnBg text-warnText' };

/** `day` is a plain date (YYYY-MM-DD); build it as a local date so the weekday never shifts by time zone. */
function parts(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return { weekday: dt.toLocaleDateString('en-IN', { weekday: 'short' }), date: dt.getDate(), month: dt.toLocaleDateString('en-IN', { month: 'short' }) };
}

/** Attendance for the last 6 marked class days, opens to a day-by-day grid. */
export function AttendanceCard({ candidateId, open, onToggle, reloadKey }: { candidateId: string; open: boolean; onToggle: (id: string) => void; reloadKey?: number }) {
  const s = useSession();
  const allowed = s.can('attendance');
  const [rows, setRows] = useState<Att[]>([]);

  useEffect(() => {
    if (!allowed) return;
    let stale = false;
    supabase().from('attendance').select('day,mark').eq('candidate_id', candidateId).order('day', { ascending: false }).limit(60)
      .then(({ data, error }) => {
        if (stale) return;
        setRows(error ? [] : ((data || []) as Att[]));
      });
    return () => { stale = true; };
  }, [candidateId, reloadKey, allowed]);

  if (!allowed || !rows.length) return null;

  const last6 = rows.slice(0, 6).reverse(); // oldest on the left
  const attended = last6.filter((a) => a.mark !== 'A').length;
  const lateCount = last6.filter((a) => a.mark === 'L').length;
  const pct = Math.round((100 * attended) / last6.length);
  const allAttended = rows.filter((a) => a.mark !== 'A').length;
  const overall = Math.round((100 * allAttended) / rows.length);

  return (
    <RailCard id="attend" label="Attendance" testId="card-attend" open={open} onToggle={onToggle}
      summary={<><span className="t num">{attended} of {last6.length} days</span><MiniMeter value={attended} max={last6.length} tone={pct < 75 ? 'bad' : 'accent'} /></>}>
      <div className="grid grid-cols-6 gap-1.5">
        {last6.map((a) => {
          const p = parts(a.day);
          return (
            <div key={a.day} title={`${p.weekday} ${p.date} ${p.month}: ${WORD[a.mark] || a.mark}`} className={cx('min-w-0 rounded-lg px-0.5 py-1.5 text-center', TONE[a.mark])}>
              <div className="text-[10.5px] font-medium uppercase tracking-wide opacity-80">{p.weekday}</div>
              <div className="num text-[15px] font-semibold leading-tight">{p.date}</div>
              <div className="whitespace-nowrap text-[10px] font-semibold tracking-tight">{WORD[a.mark] || a.mark}</div>
            </div>
          );
        })}
      </div>
      <p className="m-0 mt-2.5 text-[12px] text-muted">
        <span className="num">Overall: {overall}% of {rows.length} class days</span>
        {lateCount > 0 && <> · {lateCount} late in these 6 (counted as present)</>}
      </p>
    </RailCard>
  );
}
