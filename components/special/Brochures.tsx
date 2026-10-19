'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Eye, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { PageHeader } from '../kit/PageHeader';
import { EmptyState } from '../kit/EmptyState';
import { Confirm } from '../kit/Confirm';
import { Table, THead, TBody, Th, Td, Tr } from '../kit/Table';
import { useFilePreview } from '../kit/FilePreview';
import { DropZone } from '../DropZone';
import { friendlyError } from '../Fields';
import { useToast } from '../Toasts';
import { Button, Notice, Pill, cx } from '../ui';
import { istWhen, openedLine, readTime } from '../panel/BrochureCard';
import { Chip } from '../panel/RailCard';

// Brochures page: the course PDFs staff send to leads as a private link, and who has opened them recently.
// Writers (Admin by default) upload and switch brochures on or off; Telecaller, Sales, Front desk and Marketing can view.
// Counts are all time, over the leads the viewer can see. Times are India time.

const BUCKET = 'brochures';
const field = 'h-11 min-w-0 rounded-[10px] border border-line2 bg-surface px-2.5 text-[13px] text-text md:h-9';
const safeName = (n: string) => (n.replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9 ._()-]+/g, '_').replace(/\.{2,}/g, '.').trim().slice(0, 100) || 'brochure') + '.pdf';

