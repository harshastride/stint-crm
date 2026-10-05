'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';

/**
 * The paper checklist for one job. The list is built from the job's own dates:
 * payslips for the months worked and one Form 16 line per financial year (April to March) covered.
 * Experience and relieving letters only become due after the last working day.
 */
export function expectedPapers(joined: string | null, last: string | null): { paper: string; def: string }[] {
  const out = [{ paper: 'Offer letter', def: 'Requested' }];
  if (!joined) return out;
  const j = new Date(joined), now = new Date(), end = last ? new Date(last) : now;
  if (isNaN(j.getTime()) || j > end) return out;
  const months = (end.getFullYear() - j.getFullYear()) * 12 + end.getMonth() - j.getMonth() + 1;
  out.push({ paper: `Payslips (${months} months)`, def: 'Requested' });
  const fy = (d: Date) => (d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1);
  for (let y = fy(j); y <= fy(end); y++) {
    const yearOver = new Date(y + 1, 3, 1) <= now; // the financial year has ended
    out.push({ paper: `Form 16 · FY ${y}-${String(y + 1).slice(2)}`, def: yearOver ? 'Requested' : 'Not due yet' });
  }
  out.push({ paper: 'Experience letter', def: last ? 'Requested' : 'Not due yet' }, { paper: 'Relieving letter', def: last ? 'Requested' : 'Not due yet' });
  return out;
}

export function JobPapers({ job, canWrite }: { job: Row; canWrite: boolean }) {
  const s = useSession();
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const papers = useMemo(() => expectedPapers(job.joined_on, job.last_working_day), [job.joined_on, job.last_working_day]);
  const key = (p: string) => p.replace(/ \(\d+ months\)/, '');

  useEffect(() => {
    supabase().from('job_paper').select('paper,status').eq('job_record_id', job.id).then(({ data }: { data: Row[] | null }) => {
      setSaved(Object.fromEntries((data || []).map((d) => [d.paper, d.status])));
    });
  }, [job.id]);

  const setStatus = async (paper: string, status: string) => {
    setSaved((old) => ({ ...old, [paper]: status }));
    const { error } = await supabase().from('job_paper').upsert({ job_record_id: job.id, paper, status, updated_at: new Date().toISOString() });
    setError(error ? error.message : null);
  };
  const got = papers.filter((p) => ['Received', 'Verified'].includes(saved[key(p.paper)] || p.def)).length;

  return (
    <div className="flex flex-col gap-1 rounded-control bg-surface2 p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Papers</div>
        <div className="num text-xs font-semibold text-text2">{got} of {papers.length} received</div>
      </div>
      {papers.map((p) => (
        <label key={p.paper} className="flex min-h-[44px] items-center justify-between gap-2 text-[13px]">
          <span className="min-w-0 truncate" title={p.paper}>{p.paper}</span>
          <select className="h-9 w-[150px] shrink-0 px-2 text-[13px]" disabled={!canWrite} value={saved[key(p.paper)] || p.def} onChange={(e) => setStatus(key(p.paper), e.target.value)}>
            {(s.lists.paper_status || []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      ))}
      <div className="text-xs leading-snug text-muted">The list follows the joining date and last working day. Each change saves on its own.</div>
      {error && <div className="text-xs text-badText">{error}</div>}
    </div>
  );
}
