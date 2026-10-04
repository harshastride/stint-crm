'use client';
import { ArrowDown, ArrowUp, Pencil, Search } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { getPath, type Col, type PageCfg, type PersonRef, type Row } from '@/lib/pages';
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

  useEffect(() => { setQ(''); setSort(null); setPage(0); }, [cfg]);
  useEffect(() => { setRows(null); setView(0); setPerson(null); setSelId(null); setEditing(null); setNotice(null); setLayout(cfg.board && !phone() ? 'board' : 'table'); load(); }, [cfg, load]);

  // open a new record with the person filled in: /p/payment?new=candidate:<id> (quick panel "Next steps")
  useEffect(() => {
    const n = params.get('new');
    if (!n || !n.includes(':') || !canWrite || !cfg.fields) return;
    const [kind, id] = n.split(':');
    if (kind === 'lead' || kind === 'candidate') { setEditing({ [kind + '_id']: id }); router.replace('/p/' + cfg.id); }
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
    if (term) out = out.filter((r) => cfg.columns.some((c) => short(c, r).toLowerCase().includes(term) || plain(c, r).toLowerCase().includes(term)));
    const col = sort && cfg.columns.find((c) => c.key === sort.key);
    if (col) out = [...out].sort((a, b) => (sort!.asc ? 1 : -1) * compare(col, a, b) || 0);
    return out;
  }, [rows, views, view, s.staff.id, q, sort, cfg.columns]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const pageRows = useMemo(() => shown.slice(page * PAGE, page * PAGE + PAGE), [shown, page]);
  useEffect(() => { setPage(0); }, [q, sort, view]);
  useEffect(() => { if (page > pages - 1) setPage(pages - 1); }, [page, pages]);

  // people pages always show somebody in the panel: default to the first row
  useEffect(() => {
    if (cfg.person && !person && shown.length && !params.get('person')) { const p = cfg.person(shown[0]); if (p) { setPerson(p); setSelId(shown[0].id); } }
  }, [cfg, shown, person, params]);

  const openRow = (r: Row) => {
    const p = cfg.person?.(r);
    if (p) { setPerson(p); setSelId(r.id); setEditing(null); setPanelOpen(true); } else if (cfg.fields) setEditing(r);
  };
  const saved = (text: string) => { setEditing(null); setNotice({ tone: 'good', text }); load(); if (['users', 'program', 'batch', 'branch', 'company', 'source', 'campaign'].includes(cfg.id)) s.reload(); };

  const move = async (r: Row, to: string) => {
    const { error } = await supabase().from(cfg.table).update({ [cfg.board!.field]: to }).eq('id', r.id);
    if (error) { setNotice({ tone: 'bad', text: 'Can’t move ' + cfg.rowTitle(r) + ': ' + friendlyError(error) }); return; }
    setNotice({ tone: 'good', text: cfg.rowTitle(r) + ' moved to ' + to + (cfg.id === 'lead' && to === 'Converted' ? '. A candidate record was created.' : '.') });
    load();
  };

  const exportCsv = () => {
    const esc = (v: string) => '"' + v.replace(/"/g, '""') + '"';
    const text = [cfg.columns.map((c) => esc(c.label)).join(','), ...shown.map((r) => cfg.columns.map((c) => esc(plain(c, r))).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' }));
    a.download = (meta?.title || cfg.id).replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.csv';
    a.click();
    setNotice({ tone: 'good', text: shown.length + ' rows exported.' });
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
              <button key={v.label} type="button" role="tab" aria-selected={view === i} onClick={() => setView(i)}
                className={cx('min-h-[38px] rounded-[10px] px-3.5 text-[13px] font-medium', view === i ? 'bg-ink text-white' : 'text-text2')}>{v.label}</button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
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
                <section key={st} aria-label={st} className="flex w-[240px] shrink-0 flex-col gap-2 rounded-xl bg-surface2 p-2.5">
                  <div className="flex items-center justify-between px-1 text-[13px] font-semibold"><span>{st}</span><span className="num rounded-full bg-surface px-2 py-0.5 text-xs">{cards.length}</span></div>
                  {cards.map((r) => (
                    <div key={r.id} className={cx('anim-fade cursor-pointer rounded-[10px] border bg-surface p-2.5', selId === r.id ? 'border-accent ring-1 ring-accent' : 'border-line')} onClick={() => openRow(r)}>
                      <div className="text-[13px] font-semibold">{plain(cfg.columns[0], r) || cfg.rowTitle(r)}</div>
                      <div className="mt-0.5 text-xs text-text2">{cfg.columns.slice(1, 5).filter((c) => c.key !== cfg.board!.field).map((c) => short(c, r)).filter(Boolean).join(' · ')}</div>
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
                  {cfg.columns.map((c) => {
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
                  <tr key={r.id ?? r.key ?? JSON.stringify(r)} onClick={() => openRow(r)} className={cx('cursor-pointer border-t border-line', selId === r.id && cfg.person ? 'bg-accentSoft' : 'hover:bg-surface2')}>
                    {cfg.columns.map((c, i) => <td key={c.key} className={cx('px-4 py-3 align-middle', i === 0 ? 'font-semibold' : 'text-text2')}>{cell(c, r)}</td>)}
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
              <div className="flex items-center gap-1">
                <Button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
                <span className="px-2">Page {page + 1} of {pages}</span>
                <Button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            )}
          </div>
        )}
      </main>
      {editing && <EditorPanel key={editing === 'new' ? 'new' : editing.id ?? editing.key} cfg={cfg} row={editing === 'new' ? null : editing} canWrite={canWrite} onClose={() => setEditing(null)} onSaved={saved} />}
      {showPanel && <QuickPanel person={person!} onClose={() => setPanelOpen(false)} onChanged={load} />}
    </div>
  );
}
