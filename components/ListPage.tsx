'use client';
import { ArrowDown, ArrowUp, Bookmark, BookmarkPlus, Check, ChevronLeft, ChevronRight, Columns3, Minus, Pencil, Search, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { getPath, type Bulk, type Col, type Field, type PageCfg, type PersonRef, type Row } from '@/lib/pages';
import { Button, Notice, Pill, cx, fmtDate, fmtDateTime, fmtDuration, money } from './ui';
import { EditorPanel } from './EditorPanel';
import { QuickPanel } from './QuickPanel';
import { friendlyError } from './Fields';
import { ActivepiecesSetup } from './special/ActivepiecesSetup';
import { AutomationBuilder } from './special/AutomationBuilder';

const TOP: Record<string, React.ComponentType> = { activepieces: ActivepiecesSetup, builder: AutomationBuilder };

const cell = (c: Col, r: Row) => {
  const v = c.get ? c.get(r) : getPath(r, c.key);
  if (c.type === 'pill') return <Pill>{v as string}</Pill>;
  if (v == null || v === '') return <span className="text-muted">—</span>;
  if (c.type === 'money') return <span className="num">{money(v)}</span>;
  if (c.type === 'date') return fmtDate(v);
  if (c.type === 'datetime') return fmtDateTime(v);
  if (c.type === 'duration') return <span className="num">{fmtDuration(v)}</span>;
  if (c.type === 'pct') return <span className="num">{String(v)}%</span>;
  if (c.type === 'number') return <span className="num">{Number(v).toLocaleString('en-IN')}</span>;
  return String(v);
};
const phone = () => typeof window !== 'undefined' && !window.matchMedia('(min-width: 768px)').matches;
const PAGE = 100;      // rows per page in the table
const CHUNK = 1000;    // rows fetched per request
const MAX_ROWS = 20000;
const raw = (c: Col, r: Row) => (c.get ? c.get(r) : getPath(r, c.key));
const NUMERIC = ['money', 'number', 'pct', 'duration'];
const compare = (c: Col, a: Row, b: Row) => {
  const x = raw(c, a), y = raw(c, b);
  if (x == null || x === '') return y == null || y === '' ? 0 : 1;   // empty values always last
  if (y == null || y === '') return -1;
  if (NUMERIC.includes(c.type || '')) return Number(x) - Number(y);
  return String(x).localeCompare(String(y), 'en-IN', { numeric: true, sensitivity: 'base' });
};
/** The form field a table column can edit in place: same key, or "owner.full_name" → "owner_id". Simple field types only. */
const INLINE = ['select', 'ref', 'date', 'datetime', 'number', 'text'];
const fieldFor = (cfg: PageCfg, c: Col): Field | null => {
  if (c.get) return null;
  const key = c.key.includes('.') ? c.key.split('.')[0] + '_id' : c.key;
  const f = (cfg.fields || []).find((x) => x.key === key);
  return f && INLINE.includes(f.type) && !f.readOnly && !f.createOnly ? f : null;
};

/** Page numbers with gaps: 1 … 4 5 6 … 13 (always the same width while paging). */
const pageItems = (page: number, count: number): (number | 'gap')[] => {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, 'gap', count];
  if (page >= count - 3) return [1, 'gap', count - 4, count - 3, count - 2, count - 1, count];
  return [1, 'gap', page - 1, page, page + 1, 'gap', count];
};

function Tick({ state, label, onChange }: { state: boolean | 'some'; label: string; onChange: () => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={state === 'some' ? 'mixed' : state} aria-label={label}
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      className="flex h-11 w-11 items-center justify-center">
      <span className={cx('flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border', state ? 'border-accent bg-accent text-white' : 'border-line2 bg-surface')}>
        {state === 'some' ? <Minus size={12} strokeWidth={3} /> : state ? <Check size={12} strokeWidth={3} /> : null}
      </span>
    </button>
  );
}

const plain = (c: Col, r: Row) => { const v = c.get ? c.get(r) : getPath(r, c.key); return v == null ? '' : String(v); };
const short = (c: Col, r: Row) => {
  const v = c.get ? c.get(r) : getPath(r, c.key);
  if (v == null || v === '') return '';
  return c.type === 'money' ? money(v) : c.type === 'date' ? fmtDate(v) : c.type === 'datetime' ? fmtDateTime(v) : c.type === 'pct' ? v + '%' : c.type === 'duration' ? fmtDuration(v) : String(v);
};

