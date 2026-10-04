'use client';
import { Pencil } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { getPath, type Col, type PageCfg, type PersonRef, type Row } from '@/lib/pages';
import { Button, Notice, Pill, cx, fmtDate, fmtDateTime, fmtDuration, money } from './ui';
import { EditorPanel } from './EditorPanel';
import { QuickPanel } from './QuickPanel';
import { friendlyError } from './Fields';

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
  const [layout, setLayout] = useState<'table' | 'board'>(cfg.board ? 'board' : 'table');
  const [person, setPerson] = useState<PersonRef | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const load = useCallback(async () => {
    let q = supabase().from(cfg.readFrom || cfg.table).select(cfg.select || '*').limit(500);
    if (cfg.order) q = q.order(cfg.order.col, { ascending: !!cfg.order.asc, nullsFirst: false });
    const { data, error } = await q;
    if (error) { setError(friendlyError(error)); setRows([]); return; }
    setError(null); setRows((data as Row[]) || []);
  }, [cfg]);

  useEffect(() => { setRows(null); setView(0); setPerson(null); setSelId(null); setEditing(null); setNotice(null); setLayout(cfg.board ? 'board' : 'table'); load(); }, [cfg, load]);

  // open a person straight from the search box: /p/lead?person=lead:<id>
  useEffect(() => {
    const p = params.get('person');
    if (p && p.includes(':')) { const [kind, id] = p.split(':'); if (kind === 'lead' || kind === 'candidate') { setPerson({ kind, id }); setPanelOpen(true); } }
  }, [params]);

  const views = cfg.views || [{ label: 'All' }];
  const shown = useMemo(() => (rows || []).filter((r) => !views[view]?.where || views[view].where!(r, s.staff.id)), [rows, views, view, s.staff.id]);

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
      <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden p-6">
        <PageHeader group={meta?.grp || ''} title={meta?.title || cfg.id} purpose={cfg.purpose}
          scope={s.staff.role === 'Admin' ? 'Admin · all records' : s.staff.role + (canWrite ? ' · can edit' : ' · view only')}>
          {cfg.csv && <Button onClick={exportCsv}>Export</Button>}
          {cfg.person && person && !panelOpen && <Button onClick={() => setPanelOpen(true)}>Show panel</Button>}
          {canWrite && cfg.fields && !cfg.noCreate && cfg.cta && <Button variant="cta" onClick={onCta}>{cfg.cta}</Button>}
        </PageHeader>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
          <div className="flex flex-wrap gap-1" role="tablist">
            {views.map((v, i) => (
              <button key={v.label} type="button" role="tab" aria-selected={view === i} onClick={() => setView(i)}
                className={cx('min-h-[38px] rounded-[10px] px-3.5 text-[13px] font-medium', view === i ? 'bg-ink text-white' : 'text-text2')}>{v.label}</button>
            ))}
          </div>
          {cfg.board && (
            <div className="flex rounded-[10px] bg-surface2 p-1">
              {(['table', 'board'] as const).map((l) => (
                <button key={l} type="button" onClick={() => setLayout(l)} className={cx('min-h-[32px] rounded-lg px-3 text-xs font-semibold capitalize', layout === l ? 'bg-surface shadow-sm' : 'text-text2')}>{l}</button>
              ))}
            </div>
          )}
        </div>

        {cfg.kpis && rows && (
          <section className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            {cfg.kpis.map((k) => (
              <div key={k.label} className="rounded-xl border border-line bg-surface px-4 py-3.5">
                <div className="text-xs font-medium text-muted">{k.label}</div>
                <div className="num mt-1 text-2xl font-semibold">{k.calc(rows)}</div>
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
            <div className="font-semibold">Nothing here yet</div>
            <div className="mt-1 text-text2">{canWrite && cfg.cta && !cfg.noCreate ? 'Use “' + cfg.cta + '” to add the first one.' : 'There is nothing to show in this view.'}</div>
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
                  {cfg.columns.map((c) => <th key={c.key} className="whitespace-nowrap px-4 py-3 font-semibold">{c.label}</th>)}
                  {cfg.person && cfg.fields && <th className="w-10" />}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
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
        <p className="text-xs text-muted">{rows ? shown.length + ' shown' + (rows.length >= 500 ? ' (first 500 loaded)' : '') : ''}</p>
      </main>
      {editing && <EditorPanel key={editing === 'new' ? 'new' : editing.id ?? editing.key} cfg={cfg} row={editing === 'new' ? null : editing} canWrite={canWrite} onClose={() => setEditing(null)} onSaved={saved} />}
      {showPanel && <QuickPanel person={person!} onClose={() => setPanelOpen(false)} onChanged={load} />}
    </div>
  );
}