export function Brochures() {
  const s = useSession();
  const toast = useToast();
  const preview = useFilePreview();
  const canWrite = s.can('brochures', 'w');
  const programs = s.refs.program || [];
  const [rows, setRows] = useState<Row[] | null>(null);
  const [opens, setOpens] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [program, setProgram] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const db = supabase();
    const [b, o] = await Promise.all([
      db.from('brochure_summary').select('*').order('status').order('title'),
      db.from('brochure_send_list').select('id, lead_id, lead_name, brochure_title, open_count, total_seconds, pages_seen, last_opened_at, reading_now, sent_by_name')
        .not('last_opened_at', 'is', null).order('last_opened_at', { ascending: false }).limit(30),
    ]);
    setErr(b.error ? friendlyError(b.error, 'brochures', 'Could not load the brochures. Please try again.') : o.error ? friendlyError(o.error, 'brochures', 'Could not load recent opens.') : '');
    setRows(b.data || []); setOpens(o.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  // keep "Recent opens" and "Reading now" fresh while the page is open and visible
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60_000); return () => clearInterval(t); }, [load]);

  const reset = () => { setAdding(false); setTitle(''); setProgram(''); setFile(null); };

  const save = async () => {
    if (!title.trim() || !file || saving) return;
    setSaving(true); setErr('');
    const db = supabase();
    const path = `${crypto.randomUUID()}/${safeName(file.name)}`;
    const up = await db.storage.from(BUCKET).upload(path, file, { contentType: 'application/pdf' });
    if (up.error) {
      setSaving(false);
      setErr(/row-level|security|403|Unauthorized/i.test(up.error.message) ? 'Your role can’t upload brochures.' : friendlyError(up.error, 'brochures', 'Could not upload the PDF. Please try again.'));
      return;
    }
    const ins = await db.from('brochure').insert({ title: title.trim(), program_id: program || null, file_path: path, status: 'Live' });
    setSaving(false);
    if (ins.error) { await db.storage.from(BUCKET).remove([path]); setErr(friendlyError(ins.error, 'brochures', 'Could not save the brochure. Please try again.')); return; }
    toast(`Added “${title.trim()}”. Staff can send it now.`);
    reset(); load();
  };

  const setStatus = async (r: Row, status: 'Live' | 'Off') => {
    setBusyId(r.id);
    const { error } = await supabase().from('brochure').update({ status }).eq('id', r.id);
    setBusyId(null);
    if (error) { toast(friendlyError(error, 'brochures'), { tone: 'bad' }); return; }
    toast(status === 'Off' ? `“${r.title}” is off. Links already sent stop working.` : `“${r.title}” is live again.`);
    load();
  };

  const remove = async (r: Row) => {
    setBusyId(r.id);
    const { error } = await supabase().from('brochure').delete().eq('id', r.id);
    setBusyId(null);
    if (error) { toast(friendlyError(error, 'brochures'), { tone: 'bad' }); return; }
    toast(`Deleted “${r.title}”. An admin can restore it from the Recycle bin.`);
    load();
  };

  const show = (r: Row) => preview.open({
    title: r.title, fileName: String(r.file_path || '').split('/').pop() || 'brochure.pdf', kind: 'pdf',
    getUrl: async () => {
      const { data, error } = await supabase().storage.from(BUCKET).createSignedUrl(r.file_path, 60);
      if (error || !data) throw new Error('sign');
      return data.signedUrl;
    },
  });

  const course = (r: Row) => r.program_name || 'All courses';
  const counts = (r: Row) => (r.sends ? `${r.opened} of ${r.sends} opened` : 'Not sent yet');
  const actions = (r: Row) => (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {canWrite && r.file_path && <Button size="sm" variant="quiet" className="h-11 md:h-8" onClick={() => show(r)} leftIcon={<Eye size={14} />}>Preview</Button>}
      {canWrite && (
        <select aria-label={`Status of ${r.title}`} className={cx(field, 'md:h-8')} value={r.status} disabled={busyId === r.id} onChange={(e) => setStatus(r, e.target.value as 'Live' | 'Off')}>
          <option value="Live">Live</option><option value="Off">Off</option>
        </select>
      )}
      {canWrite && Number(r.sends) === 0 && (
        <Confirm onYes={() => remove(r)} title={`Delete “${r.title}”?`} body="It has not been sent to anyone. An admin can restore it from the Recycle bin." yes="Delete" ariaLabel={`Delete ${r.title}`}
          disabled={busyId === r.id} className="btn flex h-11 w-11 items-center justify-center rounded-lg text-text2 hover:bg-badBg hover:text-badText md:h-8 md:w-8">
          <Trash2 size={15} aria-hidden />
        </Confirm>
      )}
    </div>
  );

  return (
    <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:px-6 md:py-4">
      <PageHeader title="Brochures" group="Sales"
        description="Course PDFs staff send to a lead as a private link from the lead panel. Each link records opens, pages read and minutes, and alerts the lead’s owner when it is opened."
        actions={canWrite && !adding ? <Button variant="primary" className="h-11 md:h-10" onClick={() => setAdding(true)} leftIcon={<Plus size={16} />}>Add brochure</Button> : undefined} />
      {err && <Notice tone="bad">{err}</Notice>}

      {adding && (
        <section aria-label="Add a brochure" className="flex flex-col gap-3 rounded-[14px] bg-surface p-4 shadow-[var(--shadow-1)]">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-[13px] font-medium">Title
              <input className={field} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Data Engineering — weekend batch" />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">Course
              <select className={field} value={program} onChange={(e) => setProgram(e.target.value)}>
                <option value="">All courses</option>
                {programs.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
          </div>
          {file ? (
            <div className="flex min-h-11 items-center justify-between gap-2 rounded-[10px] bg-surface2 px-3 text-[13px]">
              <span className="min-w-0 truncate">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</span>
              <Button size="sm" variant="quiet" onClick={() => setFile(null)}>Change</Button>
            </div>
          ) : <DropZone accept=".pdf,application/pdf" hint="PDF only · up to 20 MB" onFile={setFile} />}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="quiet" className="h-11 md:h-10" onClick={reset} disabled={saving}>Cancel</Button>
            <Button variant="primary" className="h-11 md:h-10" onClick={save} loading={saving} disabled={!title.trim() || !file}>Save brochure</Button>
          </div>
        </section>
      )}

      <section aria-labelledby="bro-list" className="flex flex-col gap-2">
        <h2 id="bro-list" className="text-[15px] font-semibold">Brochures</h2>
        {rows === null ? <div className="rounded-[14px] bg-surface p-6 text-muted shadow-[var(--shadow-1)]">Loading…</div>
          : rows.length === 0 ? <EmptyState title="No brochures yet" body={canWrite ? 'Add a course PDF. Staff then send it from the lead panel, and you see who reads it.' : 'The admin adds course PDFs here. You then send them from the lead panel.'}
              action={canWrite && !adding ? { label: 'Add brochure', onClick: () => setAdding(true) } : undefined} />
          : (
            <>
              <ul className="flex flex-col gap-2 md:hidden" aria-label="Brochures">
                {rows.map((r) => (
                  <li key={r.id} className="flex flex-col gap-2 rounded-[12px] bg-surface p-3 shadow-[var(--shadow-1)]">
                    <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="font-medium">{r.title}</div><div className="text-[12.5px] text-muted">{course(r)}</div></div><Pill>{r.status}</Pill></div>
                    <div className="text-[12.5px] text-text2">{counts(r)}{r.last_opened_at ? ` · last ${istWhen(r.last_opened_at)}` : ''}</div>
                    {canWrite && actions(r)}
                  </li>
                ))}
              </ul>
              <div className="hidden md:block">
                <Table label="Brochures">
                  <THead><Th>Brochure</Th><Th>Course</Th><Th>Status</Th><Th>Sent and opened (all time)</Th><Th>Last opened</Th>{canWrite && <Th className="w-0" />}</THead>
                  <TBody>
                    {rows.map((r) => (
                      <Tr key={r.id}>
                        <Td className="font-medium">{r.title}{!r.file_path && <span className="ml-2 text-[12px] font-normal text-badText">No PDF</span>}</Td>
                        <Td className="text-text2">{course(r)}</Td>
                        <Td><Pill>{r.status}</Pill></Td>
                        <Td className="num text-text2">{counts(r)}</Td>
                        <Td className="whitespace-nowrap text-text2">{istWhen(r.last_opened_at)}</Td>
                        {canWrite && <Td>{actions(r)}</Td>}
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </div>
            </>
          )}
      </section>

      <section aria-labelledby="bro-opens" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="bro-opens" className="text-[15px] font-semibold">Recent opens</h2>
          <span className="text-[12px] text-muted">Last 30 links opened, newest first · India time · updates every minute</span>
        </div>
        {opens === null ? <div className="rounded-[14px] bg-surface p-6 text-muted shadow-[var(--shadow-1)]">Loading…</div>
          : opens.length === 0 ? <EmptyState title="No opens yet" body="When a lead opens a brochure link, it shows here, and the lead’s owner gets an alert to call." />
          : (
            <ul className="flex flex-col divide-y divide-line rounded-[14px] bg-surface shadow-[var(--shadow-1)]" aria-label="Recent opens">
              {opens.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                  <Link href={`/p/lead?person=lead:${o.lead_id}`} className="min-h-11 min-w-0 flex-1 py-1 md:min-h-0">
                    <div className="truncate text-[13.5px] font-semibold text-accentText">{o.lead_name}</div>
                    <div className="truncate text-[12.5px] text-text2">{o.brochure_title}{o.sent_by_name ? ` · sent by ${String(o.sent_by_name).split(' ')[0]}` : ''}</div>
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-text2">
                    {o.reading_now && <Chip tone="good">Reading now</Chip>}
                    <span className="num">{openedLine(o)}</span>
                    <span className="num">{Number(o.pages_seen) > 0 ? `${o.pages_seen} page${o.pages_seen === 1 ? '' : 's'}` : 'First page only'}</span>
                    <span className="sr-only">Read for {readTime(o.total_seconds)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </section>
    </main>
  );
}
