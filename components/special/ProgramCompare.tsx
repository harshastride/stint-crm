'use client';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { money } from '../ui';

type Stat = { program_id: string; name: string; fee: number | null; duration_weeks: number | null; enrolled: number; placed: number; placement_rate: number; avg_ctc_lpa: number | null };

// Side-by-side program comparison for counselling. Numbers come from program_stats() (aggregates only).
export function ProgramCompare() {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<Stat[]>([]);
  const [pick, setPick] = useState<string[]>([]);
  const progs = s.refs.program || [];
  useEffect(() => {
    if (!open || stats.length) return;
    supabase().rpc('program_stats').then(({ data }: { data: unknown }) => setStats((data as Stat[]) || []));
  }, [open, stats.length]);
  useEffect(() => { if (!pick.length && progs.length) setPick(progs.slice(0, 2).map((p) => p.id)); }, [progs, pick.length]);
  const cols = pick.map((id) => { const p = progs.find((x) => x.id === id); const st = stats.find((x) => x.program_id === id); return { id, label: p?.label || st?.name || '', fee: (p?.extra?.fee as number) ?? st?.fee, st }; });
  const rows: [string, (c: (typeof cols)[number]) => string][] = [
    ['Fee', (c) => (c.fee != null ? money(c.fee) : '—')],
    ['Duration', (c) => (c.st?.duration_weeks ? c.st.duration_weeks + ' weeks' : '—')],
    ['Students enrolled', (c) => String(c.st?.enrolled ?? '—')],
    ['Placed', (c) => String(c.st?.placed ?? '—')],
    ['Placement rate', (c) => (c.st ? c.st.placement_rate + '%' : '—')],
    ['Average salary', (c) => (c.st?.avg_ctc_lpa ? c.st.avg_ctc_lpa + ' LPA' : '—')],
  ];
  return (
    <section className="mb-4 rounded-[14px] border border-line bg-surface">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-[44px] w-full items-center justify-between px-4 text-[14px] font-semibold">
        Compare programs {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {open && (
        <div className="border-t border-line p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {[0, 1, 2].map((i) => (
              <select key={i} aria-label={`Program ${i + 1}`} value={pick[i] || ''} className="min-h-[44px] rounded-[10px] border border-line bg-surface2 px-3 text-[13px]"
                onChange={(e) => { const n = [...pick]; if (e.target.value) n[i] = e.target.value; else n.splice(i, 1); setPick(n.filter(Boolean)); }}>
                <option value="">{i < 2 ? 'Choose program' : 'Add a third (optional)'}</option>
                {progs.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" aria-label="Program comparison">
              <thead><tr><th className="py-2 pr-3 text-left font-medium text-muted"> </th>{cols.map((c) => <th key={c.id} scope="col" className="py-2 pr-3 text-left font-semibold">{c.label}</th>)}</tr></thead>
              <tbody>{rows.map(([label, f]) => (
                <tr key={label} className="border-t border-line"><th scope="row" className="py-2 pr-3 text-left font-medium text-text2">{label}</th>{cols.map((c) => <td key={c.id} className="num py-2 pr-3">{f(c)}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