export function PageHeader({ group, title, purpose, scope, children }: { group: string; title: string; purpose: string; scope: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="text-xs font-medium text-muted">{group}</div>
        <h1 className="mt-0.5 text-[26px] font-semibold leading-tight">{title}</h1>
        <p className="mt-1 text-text2">{purpose}</p>
        <span className="mt-2 inline-block rounded-full bg-accentSoft px-2.5 py-1 text-xs font-semibold text-accentText">{scope}</span>
      </div>
      <div className="flex gap-2">{children}</div>
    </header>
  );
}

export function ListPage({ cfg }: { cfg: PageCfg }) {
  const s = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const meta = s.allPages.find((p) => p.id === cfg.id);
  const canWrite = s.can(cfg.id, 'w') && !cfg.readOnly;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState(0);
  const [layout, setLayout] = useState<'table' | 'board'>(cfg.board && !phone() ? 'board' : 'table');
  const [person, setPerson] = useState<PersonRef | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  // on a phone the quick panel is a sheet over the list, so it opens only when someone taps a row
  const [panelOpen, setPanelOpen] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 768px)').matches);

  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; asc: boolean } | null>(null);
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState<Bulk | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [colsOpen, setColsOpen] = useState(false);
  const [savedViews, setSavedViews] = useState<Row[]>([]);
  const [activeSaved, setActiveSaved] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [cellEdit, setCellEdit] = useState<{ id: string; key: string } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [saving, setSaving] = useState<{ name: string; shared: string } | null>(null);
  const loadSaved = useCallback(async () => {
    const { data } = await supabase().from('saved_view').select('*').eq('page_id', cfg.id).order('created_at');
    setSavedViews(data || []);
  }, [cfg.id]);
  useEffect(() => { setActiveSaved(null); setSaving(null); loadSaved(); }, [loadSaved]);

  // Fetch everything the person may see, in chunks, so search, sort, views and totals cover all rows.
  const load = useCallback(async () => {
    const all: Row[] = [];
    for (let from = 0; from < MAX_ROWS; from += CHUNK) {
      let query = supabase().from(cfg.readFrom || cfg.table).select(cfg.select || '*').range(from, from + CHUNK - 1);
      if (cfg.order) query = query.order(cfg.order.col, { ascending: !!cfg.order.asc, nullsFirst: false });
      const { data, error } = await query;
      if (error) { setError(friendlyError(error)); setRows([]); return; }
      all.push(...((data as Row[]) || []));
      if (!data || data.length < CHUNK) break;
    }
    setError(null); setRows(all);
  }, [cfg]);

  useEffect(() => {
    setQ(''); setSort(null); setPage(0); setPicked(new Set()); setBulkOpen(null); setColsOpen(false);
    try { setHidden(new Set(JSON.parse(localStorage.getItem('stint-cols:' + cfg.id) || '[]'))); } catch { setHidden(new Set()); }
  }, [cfg]);
  const toggleCol = (key: string) => setHidden((old) => {
    const n = new Set(old); if (n.has(key)) n.delete(key); else if (cfg.columns.length - n.size > 1) n.add(key);
    try { localStorage.setItem('stint-cols:' + cfg.id, JSON.stringify([...n])); } catch {}
    return n;
  });
  // admin-defined fields shown as extra columns ("Show in list")
  const columns = useMemo<Col[]>(() => [
    ...cfg.columns,
    ...s.custom.filter((f) => f.page_id === cfg.id && f.in_list === 'Yes').map((f) => ({
      key: 'custom.' + f.key, label: f.label,
      get: (r: Row) => { const v = r.custom?.[f.key]; return v === true ? 'Yes' : v === false ? 'No' : v ?? null; },
    })),
  ], [cfg, s.custom]);
  const cols = columns.filter((c) => !hidden.has(c.key));
  const applySaved = (v: Row) => {
    const c = v.config || {};
    setView(Math.min(Number(c.view) || 0, (cfg.views || [{ label: 'All' }]).length - 1)); setQ(c.q || ''); setSort(c.sort || null);
    setHidden(new Set(c.hidden || [])); if (c.layout && (c.layout === 'table' || cfg.board)) setLayout(c.layout);
    setActiveSaved(v.id);
  };
  const saveView = async () => {
    if (!saving?.name.trim()) return;
    const { data, error } = await supabase().from('saved_view').insert({ page_id: cfg.id, name: saving.name.trim(), shared: saving.shared,
      config: { view, q, sort, hidden: [...hidden], layout } }).select().single();
    if (error) { setNotice({ tone: 'bad', text: friendlyError(error) }); return; }
    setSaving(null); await loadSaved(); setActiveSaved(data.id);
    setNotice({ tone: 'good', text: `View “${data.name}” saved${data.shared === 'team' ? ' for your team' : data.shared === 'all' ? ' for everyone' : ''}.` });
  };
  const saveCell = async (r: Row, f: Field, value: unknown) => {
    setCellEdit(null);
    if ((r[f.key] ?? null) === (value ?? null)) return;
    const { error } = await supabase().from(cfg.table).update({ [f.key]: value }).eq('id', r.id);
    if (error) { setNotice({ tone: 'bad', text: f.label + ': ' + friendlyError(error) }); return; }
    setNotice({ tone: 'good', text: `${cfg.rowTitle(r)}: ${f.label} updated.` });
    load();
  };
  const inlineEditor = (r: Row, f: Field) => {
    const common = { autoFocus: true, 'aria-label': f.label, onClick: (e: React.MouseEvent) => e.stopPropagation(), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Escape') setCellEdit(null); }, className: 'h-9 w-full min-w-[120px] px-2 text-[13px]' };
    if (f.type === 'select' || f.type === 'ref') {
      const opts: [string, string][] = f.type === 'ref' ? (s.refs[f.ref || ''] || []).map((x) => [x.id, x.label]) : (f.options || (f.list === '__roles' ? s.roles : s.lists[f.list || ''] || [])).map((v) => [v, v]);
      return <select {...common} defaultValue={r[f.key] ?? ''} onBlur={() => setCellEdit(null)} onChange={(e) => saveCell(r, f, e.target.value || null)}><option value="">—</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
    }
    const v = r[f.key] == null ? '' : f.type === 'datetime' ? new Date(new Date(r[f.key]).getTime() - new Date(r[f.key]).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : f.type === 'date' ? String(r[f.key]).slice(0, 10) : String(r[f.key]);
    const read = (t: string) => (t === '' ? null : f.type === 'number' ? Number(t) : f.type === 'datetime' ? new Date(t).toISOString() : t);
    return <input {...common} type={f.type === 'datetime' ? 'datetime-local' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} defaultValue={v}
      onBlur={(e) => saveCell(r, f, read(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setCellEdit(null); }} />;
  };
  const deleteView = async (v: Row) => {
    const { error } = await supabase().from('saved_view').delete().eq('id', v.id);
    if (error) { setNotice({ tone: 'bad', text: friendlyError(error) }); return; }
    if (activeSaved === v.id) setActiveSaved(null);
    loadSaved();
  };
  useEffect(() => { setRows(null); setView(0); setPerson(null); setSelId(null); setEditing(null); setNotice(null); setLayout(cfg.board && !phone() ? 'board' : 'table'); load(); }, [cfg, load]);

  // open a new record with the person filled in: /p/payment?new=candidate:<id> (quick panel "Next steps")
  useEffect(() => {
    const n = params.get('new');
    if (!n || !n.includes(':') || !canWrite || !cfg.fields) return;
    const [kind, id] = n.split(':');
    if (kind === 'lead' || kind === 'candidate') setEditing({ [kind + '_id']: id }); else if (!cfg.noCreate) setEditing('new');   // ?new=x: = blank form
    router.replace('/p/' + cfg.id);
  }, [params, canWrite, cfg, router]);

  // open an existing record's editor: /p/candidate?edit=candidate:<id> (e.g. "Assign batch")
  useEffect(() => {
    const e = params.get('edit');
    if (!e || !rows || !cfg.fields) return;
    const row = rows.find((r) => r.id === e.split(':')[1]);
    if (row) { setEditing(row); router.replace('/p/' + cfg.id); }
  }, [params, rows, cfg, router]);

  // open a person straight from the search box: /p/lead?person=lead:<id>
  useEffect(() => {
    const p = params.get('person');
    if (p && p.includes(':')) { const [kind, id] = p.split(':'); if (kind === 'lead' || kind === 'candidate') { setPerson({ kind, id }); setPanelOpen(true); } }
  }, [params]);

  const views = cfg.views || [{ label: 'All' }];
  const shown = useMemo(() => {
    let out = (rows || []).filter((r) => !views[view]?.where || views[view].where!(r, s.staff.id));
    const term = q.trim().toLowerCase();
    if (term) out = out.filter((r) => columns.some((c) => short(c, r).toLowerCase().includes(term) || plain(c, r).toLowerCase().includes(term)));
    const col = sort && columns.find((c) => c.key === sort.key);
    if (col) out = [...out].sort((a, b) => (sort!.asc ? 1 : -1) * compare(col, a, b) || 0);
    return out;
  }, [rows, views, view, s.staff.id, q, sort, columns]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const pageRows = useMemo(() => shown.slice(page * PAGE, page * PAGE + PAGE), [shown, page]);
  useEffect(() => { setPage(0); }, [q, sort, view]);
  // ticked rows: only those still in the current list count
  const pickedRows = useMemo(() => shown.filter((r) => r.id && picked.has(r.id)), [shown, picked]);
  const pageIds = pageRows.map((r) => r.id).filter(Boolean) as string[];
  const pageState: boolean | 'some' = pageIds.length && pageIds.every((id) => picked.has(id)) ? true : pageIds.some((id) => picked.has(id)) ? 'some' : false;
  const togglePick = (id: string) => setPicked((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const togglePage = () => setPicked((o) => { const n = new Set(o); if (pageState === true) pageIds.forEach((id) => n.delete(id)); else pageIds.forEach((id) => n.add(id)); return n; });
  const canBulk = canWrite && !!cfg.bulk?.length && !cfg.readFrom;
  const runBulk = async (b: Bulk, value: string | null) => {
    const ids = pickedRows.map((r) => r.id as string);
    if (!ids.length) return;
    setBulkBusy(true);
    const { data, error } = await supabase().from(cfg.table).update({ [b.field]: value }).in('id', ids).select('id');
    setBulkBusy(false); setBulkOpen(null);
    if (error) { setNotice({ tone: 'bad', text: b.label + ': ' + friendlyError(error) }); return; }
    const done = (data || []).length, skipped = ids.length - done;
    const shownValue = b.ref ? (s.refs[b.ref]?.find((x) => x.id === value)?.label || value) : value;
    setNotice({ tone: skipped ? 'bad' : 'good', text: `${b.label}${b.value ? '' : ' ' + shownValue}: ${done} updated` + (skipped ? `, ${skipped} not allowed for your role.` : '.') });
    setPicked(new Set()); load();
  };
  useEffect(() => { if (page > pages - 1) setPage(pages - 1); }, [page, pages]);

  // people pages always show somebody in the panel: default to the first row
  useEffect(() => {
    if (cfg.person && !person && shown.length && !params.get('person')) { const p = cfg.person(shown[0]); if (p) { setPerson(p); setSelId(shown[0].id); } }
  }, [cfg, shown, person, params]);

  const openRow = (r: Row) => {
    const p = cfg.person?.(r);
    if (p) { setPerson(p); setSelId(r.id); setEditing(null); setPanelOpen(true); } else if (cfg.fields) setEditing(r);
  };
  const saved = (text: string) => { setEditing(null); setNotice({ tone: 'good', text }); load(); if (['users', 'program', 'batch', 'branch', 'company', 'source', 'campaign', 'fields'].includes(cfg.id)) s.reload(); };

  const move = async (r: Row, to: string) => {
    const { error } = await supabase().from(cfg.table).update({ [cfg.board!.field]: to }).eq('id', r.id);
    if (error) { setNotice({ tone: 'bad', text: 'Can’t move ' + cfg.rowTitle(r) + ': ' + friendlyError(error) }); return; }
    setNotice({ tone: 'good', text: cfg.rowTitle(r) + ' moved to ' + to + (cfg.id === 'lead' && to === 'Converted' ? '. A candidate record was created.' : '.') });
    load();
  };

  const exportCsv = () => {
    const esc = (v: string) => '"' + v.replace(/"/g, '""') + '"';
    const out = pickedRows.length ? pickedRows : shown;
    const text = [cols.map((c) => esc(c.label)).join(','), ...out.map((r) => cols.map((c) => esc(plain(c, r))).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' }));
    a.download = (meta?.title || cfg.id).replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.csv';
    a.click();
    setNotice({ tone: 'good', text: out.length + ' rows exported.' });
  };

  const onCta = () => {
    if (cfg.id === 'lead' && s.can('enquiry', 'w')) return router.push('/p/enquiry');
    if (cfg.id === 'candidate' && s.can('enrolform', 'w')) return router.push('/p/enrolform');
    setEditing('new');
  };

  const stages = cfg.board ? s.lists[cfg.board.list] || [] : [];
  const showPanel = !!cfg.person && !!person && !editing && panelOpen;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden p-4 md:p-6 [&>*]:shrink-0">
        <PageHeader group={meta?.grp || ''} title={meta?.title || cfg.id} purpose={cfg.purpose}
          scope={s.staff.role === 'Admin' ? 'Admin · all records' : s.staff.role + (canWrite ? ' · can edit' : ' · view only')}>
          {cfg.csv && <Button onClick={exportCsv}>Export</Button>}
          {cfg.person && person && !panelOpen && <Button onClick={() => setPanelOpen(true)}>Show panel</Button>}
          {canWrite && cfg.fields && !cfg.noCreate && cfg.cta && <Button variant="cta" onClick={onCta}>{cfg.cta}</Button>}
        </PageHeader>

        {cfg.top && TOP[cfg.top] && (() => { const Top = TOP[cfg.top!]; return <Top />; })()}

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
          <div className="flex flex-wrap gap-1" role="tablist">
            {views.map((v, i) => (
              <button key={v.label} type="button" role="tab" aria-selected={view === i && !activeSaved} onClick={() => { setView(i); setActiveSaved(null); }}
                className={cx('min-h-[38px] rounded-[10px] px-3.5 text-[13px] font-medium', view === i ? 'bg-ink text-white' : 'text-text2')}>{v.label}</button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
          {layout === 'table' && (
            <div className="relative">
              <button type="button" aria-expanded={colsOpen} onClick={() => setColsOpen(!colsOpen)} className="flex h-[38px] items-center gap-1.5 rounded-[10px] border border-line2 bg-surface px-3 text-[13px] font-medium">
                <Columns3 size={14} /> Columns{hidden.size ? ` · ${cols.length}/${columns.length}` : ''}
              </button>
              {colsOpen && (
                <div role="menu" className="absolute right-0 z-30 mt-1 w-56 rounded-xl border border-line bg-surface p-1 shadow-lg">
                  <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Show columns</div>
                  {columns.map((c) => (
                    <button key={c.key} type="button" role="menuitemcheckbox" aria-checked={!hidden.has(c.key)} onClick={() => toggleCol(c.key)}
                      className="flex min-h-[38px] w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] hover:bg-surface2">
                      <span className={cx('flex h-4 w-4 items-center justify-center rounded-[4px] border', !hidden.has(c.key) ? 'border-accent bg-accent text-white' : 'border-line2')}>{!hidden.has(c.key) && <Check size={11} strokeWidth={3} />}</span>
                      {c.label}
                    </button>
                  ))}
                  {hidden.size > 0 && <button type="button" onClick={() => { setHidden(new Set()); try { localStorage.removeItem('stint-cols:' + cfg.id); } catch {} }} className="mt-1 min-h-[36px] w-full rounded-lg border-t border-line text-[12.5px] font-medium text-accent">Show all</button>}
                </div>
              )}
            </div>
          )}
          <label className="relative">
            <span className="sr-only">Search this list</span>
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this list" className="h-[44px] w-[180px] pl-8 pr-3 text-[13px] md:h-[38px] md:w-[220px]" />
          </label>
          {cfg.board && (
            <div className="flex rounded-[10px] bg-surface2 p-1">
              {(['table', 'board'] as const).map((l) => (
                <button key={l} type="button" onClick={() => setLayout(l)} className={cx('min-h-[32px] rounded-lg px-3 text-xs font-semibold capitalize', layout === l ? 'bg-surface shadow-sm' : 'text-text2')}>{l}</button>
              ))}
            </div>
          )}
          </div>
        </div>

        <div className="-mt-1 flex flex-wrap items-center gap-1.5" aria-label="Saved views">
          {savedViews.map((v) => (
            <span key={v.id} className={cx('flex min-h-[34px] items-center rounded-full border text-[12.5px] font-medium', activeSaved === v.id ? 'border-accent bg-accentSoft text-accentText' : 'border-line2 bg-surface text-text2')}>
              <button type="button" aria-pressed={activeSaved === v.id} onClick={() => applySaved(v)} className="flex min-h-[34px] items-center gap-1.5 pl-3 pr-2" title={v.shared === 'me' ? 'Only you' : v.shared === 'team' ? 'Shared with ' + v.owner_role : 'Shared with everyone'}>
                <Bookmark size={13} aria-hidden />{v.name}{v.shared !== 'me' && <span className="text-[10.5px] text-muted">· {v.shared === 'team' ? 'team' : 'all'}</span>}
              </button>
              {(v.owner_id === s.staff.id || s.staff.role === 'Admin') && <button type="button" aria-label={'Delete view ' + v.name} onClick={() => deleteView(v)} className="flex h-[34px] w-7 items-center justify-center rounded-r-full text-muted hover:text-badText"><X size={13} /></button>}
            </span>
          ))}
          {saving ? (
            <form onSubmit={(e) => { e.preventDefault(); saveView(); }} className="flex flex-wrap items-center gap-1.5">
              <input autoFocus aria-label="View name" placeholder="Name this view, e.g. Hot leads" maxLength={60} value={saving.name} onChange={(e) => setSaving({ ...saving, name: e.target.value })} className="h-[34px] w-[220px] px-3 text-[13px]" />
              <select aria-label="Who sees it" value={saving.shared} onChange={(e) => setSaving({ ...saving, shared: e.target.value })} className="h-[34px] px-2 text-[13px]">
                <option value="me">Just me</option><option value="team">My team ({s.staff.role})</option>
                {(s.staff.role === 'Admin' || s.staff.level === 'Head') && <option value="all">Everyone</option>}
              </select>
              <button type="submit" className="h-[34px] rounded-full bg-accent px-3 text-[12.5px] font-semibold text-white">Save</button>
              <button type="button" onClick={() => setSaving(null)} className="h-[34px] px-2 text-[12.5px] text-text2">Cancel</button>
            </form>
          ) : (
            <button type="button" onClick={() => setSaving({ name: '', shared: 'me' })} className="flex min-h-[34px] items-center gap-1.5 rounded-full border border-dashed border-line2 px-3 text-[12.5px] font-medium text-text2 hover:text-accentText">
              <BookmarkPlus size={13} aria-hidden /> Save this view
            </button>
          )}
        </div>

        {cfg.kpis && rows && (
          <section className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
            {cfg.kpis.map((k) => (
              <div key={k.label} className="rounded-xl border border-line bg-surface px-3 py-2.5 md:px-4 md:py-3.5">
                <div className="text-xs font-medium text-muted">{k.label}</div>
                <div className="num mt-1 text-xl font-semibold md:text-2xl">{k.calc(rows)}</div>
              </div>
            ))}
          </section>
        )}

        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        {error && <Notice tone="bad">{error}</Notice>}

        {layout === 'table' && pickedRows.length > 0 && (
          <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-accent bg-accentSoft px-3 py-2" aria-live="polite">
            <span className="text-[13px] font-semibold text-accentText">{pickedRows.length} selected</span>
            {canBulk && cfg.bulk!.map((b) => b.value ? (
              <button key={b.label} type="button" disabled={bulkBusy} onClick={() => runBulk(b, b.value!)} className="min-h-[36px] rounded-[10px] bg-accent px-3 text-[13px] font-semibold text-white">{b.label}</button>
            ) : (
              <span key={b.label} className="relative">
                <button type="button" disabled={bulkBusy} aria-expanded={bulkOpen?.label === b.label} onClick={() => setBulkOpen(bulkOpen?.label === b.label ? null : b)} className="min-h-[36px] rounded-[10px] border border-line2 bg-surface px-3 text-[13px] font-medium">{b.label} …</button>
                {bulkOpen?.label === b.label && (
                  <div role="menu" className="absolute left-0 z-30 mt-1 max-h-72 w-56 overflow-auto rounded-xl border border-line bg-surface p-1 shadow-lg">
                    {(b.ref ? (s.refs[b.ref] || []).map((x) => [x.id, x.label + ((x as { extra?: { role?: string } }).extra?.role ? ' · ' + (x as { extra?: { role?: string } }).extra!.role : '')]) : (b.options || s.lists[b.list || ''] || []).map((v) => [v, v])).map(([v, l]) => (
                      <button key={v} type="button" role="menuitem" onClick={() => runBulk(b, v)} className="block min-h-[38px] w-full rounded-lg px-2.5 text-left text-[13px] hover:bg-surface2">{l}</button>
                    ))}
                  </div>
                )}
              </span>
            ))}
            <button type="button" onClick={exportCsv} className="min-h-[36px] rounded-[10px] border border-line2 bg-surface px-3 text-[13px] font-medium">Export {pickedRows.length}</button>
            <button type="button" aria-label="Clear selection" onClick={() => setPicked(new Set())} className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg hover:bg-surface"><X size={16} /></button>
          </div>
        )}

        {rows === null ? (
          <div className="rounded-xl border border-line bg-surface p-6 text-muted">Loading…</div>
        ) : shown.length === 0 ? (
          <div className="rounded-xl border border-line bg-surface p-8 text-center">
            <div className="font-semibold">{q.trim() ? 'No matches' : (rows.length && view > 0) ? 'Nothing in “' + views[view].label + '”' : cfg.empty ? 'Nothing to do' : 'Nothing here yet'}</div>
            <div className="mt-1 text-text2">{q.trim() ? 'Nothing in this view matches “' + q.trim() + '”.' : (rows.length && view > 0) ? 'Try another tab above.' : cfg.empty ? cfg.empty : canWrite && cfg.cta && !cfg.noCreate ? 'Use “' + cfg.cta + '” to add the first one.' : 'There is nothing to show in this view.'}</div>
          </div>
        ) : layout === 'board' && cfg.board ? (
          <div className="flex min-w-0 gap-3 overflow-x-auto pb-2">
            {stages.map((st, i) => {
              const cards = shown.filter((r) => r[cfg.board!.field] === st);
              const next = stages[i + 1];
              return (
                <section key={st} aria-label={st}
                  onDragOver={canWrite ? (e) => { if (dragId) { e.preventDefault(); setDropOn(st); } } : undefined}
                  onDragLeave={() => setDropOn((d) => (d === st ? null : d))}
                  onDrop={canWrite ? (e) => { e.preventDefault(); const r = shown.find((x) => x.id === dragId); setDragId(null); setDropOn(null); if (r && r[cfg.board!.field] !== st) move(r, st); } : undefined}
                  className={cx('flex w-[240px] shrink-0 flex-col gap-2 rounded-xl p-2.5 transition-colors', dropOn === st ? 'bg-accentSoft ring-2 ring-accent' : 'bg-surface2')}>
                  <div className="flex items-center justify-between px-1 text-[13px] font-semibold"><span>{st}</span><span className="num rounded-full bg-surface px-2 py-0.5 text-xs">{cards.length}</span></div>
                  {cards.map((r) => (
                    <div key={r.id} draggable={canWrite} onDragStart={(e) => { setDragId(r.id); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDragId(null); setDropOn(null); }}
                      aria-roledescription={canWrite ? 'Draggable card' : undefined}
                      className={cx('anim-fade cursor-pointer rounded-[10px] border bg-surface p-2.5', canWrite && 'active:cursor-grabbing', dragId === r.id && 'opacity-50', selId === r.id ? 'border-accent ring-1 ring-accent' : 'border-line')} onClick={() => openRow(r)}>
                      <div className="text-[13px] font-semibold">{plain(columns[0], r) || cfg.rowTitle(r)}</div>
                      <div className="mt-0.5 text-xs text-text2">{columns.slice(1, 5).filter((c) => c.key !== cfg.board!.field).map((c) => short(c, r)).filter(Boolean).join(' · ')}</div>
                      <div className="mt-2 flex gap-1.5">
                        {canWrite && next && <button type="button" className="min-h-[32px] flex-1 rounded-lg border border-line2 bg-surface text-xs font-medium text-accentText" onClick={(e) => { e.stopPropagation(); move(r, next); }}>Move to {next} →</button>}
                        {canWrite && cfg.fields && cfg.person && <button type="button" aria-label="Edit" className="flex h-8 w-8 items-center justify-center rounded-lg border border-line2 bg-surface" onClick={(e) => { e.stopPropagation(); setEditing(r); }}><Pencil size={13} /></button>}
                      </div>
                    </div>
                  ))}
                </section>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="bg-surface2 text-xs text-text2">
                  <th className="w-11 pl-1"><Tick state={pageState} label="Select all rows on this page" onChange={togglePage} /></th>
                  {cols.map((c) => {
                    const on = sort?.key === c.key;
                    return (
                      <th key={c.key} aria-sort={on ? (sort!.asc ? 'ascending' : 'descending') : 'none'} className="whitespace-nowrap px-2 py-1.5 font-semibold">
                        <button type="button" onClick={() => setSort(on ? (sort!.asc ? { key: c.key, asc: false } : null) : { key: c.key, asc: true })}
                          className={cx('flex min-h-[36px] items-center gap-1 rounded-md px-2 hover:bg-surface', on && 'text-text')}>
                          {c.label}{on && (sort!.asc ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                        </button>
                      </th>
                    );
                  })}
                  {cfg.person && cfg.fields && <th className="w-10" />}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.id ?? r.key ?? JSON.stringify(r)} onClick={() => openRow(r)} className={cx('cursor-pointer border-t border-line', (r.id && picked.has(r.id)) || (selId === r.id && cfg.person) ? 'bg-accentSoft' : 'hover:bg-surface2')}>
                    <td className="w-11 pl-1">{r.id ? <Tick state={picked.has(r.id)} label={'Select ' + cfg.rowTitle(r)} onChange={() => togglePick(r.id)} /> : null}</td>
                    {cols.map((c, i) => {
                      const f = canWrite && !cfg.readFrom && r.id ? fieldFor(cfg, c) : null;
                      const editing = f && cellEdit?.id === r.id && cellEdit?.key === c.key;
                      return (
                        <td key={c.key} className={cx('align-middle', editing ? 'px-2 py-1' : 'px-4 py-3', i === 0 ? 'font-semibold' : 'text-text2')}>
                          {editing ? inlineEditor(r, f!) : f ? (
                            <button type="button" title={'Click to change ' + f.label} aria-label={`${f.label}: ${plain(c, r) || 'empty'}. Change`} onClick={(e) => { e.stopPropagation(); setCellEdit({ id: r.id, key: c.key }); }}
                              className="-mx-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-left hover:border-line2 hover:bg-surface">{cell(c, r)}</button>
                          ) : cell(c, r)}
                        </td>
                      );
                    })}
                    {cfg.person && cfg.fields && (
                      <td className="pr-3">
                        <button type="button" aria-label={(canWrite ? 'Edit ' : 'View ') + cfg.rowTitle(r)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-line2 bg-surface" onClick={(e) => { e.stopPropagation(); setEditing(r); }}><Pencil size={13} /></button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>{layout === 'table' && pages > 1 ? `${page * PAGE + 1}–${Math.min(shown.length, page * PAGE + PAGE)} of ${shown.length}` : shown.length + ' shown'}{rows.length >= MAX_ROWS ? ` (first ${MAX_ROWS.toLocaleString('en-IN')} loaded)` : ''}</span>
            {layout === 'table' && pages > 1 && (
              <nav aria-label="Pages" className="flex items-center gap-1">
                <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page" className="flex h-9 items-center gap-1 rounded-lg px-2 text-[12.5px] font-medium text-text2 hover:bg-surface2 disabled:opacity-40"><ChevronLeft size={15} /><span className="max-sm:sr-only">Previous</span></button>
                <span className="px-1 text-[12.5px] sm:hidden">Page {page + 1} of {pages}</span>
                <span className="flex items-center gap-1 max-sm:hidden">
                  {pageItems(page + 1, pages).map((it, i) => it === 'gap' ? <span key={'g' + i} aria-hidden className="w-6 text-center">…</span> : (
                    <button key={it} type="button" onClick={() => setPage(it - 1)} aria-current={it === page + 1 ? 'page' : undefined} aria-label={'Page ' + it}
                      className={cx('h-9 min-w-9 rounded-lg px-2 text-[12.5px] font-medium tabular-nums', it === page + 1 ? 'bg-accent text-white' : 'text-text2 hover:bg-surface2')}>{it}</button>
                  ))}
                </span>
                <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Next page" className="flex h-9 items-center gap-1 rounded-lg px-2 text-[12.5px] font-medium text-text2 hover:bg-surface2 disabled:opacity-40"><span className="max-sm:sr-only">Next</span><ChevronRight size={15} /></button>
              </nav>
            )}
          </div>
        )}
      </main>
      {editing && <EditorPanel key={editing === 'new' ? 'new' : editing.id ?? editing.key} cfg={cfg} row={editing === 'new' ? null : editing} canWrite={canWrite} onClose={() => setEditing(null)} onSaved={saved} />}
      {showPanel && <QuickPanel person={person!} onClose={() => setPanelOpen(false)} onChanged={load} />}
    </div>
  );
}
