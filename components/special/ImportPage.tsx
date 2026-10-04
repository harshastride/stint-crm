'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { Button, Notice, fmtDateTime } from '../ui';
import { PageHeader } from '../ListPage';

const TARGETS = ['Name', 'Mobile', 'Email', 'City', 'Course', 'Notes', 'Don’t import'];
const GUESS: [RegExp, string][] = [[/name/i, 'Name'], [/mobile|phone|contact|whats/i, 'Mobile'], [/mail/i, 'Email'], [/city|location|place/i, 'City'], [/course|program|interest/i, 'Course'], [/note|remark|comment/i, 'Notes']];

/** Small CSV reader: handles quoted cells, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((c) => c.trim() !== '')) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell); if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}
const cleanMobile = (v: string) => String(v || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '');

export function ImportPage() {
  const s = useSession();
  const canWrite = s.can('imports', 'w') && s.can('lead', 'w');
  const [runs, setRuns] = useState<Row[]>([]);
  const [step, setStep] = useState(0);
  const [file, setFile] = useState('');
  const [grid, setGrid] = useState<string[][]>([]);
  const [map, setMap] = useState<string[]>([]);
  const [source, setSource] = useState(s.refs.lead_source.find((x) => /excel/i.test(x.label))?.id || '');
  const [check, setCheck] = useState<{ ready: Row[]; dupes: string[][]; bad: string[][] } | null>(null);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { const { data } = await supabase().from('import_run').select('*, by:by_id(full_name)').order('created_at', { ascending: false }).limit(50); setRuns(data || []); }, []);
  useEffect(() => { load(); }, [load]);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) { setMsg({ tone: 'bad', text: 'Please save the sheet as CSV first (File → Save as → CSV), then pick that file.' }); return; }
    const rows = parseCsv(await f.text());
    if (rows.length < 2) { setMsg({ tone: 'bad', text: 'The file has no rows under the header.' }); return; }
    setFile(f.name); setGrid(rows); setMsg(null);
    setMap(rows[0].map((h) => GUESS.find(([re]) => re.test(h))?.[1] || 'Don’t import'));
    setStep(2);
  };

  const runCheck = async () => {
    const col = (name: string) => map.indexOf(name);
    if (col('Name') < 0 || col('Mobile') < 0) { setMsg({ tone: 'bad', text: 'Name and Mobile must each be matched to a column.' }); return; }
    setBusy(true); setMsg(null);
    const seen = new Set<string>(); const ready: Row[] = [], bad: string[][] = [], dupes: string[][] = [];
    const pending: { row: string[]; lead: Row }[] = [];
    grid.slice(1).forEach((r) => {
      const name = (r[col('Name')] || '').trim(), mobile = cleanMobile(r[col('Mobile')]);
      if (!name) return bad.push([...r, 'Name missing']);
      if (mobile.length !== 10) return bad.push([...r, 'Mobile is not 10 digits']);
      if (seen.has(mobile)) return dupes.push([...r, 'Same mobile twice in this file']);
      seen.add(mobile);
      const course = col('Course') >= 0 ? (r[col('Course')] || '').trim() : '';
      const prog = course ? s.refs.program.find((p) => p.label.toLowerCase() === course.toLowerCase() || p.label.toLowerCase().includes(course.toLowerCase())) : undefined;
      pending.push({ row: r, lead: { full_name: name, mobile, email: col('Email') >= 0 ? r[col('Email')]?.trim() || null : null, city: col('City') >= 0 ? r[col('City')]?.trim() || null : null,
        program_id: prog?.id || null, course_other: prog ? null : course || null, notes: col('Notes') >= 0 ? r[col('Notes')]?.trim() || null : null, source_id: source || null, created_by: s.staff.id } });
    });
    const existing = new Set<string>();
    const mobiles = pending.map((p) => p.lead.mobile);
    for (let i = 0; i < mobiles.length; i += 200) {
      const { data } = await supabase().from('lead').select('mobile').in('mobile', mobiles.slice(i, i + 200));
      (data || []).forEach((d: Row) => existing.add(d.mobile));
    }
    pending.forEach((p) => (existing.has(p.lead.mobile) ? dupes.push([...p.row, 'Already in the CRM']) : ready.push(p.lead)));
    setCheck({ ready, dupes, bad }); setBusy(false); setStep(3);
  };

  const doImport = async () => {
    if (!check) return;
    setBusy(true);
    const db = supabase(); let ok = 0; const failed = [...check.bad];
    for (let i = 0; i < check.ready.length; i += 200) {
      const chunk = check.ready.slice(i, i + 200);
      const { error } = await db.from('lead').insert(chunk);
      if (error) chunk.forEach((c) => failed.push([c.full_name, c.mobile, error.message])); else ok += chunk.length;
    }
    await db.from('import_run').insert({ file, into_table: 'Leads', total_rows: grid.length - 1, ok_rows: ok, failed_rows: failed.length, duplicate_rows: check.dupes.length, by_id: s.staff.id });
    setBusy(false); setStep(0); setGrid([]); setCheck(null);
    setMsg({ tone: failed.length ? 'bad' : 'good', text: `${ok} leads imported from ${file} and assigned. ${check.dupes.length} were already in the CRM, ${failed.length} had a problem.` });
    load();
  };

  const download = (rows: string[][], name: string) => {
    const text = [[...grid[0], 'Reason'], ...rows].map((r) => r.map((c) => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' })); a.download = name; a.click();
  };

  return (
    <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
      <PageHeader group="Admin settings" title="Import / export" purpose="Bring leads in from a sheet. Every import is listed with what went in and what failed. Any list can be exported from its own page." scope={s.staff.role + (canWrite ? ' · can edit' : ' · view only')}>
        {canWrite && step === 0 && <Button variant="cta" onClick={() => { setStep(1); setMsg(null); }}>New import</Button>}
      </PageHeader>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      {step > 0 && (
        <section className="anim-fade flex max-w-[760px] flex-col gap-3 rounded-xl border border-accent bg-surface p-4">
          <div className="flex items-center justify-between"><h2 className="text-base font-semibold">New import · step {step} of 3</h2><button type="button" className="text-[13px] font-medium text-text2" onClick={() => { setStep(0); setGrid([]); setCheck(null); }}>Cancel</button></div>
          {step === 1 && (
            <>
              <label className="flex flex-col gap-1 text-xs font-medium text-text2">Source for these leads
                <select className="h-11 px-3 text-sm" value={source} onChange={(e) => setSource(e.target.value)}><option value="">Select</option>{s.refs.lead_source.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-text2">File (CSV, first row must be the column names)
                <input type="file" accept=".csv,text/csv" className="h-11 px-3 py-2 text-sm" onChange={(e) => pick(e.target.files?.[0])} />
              </label>
              <p className="text-[13px] text-text2">A mobile that is already in the CRM is skipped, so nobody gets a second lead.</p>
            </>
          )}
          {step === 2 && (
            <>
              <p className="text-[13px] text-text2">{file}: {grid.length - 1} rows. Match each column of your sheet to a CRM field.</p>
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                {grid[0].map((h, i) => (
                  <label key={i} className="flex flex-col gap-1 text-xs font-medium text-text2">Sheet column “{h}” <span className="font-normal text-muted">e.g. {grid[1]?.[i] || '—'}</span>
                    <select className="h-10 px-2 text-sm" value={map[i]} onChange={(e) => setMap(map.map((m, j) => (j === i ? e.target.value : m)))}>{TARGETS.map((t) => <option key={t}>{t}</option>)}</select>
                  </label>
                ))}
              </div>
              <div className="flex gap-2"><Button variant="primary" disabled={busy} onClick={runCheck}>{busy ? 'Checking…' : 'Next: check the rows'}</Button><Button onClick={() => setStep(1)}>Back</Button></div>
            </>
          )}
          {step === 3 && check && (
            <>
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                {[['Ready to import', check.ready.length], ['Already in the CRM', check.dupes.length], ['Rows with a problem', check.bad.length]].map(([l, n]) => (
                  <div key={l} className="rounded-[10px] bg-surface2 p-3"><div className="text-xs font-medium text-muted">{l}</div><div className="num text-2xl font-semibold">{n}</div></div>
                ))}
              </div>
              <p className="text-[13px] text-text2">Nothing has been added yet. New leads are given to telecallers by the assignment rule.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" disabled={busy || check.ready.length === 0} onClick={doImport}>{busy ? 'Importing…' : 'Import ' + check.ready.length + ' leads'}</Button>
                {check.bad.length + check.dupes.length > 0 && <Button onClick={() => download([...check.bad, ...check.dupes], 'rows-not-imported.csv')}>Download the rows left out</Button>}
                <Button onClick={() => setStep(2)}>Back</Button>
              </div>
            </>
          )}
        </section>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead><tr className="bg-surface2 text-xs text-text2">{['File', 'Into', 'Rows', 'Result', 'By', 'When'].map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {runs.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-text2">No imports yet.</td></tr>}
            {runs.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-4 py-3 font-semibold">{r.file}</td><td className="px-4 py-3 text-text2">{r.into_table}</td><td className="num px-4 py-3 text-text2">{r.total_rows}</td>
                <td className="px-4 py-3 text-text2">{r.ok_rows} ok · {r.duplicate_rows} already there · {r.failed_rows} failed</td><td className="px-4 py-3 text-text2">{r.by?.full_name || '—'}</td><td className="px-4 py-3 text-text2">{fmtDateTime(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
