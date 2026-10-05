'use client';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Row } from '@/lib/pages';
import { PageHeader } from '../kit/PageHeader';
import { EmptyState } from '../kit/EmptyState';
import { Table, THead, TBody, Th, Td, Tr } from '../kit/Table';
import { Button, IconButton, Notice } from '../ui';
import { friendlyError } from '../Fields';

const nice = (s: string) => s.replace(/_id$/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const val = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const when = (v: string) => new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

/** One line in plain words: "Anita changed Stage New → Interested on lead Karthik T". */
export function auditSentence(r: Row) {
  const who = (r.actor_name as string)?.split(' ')[0] || (r.actor_role === 'system' ? 'System' : 'Someone');
  const on = `${nice(r.table_name)}${r.row_label ? ' ' + r.row_label : ''}`.replace(/^./, (c) => c.toLowerCase());
  if (r.action === 'INSERT') return `${who} added ${on}`;
  if (r.action === 'DELETE') return `${who} removed ${on}`;
  const keys = Object.keys(r.changed || {});
  if (!keys.length) return `${who} changed ${on}`;
  const k = keys[0], c = r.changed[k];
  return `${who} changed ${nice(k)} ${val(c.old)} → ${val(c.new)}${keys.length > 1 ? ` (+${keys.length - 1} more)` : ''} on ${on}`;
}

const field = 'h-11 rounded-[10px] border border-line2 bg-surface px-3 text-sm';

/** Admin: who changed what, when. Read-only; rows can never be edited or removed. */
export function AuditLog() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [staff, setStaff] = useState<Row[]>([]);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [f, setF] = useState({ person: '', table: '', actor: '', from: '', to: '' });

  const load = useCallback(async () => {
    let q = supabase().from('audit_feed').select('*').order('at', { ascending: false }).limit(500);
    if (f.person) q = q.ilike('row_label', `%${f.person}%`);
    if (f.table) q = q.eq('table_name', f.table);
    if (f.actor === 'system') q = q.is('actor', null); else if (f.actor) q = q.eq('actor', f.actor);
    if (f.from) q = q.gte('at', new Date(f.from + 'T00:00:00+05:30').toISOString());
    if (f.to) q = q.lt('at', new Date(new Date(f.to + 'T00:00:00+05:30').getTime() + 864e5).toISOString());
    const { data, error } = await q;
    if (error) setErr(friendlyError(error)); else setErr('');
    setRows(data || []);
  }, [f]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { supabase().from('staff').select('id,full_name').order('full_name').then(({ data }) => setStaff(data || [])); }, []);

  const tables = useMemo(() => Array.from(new Set(['lead', 'candidate', 'candidate_private', 'follow_up', 'fee_payment', 'placement', 'staff', ...(rows || []).map((r) => r.table_name)])).sort(), [rows]);

  const csv = () => {
    const esc = (s: unknown) => '"' + String(s ?? '').replace(/"/g, '""') + '"';
    const lines = [['When', 'Who', 'Role', 'Action', 'Table', 'Record', 'Summary', 'Changes', 'IP'].map(esc).join(',')]
      .concat((rows || []).map((r) => [r.at, r.actor_name || 'System', r.actor_role, r.action, r.table_name, r.row_label || r.row_id, auditSentence(r), JSON.stringify(r.changed), r.ip].map(esc).join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <PageHeader title="Audit log" description="Every add, change and removal, newest first. Private details show as [changed]. Kept for 2 years; nobody can edit it."
        actions={<Button variant="outline" leftIcon={<Download size={16} />} onClick={csv} disabled={!rows?.length}>Export CSV</Button>}
        filters={
          <div className="flex flex-wrap gap-2">
            <input aria-label="Person or record" placeholder="Person or record" className={field} value={f.person} onChange={set('person')} />
            <select aria-label="Table" className={field} value={f.table} onChange={set('table')}>
              <option value="">All tables</option>{tables.map((t) => <option key={t} value={t}>{nice(t)}</option>)}
            </select>
            <select aria-label="Changed by" className={field} value={f.actor} onChange={set('actor')}>
              <option value="">Anyone</option><option value="system">System</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
            <input aria-label="From date" type="date" className={field} value={f.from} onChange={set('from')} />
            <input aria-label="To date" type="date" className={field} value={f.to} onChange={set('to')} />
          </div>
        } />
      {err && <Notice tone="bad">{err}</Notice>}
      {rows === null ? <div className="rounded-[14px] bg-surface p-6 text-muted shadow-[var(--shadow-1)]">Loading…</div>
        : rows.length === 0 ? <EmptyState kind="done" title="Nothing found" body="No changes match these filters." />
        : (
          <Table label="Audit log">
            <THead><Th className="w-12" /><Th>What happened</Th><Th>Role</Th><Th>When</Th></THead>
            <TBody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <Tr data-testid="audit-row" onOpen={() => setOpen(open === r.id ? null : r.id)}>
                    <Td><IconButton size="icon-sm" aria-label={open === r.id ? 'Hide details' : 'Show details'} icon={open === r.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />} onClick={(e) => { e.stopPropagation(); setOpen(open === r.id ? null : r.id); }} /></Td>
                    <Td>{auditSentence(r)}</Td>
                    <Td className="text-text2">{r.actor_role}</Td>
                    <Td className="whitespace-nowrap text-text2">{when(r.at)}</Td>
                  </Tr>
                  {open === r.id && (
                    <tr data-testid="audit-diff"><td colSpan={4} className="bg-surface2 px-4 py-3 text-[13px]">
                      <dl className="grid grid-cols-[minmax(120px,auto)_1fr] gap-x-4 gap-y-1">
                        {Object.entries(r.changed || {}).map(([k, c]: [string, any]) => (
                          <Fragment key={k}><dt className="font-medium">{nice(k)}</dt><dd className="break-all"><span className="text-text2 line-through">{val(c.old)}</span> → <span>{val(c.new)}</span></dd></Fragment>
                        ))}
                      </dl>
                      <div className="mt-2 text-[12px] text-muted">{r.table_name} · {r.row_id}{r.ip ? ' · ' + r.ip : ''}{r.user_agent ? ' · ' + r.user_agent : ''}</div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </TBody>
          </Table>
        )}
    </main>
  );
}
