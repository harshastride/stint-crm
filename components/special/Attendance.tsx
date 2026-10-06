'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { Button, Notice, cx } from '../ui';
import { PageHeader } from '../kit/PageHeader';
import { CheckinScreen } from './CheckinScreen';

// Trainer's class register: "my batch, today". Mark all present, fix the exceptions, save once.
// Marks are kept on the device until the save succeeds, so a lost connection never loses a register.
type Mark = 'P' | 'A' | 'L';
const LABEL: Record<Mark, string> = { P: 'Present', A: 'Absent', L: 'Late' };
const ON: Record<Mark, string> = { P: 'bg-goodBg text-goodText ring-2 ring-goodText/40', A: 'bg-badBg text-badText ring-2 ring-badText/40', L: 'bg-warnBg text-warnText ring-2 ring-warnText/40' };
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const shift = (day: string, n: number) => { const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const draftKey = (batch: string, day: string) => `stint-att-draft:${batch}:${day}`;
const readDraft = (k: string): Record<string, Mark | ''> | null => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
const writeDraft = (k: string, v: Record<string, Mark | ''> | null) => { try { if (v) localStorage.setItem(k, JSON.stringify(v)); else localStorage.removeItem(k); } catch { /* storage off */ } };

export function Attendance() {
  const s = useSession();
  const canWrite = s.can('attendance', 'w');
  const today = iso(new Date());
  const [batches, setBatches] = useState<Row[]>([]);
  const [batch, setBatch] = useState('');
  const [day, setDay] = useState(today);
  const [people, setPeople] = useState<Row[]>([]);
  const [standing, setStanding] = useState<Record<string, Row>>({});
  const [saved, setSaved] = useState<Record<string, Mark>>({});
  const [draft, setDraft] = useState<Record<string, Mark | ''>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad' | 'warn'; text: string } | null>(null);
  const savingRef = useRef(false);
  const [qr, setQr] = useState(false);

  // batches: the trainer's own first, then the rest
  useEffect(() => {
    supabase().from('batch').select('id,code,trainer_id,status').order('code').then(({ data }) => {
      const mine = (data || []).filter((b: Row) => b.trainer_id === s.staff.id);
      const list = [...mine, ...(data || []).filter((b: Row) => b.trainer_id !== s.staff.id)];
      setBatches(list);
      setBatch((cur) => cur || list[0]?.id || '');
    });
  }, [s.staff.id]);

  const load = useCallback(async () => {
    if (!batch) return;
    const db = supabase();
    const [c, a, st] = await Promise.all([
      db.from('candidate').select('id,full_name').eq('batch_id', batch).order('full_name'),
      db.from('attendance').select('candidate_id,mark').eq('batch_id', batch).eq('day', day),
      db.from('attendance_standing').select('candidate_id,sessions_held,sessions_attended,min_pct').eq('batch_id', batch),
    ]);
    setPeople(c.data || []);
    setSaved(Object.fromEntries((a.data || []).map((r: Row) => [r.candidate_id, r.mark])));
    setStanding(Object.fromEntries((st.data || []).map((r: Row) => [r.candidate_id, r])));
    const kept = readDraft(draftKey(batch, day));
    setDraft(kept || {});
    setMsg(kept ? { tone: 'warn', text: 'Unsaved marks from earlier are kept on this phone. Tap Save register to send them.' } : null);
  }, [batch, day]);
  useEffect(() => { load(); }, [load]);

  const current = (cid: string): Mark | '' => (cid in draft ? draft[cid] : saved[cid] || '');
  const changes = useMemo(() => Object.entries(draft).filter(([cid, m]) => (saved[cid] || '') !== m), [draft, saved]);
  const update = (next: Record<string, Mark | ''>) => { setDraft(next); writeDraft(draftKey(batch, day), Object.keys(next).length ? next : null); };
  const tap = (cid: string, m: Mark) => { if (!canWrite || saving) return; update({ ...draft, [cid]: current(cid) === m ? '' : m }); };
  const allPresent = () => { const n = { ...draft }; people.forEach((p) => { if (!current(p.id)) n[p.id] = 'P'; }); update(n); };

  const save = useCallback(async () => {
    if (savingRef.current || !changes.length) return; // one save at a time: no double submission
    savingRef.current = true; setSaving(true); setMsg(null);
    const db = supabase();
    const ups = changes.filter(([, m]) => m).map(([cid, m]) => ({ batch_id: batch, candidate_id: cid, day, mark: m, marked_by: s.staff.id }));
    const dels = changes.filter(([, m]) => !m).map(([cid]) => cid);
    const r1 = ups.length ? await db.from('attendance').upsert(ups, { onConflict: 'candidate_id,day' }) : { error: null };
    const r2 = !r1.error && dels.length ? await db.from('attendance').delete().eq('day', day).in('candidate_id', dels) : { error: null };
    const err = r1.error || r2.error;
    savingRef.current = false; setSaving(false);
    if (err) { setMsg({ tone: 'bad', text: 'Not saved: ' + err.message + '. Your marks are kept on this phone. Tap Save register to try again.' }); return; }
    writeDraft(draftKey(batch, day), null);
    await load();
    setMsg({ tone: 'good', text: `Saved ${ups.length + dels.length} mark${ups.length + dels.length === 1 ? '' : 's'}.` });
  }, [changes, batch, day, s.staff.id, load]);

  // retry automatically when the connection comes back
  useEffect(() => { const on = () => { if (changes.length) save(); }; window.addEventListener('online', on); return () => window.removeEventListener('online', on); }, [changes.length, save]);

  const pctOf = (cid: string) => { const r = standing[cid]; return r && r.sessions_held ? Math.round((100 * r.sessions_attended) / r.sessions_held) : null; };
  const minPct = Number(Object.values(standing)[0]?.min_pct ?? 75);
  const behind = people.filter((p) => { const v = pctOf(p.id); return v !== null && v < minPct; });
  const counts = people.reduce((a, p) => { const m = current(p.id); a[m || 'none']++; return a; }, { P: 0, A: 0, L: 0, none: 0 } as Record<string, number>);
  const batchLabel = batches.find((b) => b.id === batch)?.code || '';
  const mineIds = new Set(batches.filter((b) => b.trainer_id === s.staff.id).map((b) => b.id));

  return (
    <main className="flex flex-1 flex-col gap-5 overflow-y-auto p-4 pb-0 md:p-6 md:pb-0">
      <PageHeader title="Attendance" description={canWrite ? 'Mark all present, then tap the few who are absent or late. Save once.' : 'View only for ' + s.staff.role + '.'}
        filters={<>
          <label className="flex min-w-0 flex-1 items-center gap-2 text-[13px] font-medium text-text2 sm:flex-none">Batch
            <select aria-label="Batch" className="h-11 min-w-0 flex-1 rounded-[10px] px-3 text-[13.5px] sm:w-[220px]" value={batch} onChange={(e) => setBatch(e.target.value)}>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.code}{mineIds.has(b.id) ? ' (mine)' : ''}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-1" role="group" aria-label="Choose day">
            <Button variant="quiet" aria-label="Previous day" onClick={() => setDay(shift(day, -1))}>‹</Button>
            <input type="date" aria-label="Class day" className="h-11 rounded-[10px] px-2 text-[13.5px]" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} />
            <Button variant="quiet" aria-label="Next day" disabled={day >= today} onClick={() => setDay(shift(day, 1))}>›</Button>
            {day !== today && <Button variant="link" onClick={() => setDay(today)}>Today</Button>}
          </div>
          {canWrite && batch && day === today && (s.staff.role === 'Admin' || mineIds.has(batch)) && <Button variant="secondary" onClick={() => setQr(true)}>Show check-in QR</Button>}
        </>} />

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {qr && <CheckinScreen batchId={batch} batchCode={batchLabel} onClose={() => { setQr(false); load(); }} />}

      {behind.length > 0 && (
        <section aria-label="Falling behind" className="rounded-card bg-badBg/50 p-card">
          <h2 className="text-[13.5px] font-semibold text-badText">Falling behind in {batchLabel}: {behind.length} below {minPct}%</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {behind.map((p) => <li key={p.id}><a href={`/candidate/${p.id}`} className="inline-flex min-h-[44px] items-center rounded-lg bg-surface px-3 text-[13px] font-medium">{p.full_name} · {pctOf(p.id)}%</a></li>)}
          </ul>
        </section>
      )}

      {people.length === 0 ? (
        <div className="rounded-[14px] bg-surface2 p-8 text-center text-[13.5px] text-text2">No students are in this batch yet. Assign a batch from Candidates.</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-text2" aria-live="polite"><span className="font-semibold text-goodText">{counts.P} present</span> · <span className="font-semibold text-badText">{counts.A} absent</span> · <span className="font-semibold text-warnText">{counts.L} late</span>{counts.none ? ` · ${counts.none} not marked` : ''}</p>
            {canWrite && counts.none > 0 && <Button variant="secondary" size="lg" onClick={allPresent} disabled={saving}>Mark all present</Button>}
          </div>
          <ul className="flex flex-col gap-2" aria-label="Register">
            {people.map((p) => {
              const m = current(p.id), v = pctOf(p.id), st = standing[p.id], low = v !== null && v < minPct, dirty = p.id in draft && (saved[p.id] || '') !== m;
              return (
                <li key={p.id} className={cx('flex flex-col gap-2 rounded-card bg-surface p-3 shadow-1 sm:flex-row sm:items-center', dirty && 'ring-1 ring-accent/50')}>
                  <div className="min-w-0 flex-1">
                    <a href={`/candidate/${p.id}`} className="block truncate text-[14.5px] font-medium">{p.full_name}</a>
                    <div className={cx('text-xs', low ? 'font-semibold text-badText' : 'text-muted')} title="Sessions attended (present or late) ÷ sessions held since joining">
                      {v === null ? 'No sessions yet' : `${v}% · ${st.sessions_attended} of ${st.sessions_held} sessions${low ? ' · below ' + minPct + '%' : ''}`}{dirty ? ' · not saved' : ''}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:w-[300px]" role="group" aria-label={`${p.full_name} mark`}>
                    {(['P', 'A', 'L'] as Mark[]).map((k) => (
                      <button key={k} type="button" disabled={!canWrite || saving} aria-pressed={m === k} onClick={() => tap(p.id, k)}
                        className={cx('h-12 rounded-[10px] text-[13.5px] font-semibold transition-transform duration-100 active:scale-[0.97] disabled:cursor-default', m === k ? ON[k] : 'bg-surface2 text-text2')}>{LABEL[k]}</button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted">Attendance % = sessions attended (present or late) ÷ sessions held since the student joined. A session counts as held when anyone in the batch was marked that day. Below {minPct}% is flagged.</p>
        </>
      )}

      {canWrite && people.length > 0 && (
        <div className="sticky bottom-0 z-20 -mx-4 mt-auto flex items-center gap-3 border-t border-line bg-surface px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 md:-mx-6 md:px-6">
          <span className="min-w-0 flex-1 text-[13px] text-text2" aria-live="polite">{changes.length ? `${changes.length} change${changes.length === 1 ? '' : 's'} not saved` : 'All saved'}</span>
          <Button variant="primary" size="lg" loading={saving} disabled={!changes.length || saving} onClick={save}>Save register</Button>
        </div>
      )}
    </main>
  );
}
