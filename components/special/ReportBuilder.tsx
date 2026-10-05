'use client';
import { BarChart3, Download, LineChart, Plus, Save, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { PageHeader } from '../kit/PageHeader';
import { Table, THead, TBody, Th, Td, Tr } from '../kit/Table';
import { Button, ButtonGroup, IconButton, Notice, fmtDate, money } from '../ui';

// Report builder. Staff pick from a whitelist (report_source / report_field); the database function
// run_report() checks every name again and builds the query itself. No SQL is ever sent from here.
type Source = { key: string; label: string; page_id: string; date_field: string | null; sort: number };
type Field = { source_key: string; col: string; label: string; type: 'text' | 'number' | 'money' | 'date' | 'stage'; groupable: boolean; aggregatable: boolean; sort: number };
type Group = { field: string; bucket?: 'day' | 'week' | 'month' };
type Measure = { agg: 'count' | 'sum' | 'avg'; field?: string };
type Filter = { field: string; op: 'eq' | 'in' | 'between' | 'contains'; value?: string; values?: string[]; from?: string; to?: string };
type Def = { source: string; columns?: string[]; group_by?: Group[]; measures?: Measure[]; filters?: Filter[]; sort?: { key: string; dir: 'asc' | 'desc' }; limit?: number };
type Saved = { id: string; name: string; def: Def; owner: string; shared_with_roles: string[] };
type Result = { columns: string[]; rows: Record<string, unknown>[] };

const sel = 'min-h-[44px] max-w-full rounded-[10px] border border-line2 bg-surface px-3 text-[13.5px]';
const label = 'text-xs font-medium text-muted';
const AGG_LABEL = { count: 'Count', sum: 'Total', avg: 'Average' } as const;

export function ReportBuilder() {
  const s = useSession();
  const db = supabase();
  const [sources, setSources] = useState<Source[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [def, setDef] = useState<Def>({ source: '' });
  const [mode, setMode] = useState<'summary' | 'list'>('summary');
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [chart, setChart] = useState<'bar' | 'line'>('bar');
  const [choices, setChoices] = useState<Record<string, string[]>>({});
  const [name, setName] = useState('');
  const [share, setShare] = useState<string[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const loadSaved = useCallback(() => db.from('saved_report').select('id,name,def,owner,shared_with_roles').order('name').then(({ data }: { data: unknown }) => setSaved((data as Saved[]) || [])), [db]);
  useEffect(() => {
    db.from('report_source').select('*').order('sort').then(({ data }: { data: unknown }) => setSources((data as Source[]) || []));
    db.from('report_field').select('*').order('sort').then(({ data }: { data: unknown }) => setFields((data as Field[]) || []));
    db.from('app_role').select('name').order('sort').then(({ data }: { data: unknown }) => setRoles(((data as { name: string }[]) || []).map((r) => r.name).filter((r) => r !== 'Admin')));
    loadSaved();
  }, [db, loadSaved]);

  const fs = useMemo(() => fields.filter((f) => f.source_key === def.source), [fields, def.source]);
  const fieldOf = (col: string) => fs.find((f) => f.col === col);

  const pickSource = (key: string) => {
    const first = fields.find((f) => f.source_key === key && f.groupable && f.type !== 'date');
    setDef({ source: key, group_by: first ? [{ field: first.col }] : [], measures: [{ agg: 'count' }], columns: fields.filter((f) => f.source_key === key).slice(0, 4).map((f) => f.col), filters: [], limit: 500 });
    setMode('summary'); setRes(null); setSavedId(null); setName(''); setShare([]); setChoices({});
  };

  // The definition actually sent: summary uses group_by/measures, list uses columns.
  const sent: Def | null = useMemo(() => {
    if (!def.source) return null;
    const base = { source: def.source, filters: def.filters || [], sort: def.sort, limit: def.limit || 500 };
    return mode === 'summary' ? { ...base, group_by: def.group_by || [], measures: def.measures || [] } : { ...base, columns: def.columns || [] };
  }, [def, mode]);

  useEffect(() => {
    if (!sent || (mode === 'summary' && !sent.group_by?.length) || (mode === 'list' && !sent.columns?.length)) { setRes(null); return; }
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      db.rpc('run_report', { p_def: sent }).then(({ data, error }: { data: unknown; error: { message: string } | null }) => {
        if (!live) return;
        setBusy(false);
        if (error) { setErr(error.message); setRes(null); } else { setErr(''); setRes(data as Result); }
      });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [sent, mode, db]);

  // Choices for a filter come from the data itself (distinct values), so nobody types a stage or a name.
  const loadChoices = (col: string) => {
    if (choices[col]) return;
    db.rpc('run_report', { p_def: { source: def.source, group_by: [{ field: col }], measures: [{ agg: 'count' }], limit: 200, sort: { key: col, dir: 'asc' } } })
      .then(({ data }: { data: unknown }) => setChoices((c) => ({ ...c, [col]: ((data as Result)?.rows || []).map((r) => r[col]).filter((v) => v != null).map(String) })));
  };

  const upd = (p: Partial<Def>) => setDef((d) => ({ ...d, ...p }));
  const setFilter = (i: number, f: Filter | null) => upd({ filters: (def.filters || []).flatMap((x, j) => (j === i ? (f ? [f] : []) : [x])) });

  const colLabel = (c: string) => {
    const f = fieldOf(c);
    if (f) return f.label;
    if (c === 'count') return 'Count';
    const m = c.match(/^(sum|avg)_(.+)$/);
    if (m) return `${AGG_LABEL[m[1] as 'sum' | 'avg']} ${fieldOf(m[2])?.label.toLowerCase() || m[2]}`;
    return c;
  };
  const fmt = (c: string, v: unknown) => {
    if (v == null || v === '') return '—';
    const f = fieldOf(c) || fieldOf(c.replace(/^(sum|avg)_/, ''));
    if (f?.type === 'money') return money(v);
    if (f?.type === 'date' && c === f.col) return fmtDate(v);
    if (typeof v === 'number') return v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    return String(v);
  };
  const isNum = (c: string) => c === 'count' || /^(sum|avg)_/.test(c) || ['number', 'money'].includes(fieldOf(c)?.type || '');

  const csv = () => {
    if (!res) return;
    const esc = (v: unknown) => { let t = v == null ? '' : String(v); if (/^[=+\-@]/.test(t)) t = "'" + t; return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const text = [res.columns.map(colLabel).map(esc).join(','), ...res.rows.map((r) => res.columns.map((c) => esc(r[c])).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = (name || def.source || 'report') + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const save = async () => {
    if (!sent || !name.trim()) return;
    const row = { name: name.trim(), def: { ...sent, mode } as unknown as Def, shared_with_roles: share };
    const r = savedId && saved.find((x) => x.id === savedId)?.owner === s.staff.id
      ? await db.from('saved_report').update({ ...row, updated_at: new Date().toISOString() }).eq('id', savedId).select('id').single()
      : await db.from('saved_report').insert(row).select('id').single();
    if (r.error) { setMsg(''); setErr(r.error.message); return; }
    setSavedId(r.data.id); setMsg('Report saved'); loadSaved();
  };
  const open = (id: string) => {
    const r = saved.find((x) => x.id === id);
    if (!r) return;
    const d = r.def as Def & { mode?: 'summary' | 'list' };
    setMode(d.mode || (d.group_by?.length ? 'summary' : 'list'));
    setDef({ ...d, group_by: d.group_by || [], measures: d.measures || [{ agg: 'count' }], columns: d.columns || [], filters: d.filters || [] });
    setSavedId(r.id); setName(r.name); setShare(r.shared_with_roles || []); setChoices({}); setMsg('');
  };
  const remove = async () => {
    if (!savedId) return;
    await db.from('saved_report').delete().eq('id', savedId);
    setSavedId(null); setName(''); setMsg('Report deleted'); loadSaved();
  };

  const groupable = fs.filter((f) => f.groupable);
  const aggregatable = fs.filter((f) => f.aggregatable);
  const firstNum = res?.columns.find((c) => isNum(c) && !(def.group_by || []).some((g) => g.field === c));

  return (
    <main className="flex flex-col gap-section p-page-sm md:p-page">
      <PageHeader title="Report builder" description="Pick what to count, how to split it and which rows to keep. You only see rows your role can see."
        actions={<>
          <select aria-label="Open a saved report" className={sel} value={savedId || ''} onChange={(e) => e.target.value && open(e.target.value)}>
            <option value="">Saved reports ({saved.length})</option>
            {saved.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <Button variant="outline" leftIcon={<Download size={16} />} onClick={csv} disabled={!res?.rows.length}>Download CSV</Button>
        </>} />

      <section className="grid gap-4 rounded-card bg-surface p-card shadow-1 md:grid-cols-2">
        <label className="flex flex-col gap-1"><span className={label}>1. Data</span>
          <select aria-label="Data source" className={sel} value={def.source} onChange={(e) => pickSource(e.target.value)}>
            <option value="">Choose what to report on</option>
            {sources.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </label>
        {def.source && (
          <div className="flex flex-col gap-1"><span className={label}>2. Shape</span>
            <ButtonGroup label="Report shape">
              <Button size="md" variant="quiet" active={mode === 'summary'} onClick={() => setMode('summary')}>Summary</Button>
              <Button size="md" variant="quiet" active={mode === 'list'} onClick={() => setMode('list')}>List of rows</Button>
            </ButtonGroup>
          </div>
        )}

        {def.source && mode === 'summary' && <>
          <div className="flex flex-col gap-2"><span className={label}>Split by (up to 2)</span>
            {(def.group_by || []).map((g, i) => {
              const f = fieldOf(g.field);
              return (
                <div key={i} className="flex flex-wrap gap-2">
                  <select aria-label={`Split by ${i + 1}`} className={sel} value={g.field} onChange={(e) => upd({ group_by: (def.group_by || []).map((x, j) => (j === i ? { field: e.target.value, bucket: fieldOf(e.target.value)?.type === 'date' ? 'month' : undefined } : x)) })}>
                    {groupable.map((x) => <option key={x.col} value={x.col}>{x.label}</option>)}
                  </select>
                  {f?.type === 'date' && (
                    <select aria-label={`Date step ${i + 1}`} className={sel} value={g.bucket || 'month'} onChange={(e) => upd({ group_by: (def.group_by || []).map((x, j) => (j === i ? { ...x, bucket: e.target.value as Group['bucket'] } : x)) })}>
                      <option value="day">By day</option><option value="week">By week</option><option value="month">By month</option>
                    </select>
                  )}
                  <IconButton aria-label="Remove split" icon={<X size={16} />} onClick={() => upd({ group_by: (def.group_by || []).filter((_, j) => j !== i) })} />
                </div>
              );
            })}
            {(def.group_by || []).length < 2 && groupable.length > 0 && (
              <Button size="md" variant="quiet" leftIcon={<Plus size={16} />} onClick={() => { const f = groupable.find((x) => !(def.group_by || []).some((g) => g.field === x.col)); if (f) upd({ group_by: [...(def.group_by || []), { field: f.col, bucket: f.type === 'date' ? 'month' : undefined }] }); }}>Add split</Button>
            )}
          </div>
          <div className="flex flex-col gap-2"><span className={label}>Numbers to show</span>
            {(def.measures || []).map((m, i) => (
              <div key={i} className="flex flex-wrap gap-2">
                <select aria-label={`Measure ${i + 1}`} className={sel} value={m.agg === 'count' ? 'count' : `${m.agg}:${m.field}`}
                  onChange={(e) => { const [agg, field] = e.target.value.split(':'); upd({ measures: (def.measures || []).map((x, j) => (j === i ? (agg === 'count' ? { agg: 'count' } : { agg: agg as Measure['agg'], field }) : x)) }); }}>
                  <option value="count">Count of rows</option>
                  {aggregatable.flatMap((f) => [<option key={'s' + f.col} value={`sum:${f.col}`}>Total {f.label.toLowerCase()}</option>, <option key={'a' + f.col} value={`avg:${f.col}`}>Average {f.label.toLowerCase()}</option>])}
                </select>
                {(def.measures || []).length > 1 && <IconButton aria-label="Remove number" icon={<X size={16} />} onClick={() => upd({ measures: (def.measures || []).filter((_, j) => j !== i) })} />}
              </div>
            ))}
            {aggregatable.length > 0 && (def.measures || []).length < 3 && <Button size="md" variant="quiet" leftIcon={<Plus size={16} />} onClick={() => upd({ measures: [...(def.measures || []), { agg: 'sum', field: aggregatable[0].col }] })}>Add number</Button>}
          </div>
        </>}

        {def.source && mode === 'list' && (
          <fieldset className="md:col-span-2"><legend className={label}>Columns</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {fs.map((f) => {
                const on = (def.columns || []).includes(f.col);
                return <Button key={f.col} size="md" variant="quiet" active={on} onClick={() => upd({ columns: on ? (def.columns || []).filter((c) => c !== f.col) : [...(def.columns || []), f.col] })}>{f.label}</Button>;
              })}
            </div>
          </fieldset>
        )}

        {def.source && (
          <div className="flex flex-col gap-2 md:col-span-2"><span className={label}>3. Keep only rows where</span>
            {(def.filters || []).map((fl, i) => {
              const f = fieldOf(fl.field);
              const ranged = f && ['date', 'number', 'money'].includes(f.type);
              return (
                <div key={i} className="flex flex-wrap items-center gap-2" data-testid="report-filter">
                  <select aria-label={`Filter field ${i + 1}`} className={sel} value={fl.field} onChange={(e) => { const nf = fieldOf(e.target.value); setFilter(i, { field: e.target.value, op: nf && ['date', 'number', 'money'].includes(nf.type) ? 'between' : 'in', values: [] }); }}>
                    {fs.map((x) => <option key={x.col} value={x.col}>{x.label}</option>)}
                  </select>
                  {ranged ? <>
                    <input aria-label="From" type={f.type === 'date' ? 'date' : 'number'} className={sel} value={fl.from || ''} onChange={(e) => setFilter(i, { ...fl, op: 'between', from: e.target.value || undefined })} />
                    <span className="text-text2">to</span>
                    <input aria-label="To" type={f.type === 'date' ? 'date' : 'number'} className={sel} value={fl.to || ''} onChange={(e) => setFilter(i, { ...fl, op: 'between', to: e.target.value || undefined })} />
                  </> : <>
                    <select aria-label={`Filter rule ${i + 1}`} className={sel} value={fl.op} onChange={(e) => setFilter(i, { field: fl.field, op: e.target.value as Filter['op'], values: [], value: '' })}>
                      <option value="in">is one of</option><option value="contains">contains</option>
                    </select>
                    {fl.op === 'contains'
                      ? <input aria-label="Contains text" className={sel} value={fl.value || ''} maxLength={80} onChange={(e) => setFilter(i, { ...fl, value: e.target.value })} />
                      : <select aria-label={`Filter values ${i + 1}`} className={sel} value="" onFocus={() => loadChoices(fl.field)} onMouseDown={() => loadChoices(fl.field)}
                          onChange={(e) => e.target.value && setFilter(i, { ...fl, values: [...new Set([...(fl.values || []), e.target.value])] })}>
                          <option value="">{fl.values?.length ? 'Add another' : 'Choose a value'}</option>
                          {(choices[fl.field] || []).filter((v) => !fl.values?.includes(v)).map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>}
                    {(fl.values || []).map((v) => (
                      <Button key={v} size="sm" variant="secondary" rightIcon={<X size={14} />} aria-label={`Remove ${v}`} className="min-h-[44px]"
                        onClick={() => setFilter(i, { ...fl, values: (fl.values || []).filter((x) => x !== v) })}>{v}</Button>
                    ))}
                  </>}
                  <IconButton aria-label="Remove filter" icon={<Trash2 size={16} />} onClick={() => setFilter(i, null)} />
                </div>
              );
            })}
            <div><Button size="md" variant="quiet" leftIcon={<Plus size={16} />} onClick={() => { const f = fs[0]; if (f) upd({ filters: [...(def.filters || []), { field: f.col, op: ['date', 'number', 'money'].includes(f.type) ? 'between' : 'in', values: [] }] }); }}>Add filter</Button></div>
          </div>
        )}
      </section>

      {err && <Notice tone="bad">{err}</Notice>}
      {msg && <Notice>{msg}</Notice>}

      {res && (
        <section className="flex flex-col gap-3" aria-busy={busy}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[13.5px] text-text2" data-testid="report-count">{res.rows.length.toLocaleString('en-IN')} rows{res.rows.length >= (def.limit || 500) ? ' (limit reached)' : ''}</div>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Sort by" className={sel} value={def.sort ? `${def.sort.key}:${def.sort.dir}` : ''} onChange={(e) => { const [key, dir] = e.target.value.split(':'); upd({ sort: key ? { key, dir: dir as 'asc' | 'desc' } : undefined }); }}>
                <option value="">Default order</option>
                {res.columns.flatMap((c) => [<option key={c + 'a'} value={`${c}:asc`}>{colLabel(c)} (low to high)</option>, <option key={c + 'd'} value={`${c}:desc`}>{colLabel(c)} (high to low)</option>])}
              </select>
              <select aria-label="Row limit" className={sel} value={def.limit || 500} onChange={(e) => upd({ limit: Number(e.target.value) })}>
                {[100, 500, 1000, 5000].map((n) => <option key={n} value={n}>Up to {n.toLocaleString('en-IN')}</option>)}
              </select>
            </div>
          </div>

          {mode === 'summary' && firstNum && res.rows.length > 1 && (
            <div className="rounded-card bg-surface p-card shadow-1">
              <div className="mb-2 flex items-center justify-between">
                <span className={label}>{colLabel(firstNum)}</span>
                <ButtonGroup label="Chart type">
                  <IconButton aria-label="Bar chart" icon={<BarChart3 size={16} />} variant={chart === 'bar' ? 'secondary' : 'quiet'} onClick={() => setChart('bar')} />
                  <IconButton aria-label="Line chart" icon={<LineChart size={16} />} variant={chart === 'line' ? 'secondary' : 'quiet'} onClick={() => setChart('line')} />
                </ButtonGroup>
              </div>
              <MiniChart kind={chart} points={res.rows.slice(0, 60).map((r) => ({ label: (def.group_by || []).map((g) => fmt(g.field, r[g.field])).join(' · '), value: Number(r[firstNum]) || 0, text: fmt(firstNum, r[firstNum]) }))} />
            </div>
          )}

          {res.rows.length ? (
            <Table label="Report results">
              <THead>{res.columns.map((c) => <Th key={c} numeric={isNum(c)}>{colLabel(c)}</Th>)}</THead>
              <TBody>{res.rows.map((r, i) => <Tr key={i}>{res.columns.map((c) => <Td key={c} numeric={isNum(c)}>{fmt(c, r[c])}</Td>)}</Tr>)}</TBody>
            </Table>
          ) : <div className="rounded-card bg-surface p-card text-center text-text2 shadow-1">No rows match. Try removing a filter.</div>}

          <div className="flex flex-col gap-3 rounded-card bg-surface p-card shadow-1">
            <span className={label}>4. Save and share</span>
            <div className="flex flex-wrap items-center gap-2">
              <input aria-label="Report name" placeholder="Report name" maxLength={120} className={sel + ' min-w-[220px]'} value={name} onChange={(e) => setName(e.target.value)} />
              <Button variant="primary" leftIcon={<Save size={16} />} onClick={save} disabled={!name.trim()}>Save report</Button>
              {savedId && saved.find((x) => x.id === savedId)?.owner === s.staff.id && <Button variant="danger" leftIcon={<Trash2 size={16} />} onClick={remove}>Delete</Button>}
            </div>
            {roles.length > 0 && (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Share with roles">
                <span className="text-[13px] text-text2">Share with:</span>
                {roles.map((r) => <Button key={r} size="md" variant="quiet" active={share.includes(r)} onClick={() => setShare(share.includes(r) ? share.filter((x) => x !== r) : [...share, r])}>{r}</Button>)}
              </div>
            )}
            <p className="text-xs text-muted">People you share with still only see rows their own role allows.</p>
          </div>
        </section>
      )}
      {!def.source && <div className="rounded-card bg-surface p-card text-text2 shadow-1">Choose what to report on to begin.</div>}
    </main>
  );
}

// Small SVG bar / line chart in the style of kit/Sparkline. No chart library.
function MiniChart({ kind, points }: { kind: 'bar' | 'line'; points: { label: string; value: number; text: string }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600, H = 180, pad = 6;
  const max = Math.max(1, ...points.map((p) => p.value));
  const bw = W / points.length;
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${(i * bw + bw / 2).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const h = hover != null ? points[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} role="img" data-testid="report-chart"
        aria-label={`Chart of ${points.length} groups, highest ${Math.max(...points.map((p) => p.value)).toLocaleString('en-IN')}`}
        onPointerLeave={() => setHover(null)}>
        {kind === 'bar'
          ? points.map((p, i) => <rect key={i} x={i * bw + bw * 0.15} width={bw * 0.7} y={y(p.value)} height={H - pad - y(p.value)} rx="3" fill="var(--accent, #4474B9)" opacity={hover == null || hover === i ? 1 : 0.5} onPointerEnter={() => setHover(i)} />)
          : <>
              <path d={line} fill="none" stroke="var(--accent, #4474B9)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              {points.map((p, i) => <rect key={i} x={i * bw} width={bw} y={0} height={H} fill="transparent" onPointerEnter={() => setHover(i)} />)}
              {hover != null && <circle cx={hover * bw + bw / 2} cy={y(points[hover].value)} r="4" fill="var(--accent, #4474B9)" vectorEffect="non-scaling-stroke" />}
            </>}
      </svg>
      <div className="mt-1 min-h-[20px] text-[12px] text-text2" role="status">{h ? `${h.label}: ${h.text}` : 'Point at a bar to see its value'}</div>
    </div>
  );
}
