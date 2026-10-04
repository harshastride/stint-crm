'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { Notice, cx } from '../ui';
import { PageHeader } from '../ListPage';

const NEXT: Record<string, string | null> = { '': 'P', P: 'A', A: 'L', L: null };
const TONE: Record<string, string> = { P: 'bg-goodBg text-goodText', A: 'bg-badBg text-badText', L: 'bg-warnBg text-warnText', '': 'bg-surface2 text-muted' };
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export function Attendance() {
  const s = useSession();
  const canWrite = s.can('attendance', 'w');
  const [batch, setBatch] = useState(s.refs.batch[0]?.id || '');
  const [people, setPeople] = useState<Row[]>([]);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // the last six class days, ending today (Sundays skipped)
  const days = useMemo(() => {
    const out: Date[] = []; const d = new Date();
    while (out.length < 6) { if (d.getDay() !== 0) out.unshift(new Date(d)); d.setDate(d.getDate() - 1); }
    return out;
  }, []);

  const load = useCallback(async () => {
    if (!batch) return;
    const db = supabase();
    const [c, a] = await Promise.all([
      db.from('candidate').select('id,full_name').eq('batch_id', batch).order('full_name'),
      db.from('attendance').select('candidate_id,day,mark').eq('batch_id', batch).gte('day', iso(days[0])),
    ]);
    setPeople(c.data || []);
    setMarks(Object.fromEntries((a.data || []).map((r: Row) => [r.candidate_id + '|' + r.day, r.mark])));
  }, [batch, days]);
  useEffect(() => { load(); }, [load]);

  const tap = async (cid: string, day: string) => {
    if (!canWrite) return;
    const key = cid + '|' + day, next = NEXT[marks[key] || ''];
    setMarks((m) => { const n = { ...m }; if (next) n[key] = next; else delete n[key]; return n; });
    const db = supabase();
    const { error } = next
      ? await db.from('attendance').upsert({ batch_id: batch, candidate_id: cid, day, mark: next, marked_by: s.staff.id }, { onConflict: 'candidate_id,day' })
      : await db.from('attendance').delete().eq('candidate_id', cid).eq('day', day);
    setError(error ? error.message : null);
    if (error) load();
  };

  const pct = (cid: string) => { const m = days.map((d) => marks[cid + '|' + iso(d)]).filter(Boolean); return m.length ? Math.round((100 * m.filter((x) => x === 'P').length) / m.length) + '%' : '—'; };

  return (
    <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
      <PageHeader group="Training" title="Attendance" purpose="Daily register per batch. Tap a cell to mark Present, Absent or Late." scope={s.staff.role + (canWrite ? ' · can edit' : ' · view only')}>
        <label className="flex items-center gap-2 text-[13px] font-medium text-text2">Batch
          <select className="h-11 px-3 text-sm" value={batch} onChange={(e) => setBatch(e.target.value)}>{s.refs.batch.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
        </label>
      </PageHeader>
      {error && <Notice tone="bad">{error}</Notice>}
      {people.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-8 text-center text-text2">No candidates are in this batch yet. Assign a batch from Candidates.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-surface2 text-xs text-text2">
                <th className="px-4 py-3 text-left font-semibold">Student</th>
                {days.map((d) => <th key={iso(d)} className="px-2 py-3 text-center font-semibold">{d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })}</th>)}
                <th className="px-4 py-3 text-right font-semibold">Present</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="px-4 py-2.5 font-medium">{p.full_name}</td>
                  {days.map((d) => {
                    const m = marks[p.id + '|' + iso(d)] || '';
                    return (
                      <td key={iso(d)} className="px-2 py-2 text-center">
                        <button type="button" disabled={!canWrite} aria-label={`${p.full_name}, ${d.toDateString()}: ${m || 'not marked'}`} onClick={() => tap(p.id, iso(d))}
                          className={cx('inline-flex h-9 w-9 items-center justify-center rounded-lg text-[13px] font-semibold', TONE[m])}>{m || '·'}</button>
                      </td>
                    );
                  })}
                  <td className="num px-4 py-2.5 text-right font-medium">{pct(p.id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">P present · A absent · L late. Each tap saves on its own. Tapping L again clears the cell.</p>
    </main>
  );
}
