'use client';
import { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Row } from '@/lib/pages';
import { PageHeader } from '../kit/PageHeader';
import { EmptyState } from '../kit/EmptyState';
import { Confirm } from '../kit/Confirm';
import { Table, THead, TBody, Th, Td, Tr } from '../kit/Table';
import { Notice } from '../ui';
import { friendlyError } from '../Fields';
import { useToast } from '../Toasts';

// Admin: everything that was deleted, one line per delete action, with Restore. Rows come from recycle_groups
// (Admin-only); restore_deleted puts the whole group back (the record and the linked rows removed with it).
const nice = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const when = (v: string) => new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
// the records people think of as "a record"; the rest (attendance marks, settings rows…) only under "Everything"
const MAIN = ['lead', 'candidate', 'fee_payment', 'fee_plan', 'fee_quote', 'placement', 'follow_up', 'note', 'call_log', 'counselling_session',
  'mock_session', 'sme_feedback', 'resume_version', 'candidate_document', 'batch', 'program', 'company', 'staff', 'job_record', 'training_note', 'announcement'];
const label = (r: Row) => r.row_label || `A ${nice(r.table_name).toLowerCase()} entry`;
const field = 'h-11 min-w-0 rounded-[10px] border border-line2 bg-surface px-2.5 text-[13px] md:h-9';

export function RecycleBin() {
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [staff, setStaff] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'bin' | 'restored'>('bin');
  const [scope, setScope] = useState<'main' | 'all'>('main');
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    let x = supabase().from('recycle_groups').select('*').order('deleted_at', { ascending: false }).limit(300);
    x = show === 'bin' ? x.is('restored_at', null) : x.not('restored_at', 'is', null);
    if (q.trim()) x = x.ilike('row_label', `%${q.trim()}%`);
    if (scope === 'main') x = x.in('table_name', MAIN);
    const { data, error } = await x;
    setErr(error ? friendlyError(error) : '');
    setRows(data || []);
  }, [q, show, scope]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { supabase().from('staff').select('id,full_name').then(({ data }) => setStaff(Object.fromEntries((data || []).map((s: Row) => [s.id, s.full_name])))); }, []);

  const restore = async (r: Row) => {
    setBusy(r.grp);
    const { data, error } = await supabase().rpc('restore_deleted', { p_grp: r.grp });
    setBusy(null);
    if (error) { toast(error.message, { tone: 'bad' }); return; }
    toast(`Restored ${label(r)}${data > 1 ? ` with ${data - 1} linked record${data > 2 ? 's' : ''}` : ''}.`);
    load();
  };

  const alsoText = (r: Row) => `${r.rows - 1} linked: ${Object.keys(r.also || {}).map(nice).join(', ')}`;
  const action = (r: Row) => r.restored_at ? <span className="text-[12.5px] text-goodText">Restored {when(r.restored_at)}</span> : (
    <Confirm disabled={busy === r.grp} onYes={() => restore(r)} danger={false} yes="Restore" title={`Restore ${label(r)}?`} align="left"
      body={r.rows > 1 ? `It comes back with the ${r.rows - 1} linked record${r.rows > 2 ? 's' : ''} deleted with it.` : 'It comes back exactly as it was.'}
      className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-line2 bg-surface px-3 text-[13px] font-medium text-accentText hover:bg-surface2 disabled:opacity-50">
      <RotateCcw size={14} aria-hidden />{busy === r.grp ? 'Restoring…' : 'Restore'}
    </Confirm>
  );

  return (
    <main className="flex flex-1 flex-col gap-3 overflow-y-auto p-4 md:px-6 md:py-4">
      <PageHeader title="Recycle bin" description="Everything deleted in the CRM, newest first. Restore puts the record back with what was removed along with it. Kept for 1 year."
        filters={
          <div className="flex flex-wrap items-center gap-1.5">
            <input aria-label="Search deleted records" placeholder="Name or title" className={field + ' w-48'} value={q} onChange={(e) => setQ(e.target.value)} />
            <select aria-label="Show" className={field} value={show} onChange={(e) => setShow(e.target.value as 'bin' | 'restored')}>
              <option value="bin">In the bin</option><option value="restored">Already restored</option>
            </select>
            <select aria-label="Which records" className={field} value={scope} onChange={(e) => setScope(e.target.value as 'main' | 'all')}>
              <option value="main">Main records</option><option value="all">Everything (incl. attendance, settings)</option>
            </select>
          </div>
        } />
      {err && <Notice tone="bad">{err}</Notice>}
      {rows === null ? <div className="rounded-[14px] bg-surface p-6 text-muted shadow-[var(--shadow-1)]">Loading…</div>
        : rows.length === 0 ? <EmptyState kind="done" title={show === 'bin' ? 'The bin is empty' : 'Nothing restored yet'} body={q ? 'Nothing matches this search.' : show === 'bin' ? 'Deleted records appear here and can be restored for a year.' : undefined} />
        : (
          <>
            <ul className="flex flex-col gap-2 md:hidden" aria-label="Deleted records">
              {rows.map((r) => (
                <li key={r.grp} data-testid="bin-row" className="rounded-[12px] bg-surface p-3 shadow-[var(--shadow-1)]">
                  <div className="font-medium">{label(r)}</div>
                  <div className="text-[12.5px] text-muted">{nice(r.table_name)} · {staff[r.deleted_by] || (r.deleted_by ? 'Someone' : 'System')} · {when(r.deleted_at)}</div>
                  {r.rows > 1 && <div className="mt-1 text-[12.5px] text-text2">{alsoText(r)}</div>}
                  <div className="mt-2">{action(r)}</div>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table label="Deleted records">
                <THead><Th>Deleted</Th><Th className="w-32" /><Th>Also removed with it</Th><Th>By</Th><Th>When</Th></THead>
                <TBody>
                  {rows.map((r) => (
                    <Tr key={r.grp} data-testid="bin-row">
                      <Td><div className="py-1.5"><div className="font-medium">{label(r)}</div><div className="text-[12px] text-muted">{nice(r.table_name)}</div></div></Td>
                      <Td>{action(r)}</Td>
                      <Td className="max-w-[280px] truncate text-text2" title={alsoText(r)}>{r.rows > 1 ? alsoText(r) : '—'}</Td>
                      <Td className="text-text2">{staff[r.deleted_by] || (r.deleted_by ? 'Someone' : 'System')}</Td>
                      <Td className="whitespace-nowrap text-text2">{when(r.deleted_at)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          </>
        )}
    </main>
  );
}
