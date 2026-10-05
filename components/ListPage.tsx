'use client';
import { Board } from './kit/Board';
import { Funnel } from './kit/Funnel';
import { ArrowDown, ArrowUp, Bookmark, BookmarkPlus, Check, ListFilter, ChevronLeft, ChevronRight, Columns3, Minus, Pencil, Rows3, Rows4, Search, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { getPath, mayReassign, statusLockedBy, type Bulk, type Col, type Field, type PageCfg, type PersonRef, type Row } from '@/lib/pages';
import { Button, ButtonGroup, IconButton, Notice, Pill, cx, fmtDate, fmtDateTime, fmtDuration, money } from './ui';
import { EditorPanel } from './EditorPanel';
import { QuickPanel } from './QuickPanel';
import { friendlyError } from './Fields';
import { useToast } from './Toasts';
import { ActivepiecesSetup } from './special/ActivepiecesSetup';
import { AutomationBuilder } from './special/AutomationBuilder';
import { ProgramCompare } from './special/ProgramCompare';
import { TableSkeleton } from './Skeletons';
import { TagChips } from './kit/Tags';
import { DateRange, inRange, type Range } from './kit/DateRange';
import { EmptyState } from './kit/EmptyState';
import { HoverCard } from './kit/HoverCard';
import { Confirm } from './kit/Confirm';
import { CountUp } from './kit/CountUp';
import { RangeSlider, rupees } from './kit/RangeSlider';
import { FilterBuilder, advExpr, advFields, type Adv } from './kit/FilterBuilder';
import { PersonChip } from './kit/Avatar';
import { Table, THead, TBody, Th, Td, Tr, RowActions, useDensity } from './kit/Table';
import { KpiCard } from './kit/PageHeader';
import { AvatarStack, type StackPerson } from './kit/AvatarStack';

const TOP: Record<string, React.ComponentType> = { activepieces: ActivepiecesSetup, builder: AutomationBuilder, compare: ProgramCompare, funnel: Funnel };

const cell = (c: Col, r: Row) => {
  const v = c.get ? c.get(r) : getPath(r, c.key);
  if (c.type === 'pill') return <Pill>{v as string}</Pill>;
  if (c.type === 'tags') return Array.isArray(v) && v.length ? <TagChips tags={v as string[]} /> : <span className="text-muted">—</span>;
  if (c.type === 'person') return <PersonChip name={v as string} />;
  if (c.type === 'people') { const t = (v || {}) as { people?: StackPerson[]; more?: number; moreLabel?: string }; return t.people?.length || t.more ? <AvatarStack size="sm" people={t.people || []} more={t.more || 0} moreLabel={t.moreLabel} /> : <span className="text-muted">—</span>; }
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

/** The filter values of one cell: each tag on its own, otherwise the shown text. */
const values = (c: Col, r: Row): string[] => {
  if (c.type === 'tags') { const t = getPath(r, c.key) as string[] | null; return t?.length ? t : ['(empty)']; }
  return [plain(c, r) || '(empty)'];
};
const columns0 = (cfg: PageCfg) => cfg.columns;
/** Hover card on a person's name: the rest of the row at a glance. */
const peek = (cfg: PageCfg, columns: Col[], r: Row) => (
  <span className="block">
    <span className="flex items-center gap-2">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accentSoft text-[13px] font-semibold text-accentText">{cfg.rowTitle(r).split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
      <span className="min-w-0"><span className="block truncate text-[14px] font-semibold text-text">{cfg.rowTitle(r)}</span><span className="block text-[12px] text-muted">{cfg.kind}</span></span>
    </span>
    <span className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
      {columns.slice(1, 7).filter((c) => c.type !== 'tags' && plain(c, r)).map((c) => <span key={c.key} className="contents"><span className="text-muted">{c.label}</span><span className="truncate text-text">{short(c, r)}</span></span>)}
    </span>
    {Array.isArray(r.tags) && r.tags.length > 0 && <span className="mt-2 block"><TagChips tags={r.tags} max={5} /></span>}
    <span className="mt-2 block text-[11.5px] text-muted">Click the row for the quick panel.</span>
  </span>
);
const plain = (c: Col, r: Row) => { const v = c.get ? c.get(r) : getPath(r, c.key); return v == null ? '' : String(v); };
const short = (c: Col, r: Row) => {
  const v = c.get ? c.get(r) : getPath(r, c.key);
  if (v == null || v === '') return '';
  return c.type === 'money' ? money(v) : c.type === 'date' ? fmtDate(v) : c.type === 'datetime' ? fmtDateTime(v) : c.type === 'pct' ? v + '%' : c.type === 'duration' ? fmtDuration(v) : c.type === 'people' ? ((v as { text?: string }).text ?? '') : String(v);
};

export function PageHeader({ group, title, purpose, scope, children }: { group: string; title: string; purpose: string; scope: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted">{group}{group && scope ? ' · ' : ''}<span className="text-accentText">{scope}</span></div>
        <h1 className="mt-0.5 text-[22px] font-semibold leading-tight">{title}</h1>
        <p className="mt-1 max-w-[70ch] text-[13.5px] text-text2">{purpose}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}

export function ListPage({ cfg }: { cfg: PageCfg }) {
  const s = useSession();
  const toast = useToast();
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
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [range, setRange] = useState<Range>(null);
  const [adv, setAdv] = useState<Adv>(null);   // advanced filter, applied by the database
  const advRef = useRef<string | null>(null);
  advRef.current = advExpr(adv, advFields(cfg));
  const [amount, setAmount] = useState<[number, number] | null>(null);   // Amount filter (pages with a money column)
  // the date the range picker filters on: the page's own sort date (added, due, called…)
  const dateKey = cfg.order && /(_at|_on)$/.test(cfg.order.col) ? cfg.order.col : null;
  const dateLabel = columns0(cfg).find((c) => c.key === dateKey)?.label || (dateKey === 'created_at' ? 'Added' : 'Dates');
  const [filterOpen, setFilterOpen] = useState<string | null>(null);   // '' = list of columns, key = that column's values
  const [savedViews, setSavedViews] = useState<Row[]>([]);
  const [activeSaved, setActiveSaved] = useState<string | null>(null);
  const [cellEdit, setCellEdit] = useState<{ id: string; key: string } | null>(null);
  const [saving, setSaving] = useState<{ name: string; shared: string } | null>(null);
  const [density, setDensity] = useDensity();
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
      if (advRef.current) query = query.or(advRef.current);
      if (cfg.order) query = query.order(cfg.order.col, { ascending: !!cfg.order.asc, nullsFirst: false });
      const { data, error } = await query;
      if (error) { setError(friendlyError(error)); setRows([]); return; }
      all.push(...((data as Row[]) || []));
      if (!data || data.length < CHUNK) break;
    }
    setError(null); setRows(all);
  }, [cfg]);

  // "3 new leads": every 30 seconds, count records added by anyone since this list was loaded
  const [fresh, setFresh] = useState(0);
  const newest = useMemo(() => (rows || []).reduce((m, r) => (r.created_at && r.created_at > m ? r.created_at : m), ''), [rows]);
  useEffect(() => {
    setFresh(0);
    if (!newest || (cfg.readFrom && !cfg.sameRows)) return;
    const check = async () => {
      if (document.hidden) return;
      const { count } = await supabase().from(cfg.table).select('id', { count: 'exact', head: true }).gt('created_at', newest);
      setFresh(count || 0);
    };
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, [newest, cfg]);

  useEffect(() => {
    setQ(''); setSort(null); setPage(0); setPicked(new Set()); setBulkOpen(null); setColsOpen(false); setFilters({}); setFilterOpen(null); setAmount(null); setAdv(null);
    const optional = cfg.columns.filter((c) => (c as Col & { optional?: boolean }).optional).map((c) => c.key);
    try { const saved = localStorage.getItem('stint-cols:' + cfg.id); setHidden(new Set(saved ? JSON.parse(saved) : optional)); } catch { setHidden(new Set(optional)); }
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
  // columns worth filtering: a short list of repeating values (stage, owner, course, source…)
  const filterable = useMemo(() => {
    if (!rows?.length) return [] as { col: Col; values: [string, number][] }[];
    return columns.filter((c) => !['money', 'number', 'date', 'datetime', 'duration'].includes(c.type || '')).map((c) => {
      const m = new Map<string, number>();
      rows.forEach((r) => { for (const v of values(c, r)) m.set(v, (m.get(v) || 0) + 1); });
      return { col: c, values: [...m.entries()].sort((a, b) => b[1] - a[1]) };
    }).filter((f) => f.values.length > 1 && f.values.length <= 40 && f.values.length < rows.length);
  }, [rows, columns]);
  const activeFilters = Object.entries(filters).filter(([, v]) => v.length);
  // Amount filter: the first money column; bounds from the loaded rows
  const moneyCol = useMemo(() => columns.find((c) => c.type === 'money' && c.key === 'amount') || columns.find((c) => c.type === 'money') || null, [columns]);
  const moneyBounds = useMemo(() => {
    if (!moneyCol || !rows?.length) return null;
    const ns = rows.map((r) => raw(moneyCol, r)).filter((v) => v != null && v !== '' && !isNaN(Number(v))).map(Number);
    return ns.length ? [Math.floor(Math.min(...ns)), Math.ceil(Math.max(...ns))] as [number, number] : null;
  }, [moneyCol, rows]);
  const amountOn = !!(amount && moneyCol);
  const filterCount = activeFilters.length + (amountOn ? 1 : 0);
  const applySaved = (v: Row) => {
    const c = v.config || {};
    setView(Math.min(Number(c.view) || 0, (cfg.views || [{ label: 'All' }]).length - 1)); setQ(c.q || ''); setSort(c.sort || null);
    setHidden(new Set(c.hidden || [])); setFilters(c.filters || {}); setRange(c.range || null); setAmount(c.amount || null); setAdv(c.adv || null); if (c.layout && (c.layout === 'table' || cfg.board)) setLayout(c.layout);
    setActiveSaved(v.id);
  };
  const saveView = async () => {
    if (!saving?.name.trim()) return;
    const { data, error } = await supabase().from('saved_view').insert({ page_id: cfg.id, name: saving.name.trim(), shared: saving.shared,
      config: { view, q, sort, hidden: [...hidden], layout, filters, range, amount, adv } }).select().single();
    if (error) { setNotice({ tone: 'bad', text: friendlyError(error) }); return; }
    setSaving(null); await loadSaved(); setActiveSaved(data.id);
    setNotice({ tone: 'good', text: `View “${data.name}” saved${data.shared === 'team' ? ' for your team' : data.shared === 'all' ? ' for everyone' : ''}.` });
  };
  const saveCell = async (r: Row, f: Field, value: unknown) => {
    setCellEdit(null);
    if ((r[f.key] ?? null) === (value ?? null)) return;
    const { error } = await supabase().from(cfg.table).update({ [f.key]: value }).eq('id', r.id);
    if (error) { toast(f.label + ': ' + friendlyError(error), { tone: 'bad' }); return; }
    const old = r[f.key] ?? null;
    toast(`${cfg.rowTitle(r)}: ${f.label} updated.`, { undo: async () => { await supabase().from(cfg.table).update({ [f.key]: old }).eq('id', r.id); toast('Put back as it was.'); load(); } });
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
  useEffect(() => { setRows(null); setView(0); setPerson(null); setSelId(null); setEditing(null); setNotice(null); setRange(null); setLayout(cfg.board && !phone() ? 'board' : 'table'); load(); }, [cfg, load]);

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

  // open a list filtered to one stage: /p/lead?stage=Interested (funnel chart)
  useEffect(() => { const st = params.get('stage'); if (st) setFilters({ stage: [st] }); }, [params, cfg]);

  // open a person straight from the search box: /p/lead?person=lead:<id>
  useEffect(() => {
    const p = params.get('person');
    if (p && p.includes(':')) { const [kind, id] = p.split(':'); if (kind === 'lead' || kind === 'candidate') { setPerson({ kind, id }); setPanelOpen(true); } }
  }, [params]);

  // long text gets a max width and “…” (full text on hover); badges, people, dates and numbers keep their natural width
  const clip = (c: Col, i: number) => (['pill', 'person', 'people', 'tags', 'date', 'datetime', 'money', 'number', 'pct', 'duration'].includes(c.type || '') ? '' : cx('truncate', i === 0 ? 'max-w-[260px]' : 'max-w-[220px]'));
  const hover = (on: boolean, r: Row, node: React.ReactNode) => (on ? <HoverCard block card={() => peek(cfg, columns, r)}>{node}</HoverCard> : node);
  // status changes belong to the assigned person; reassigning to Admin, them or their team head
  const lockedFor = (r: Row, key: string) => !!cfg.assignee && ((key === cfg.assignee.status && !!statusLockedBy(cfg, r, s.staff, s.refs.staff || [])) || (key === cfg.assignee.field && !mayReassign(cfg, r, s.staff, s.refs.staff || [])));
  const views = cfg.views || [{ label: 'All' }];
  const shown = useMemo(() => {
    let out = (rows || []).filter((r) => !views[view]?.where || views[view].where!(r, s.staff.id));
    for (const [key, vals] of Object.entries(filters)) {
      const col = columns.find((c) => c.key === key);
      if (col && vals.length) out = out.filter((r) => values(col, r).some((v) => vals.includes(v)));
    }
    if (range && dateKey) out = out.filter((r) => inRange(r[dateKey], range));
    if (amount && moneyCol) out = out.filter((r) => { const v = raw(moneyCol, r); return v != null && v !== '' && Number(v) >= amount[0] && Number(v) <= amount[1]; });
    const term = q.trim().toLowerCase();
    if (term) out = out.filter((r) => columns.some((c) => short(c, r).toLowerCase().includes(term) || plain(c, r).toLowerCase().includes(term)));
    const col = sort && columns.find((c) => c.key === sort.key);
    if (col) out = [...out].sort((a, b) => (sort!.asc ? 1 : -1) * compare(col, a, b) || 0);
    return out;
  }, [rows, views, view, s.staff.id, q, sort, columns, filters, range, dateKey, amount, moneyCol]);
  // advanced filter changed: fetch again with the new database filter
  const advKey = advRef.current;
  const advFirst = useRef(true);
  useEffect(() => { if (advFirst.current) { advFirst.current = false; return; } setPage(0); load(); }, [advKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  // people in the current list order, for Previous / Next in the quick panel (each person once)
  const panelList = useMemo(() => {
    const seen = new Set<string>(), out: PersonRef[] = [];
    shown.forEach((r) => { const p = cfg.person?.(r); if (p && !seen.has(p.kind + p.id)) { seen.add(p.kind + p.id); out.push(p); } });
    return out;
  }, [shown, cfg]);
  const pageRows = useMemo(() => shown.slice(page * PAGE, page * PAGE + PAGE), [shown, page]);
  useEffect(() => { setPage(0); }, [q, sort, view, filters]);
  // ticked rows: only those still in the current list count
  const pickedRows = useMemo(() => shown.filter((r) => r.id && picked.has(r.id)), [shown, picked]);
  const pageIds = pageRows.map((r) => r.id).filter(Boolean) as string[];
  const pageState: boolean | 'some' = pageIds.length && pageIds.every((id) => picked.has(id)) ? true : pageIds.some((id) => picked.has(id)) ? 'some' : false;
  const togglePick = (id: string) => setPicked((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const togglePage = () => setPicked((o) => { const n = new Set(o); if (pageState === true) pageIds.forEach((id) => n.delete(id)); else pageIds.forEach((id) => n.add(id)); return n; });
  const canBulk = canWrite && !!cfg.bulk?.length && (!cfg.readFrom || !!cfg.sameRows);
  const canExport = s.staff.role === 'Admin';
  const runBulk = async (b: Bulk, value: string | null) => {
    const mine = pickedRows.filter((r) => !lockedFor(r, b.field)), notMine = pickedRows.length - mine.length;
    const before = mine.map((r) => ({ id: r.id as string, v: r[b.field] ?? null }));
    const ids = before.map((x) => x.id);
    if (!ids.length) { toast(`${b.label}: none of the ticked rows are yours to change. Only the person assigned (or their team head) can.`, { tone: 'bad' }); return; }
    setBulkBusy(true);
    const { data, error } = await supabase().from(cfg.table).update({ [b.field]: value }).in('id', ids).select('id');
    setBulkBusy(false); setBulkOpen(null);
    if (error) { toast(b.label + ': ' + friendlyError(error), { tone: 'bad' }); return; }
    const done = new Set((data || []).map((x: Row) => x.id)), skipped = ids.length - done.size + notMine;
    const shownValue = b.ref ? (s.refs[b.ref]?.find((x) => x.id === value)?.label || value) : value;
    toast(`${b.label}${b.value ? '' : ' ' + shownValue}: ${done.size} updated` + (skipped ? `, ${skipped} skipped (assigned to someone else or not allowed for your role).` : '.'), {
      tone: skipped ? 'bad' : 'good',
      undo: done.size ? async () => {
        for (const x of before.filter((y) => done.has(y.id))) await supabase().from(cfg.table).update({ [b.field]: x.v }).eq('id', x.id);
        toast('Put back as it was.'); load();
      } : undefined,
    });
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
    const field = cfg.board!.field, from = r[field];
    const { error } = await supabase().from(cfg.table).update({ [field]: to }).eq('id', r.id);
    if (error) { toast('Can’t move ' + cfg.rowTitle(r) + ': ' + friendlyError(error), { tone: 'bad' }); return; }
    const converted = cfg.id === 'lead' && to === 'Converted';
    toast(cfg.rowTitle(r) + ' moved to ' + to + (converted ? '. A candidate record was created.' : '.'), converted ? {} : {
      undo: async () => { const u = await supabase().from(cfg.table).update({ [field]: from }).eq('id', r.id); if (u.error) toast('Could not undo: ' + friendlyError(u.error), { tone: 'bad' }); else toast('Moved back to ' + from + '.'); load(); },
    });
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
          {cfg.csv && canExport && <Button variant="quiet" onClick={exportCsv}>Export</Button>}
          {cfg.person && person && !panelOpen && <Button variant="quiet" onClick={() => setPanelOpen(true)}>Show panel</Button>}
          {canWrite && cfg.fields && !cfg.noCreate && cfg.cta && <Button variant="cta" onClick={onCta}>{cfg.cta}</Button>}
        </PageHeader>

        {cfg.top && TOP[cfg.top] && (() => { const Top = TOP[cfg.top!]; return <Top />; })()}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap gap-1" role="tablist">
            {views.map((v, i) => (
              <button key={v.label} type="button" role="tab" aria-selected={view === i && !activeSaved} onClick={() => { setView(i); setActiveSaved(null); }}
                className={cx('min-h-[36px] rounded-row px-3 text-[13px] font-medium transition-colors duration-150', view === i && !activeSaved ? 'bg-accentSoft font-semibold text-accentText' : 'text-text2 hover:bg-surface2 hover:text-text')}>{v.label}</button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {dateKey && rows && rows.length > 0 && <DateRange value={range} onChange={setRange} label={dateLabel} />}
          {(filterable.length > 0 || moneyBounds) && (
            <div className="relative">
              <Button variant="quiet" size="sm" aria-expanded={filterOpen !== null} active={filterCount > 0} aria-pressed={undefined} onClick={() => setFilterOpen(filterOpen === null ? '' : null)} leftIcon={<ListFilter size={14} />}>
                Filter{filterCount ? ` · ${filterCount}` : ''}
              </Button>
              {filterOpen !== null && (
                <div role="dialog" aria-label="Filter" className="absolute right-0 z-30 mt-1 w-64 rounded-card bg-surface p-1 shadow-3">
                  {filterOpen === '' && moneyCol && moneyBounds && (
                    <button type="button" onClick={() => setFilterOpen('__amount')} className="flex min-h-[44px] w-full items-center justify-between rounded-lg px-2.5 text-left text-[13px] hover:bg-surface2">
                      <span>Amount</span><span className="text-[11.5px] text-muted">{amountOn ? 'On' : '›'}</span>
                    </button>
                  )}
                  {filterOpen === '__amount' && moneyCol && moneyBounds ? (<>
                    <button type="button" onClick={() => setFilterOpen('')} className="flex min-h-[44px] w-full items-center px-2.5 text-[12px] font-semibold text-accentText">‹ Amount ({moneyCol.label})</button>
                    <RangeSlider label="Amount" min={moneyBounds[0]} max={moneyBounds[1]} value={amount || moneyBounds} onChange={setAmount} />
                    {amountOn && <button type="button" onClick={() => setAmount(null)} className="mt-1 min-h-[44px] w-full border-t border-line text-[12.5px] font-medium text-text2">Clear Amount</button>}
                  </>) : filterOpen === '' ? filterable.map(({ col }) => (
                    <button key={col.key} type="button" onClick={() => setFilterOpen(col.key)} className="flex min-h-[40px] w-full items-center justify-between rounded-lg px-2.5 text-left text-[13px] hover:bg-surface2">
                      <span>{col.label}</span><span className="text-[11.5px] text-muted">{filters[col.key]?.length ? filters[col.key].length + ' picked' : '›'}</span>
                    </button>
                  )) : (() => {
                    const f = filterable.find((x) => x.col.key === filterOpen); if (!f) return null;
                    const cur = filters[f.col.key] || [];
                    return (<>
                      <button type="button" onClick={() => setFilterOpen('')} className="flex min-h-[36px] w-full items-center px-2.5 text-[12px] font-semibold text-accentText">‹ {f.col.label}</button>
                      <div className="max-h-64 overflow-y-auto">
                        {f.values.map(([v, n]) => (
                          <button key={v} type="button" role="menuitemcheckbox" aria-checked={cur.includes(v)}
                            onClick={() => setFilters({ ...filters, [f.col.key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] })}
                            className="flex min-h-[38px] w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] hover:bg-surface2">
                            <span className={cx('flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border', cur.includes(v) ? 'border-accent bg-accent text-white' : 'border-line2')}>{cur.includes(v) && <Check size={11} strokeWidth={3} />}</span>
                            <span className="min-w-0 flex-1 truncate">{v}</span><span className="num text-[11.5px] text-muted">{n}</span>
                          </button>
                        ))}
                      </div>
                      {cur.length > 0 && <button type="button" onClick={() => { const n = { ...filters }; delete n[f.col.key]; setFilters(n); }} className="mt-1 min-h-[34px] w-full border-t border-line text-[12.5px] font-medium text-text2">Clear {f.col.label}</button>}
                    </>);
                  })()}
                </div>
              )}
            </div>
          )}
          <FilterBuilder cfg={cfg} value={adv} onChange={setAdv} />
          {layout === 'table' && (
            <div className="relative">
              <Button variant="quiet" size="sm" aria-expanded={colsOpen} onClick={() => setColsOpen(!colsOpen)} leftIcon={<Columns3 size={14} />}>
                Columns{hidden.size ? ` · ${cols.length}/${columns.length}` : ''}
              </Button>
              {colsOpen && (
                <div role="menu" className="absolute right-0 z-30 mt-1 w-56 rounded-card bg-surface p-1 shadow-3">
                  <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Show columns</div>
                  {columns.map((c) => (
                    <button key={c.key} type="button" role="menuitemcheckbox" aria-checked={!hidden.has(c.key)} onClick={() => toggleCol(c.key)}
                      className="flex min-h-[38px] w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] hover:bg-surface2">
                      <span className={cx('flex h-4 w-4 items-center justify-center rounded-[4px] border', !hidden.has(c.key) ? 'border-accent bg-accent text-white' : 'border-line2')}>{!hidden.has(c.key) && <Check size={11} strokeWidth={3} />}</span>
                      {c.label}
                    </button>
                  ))}
                  {hidden.size > 0 && <button type="button" onClick={() => { setHidden(new Set()); try { localStorage.setItem('stint-cols:' + cfg.id, '[]'); } catch {} }} className="mt-1 min-h-[36px] w-full rounded-lg border-t border-line text-[12.5px] font-medium text-accent">Show all</button>}
                </div>
              )}
            </div>
          )}
          <label className="relative">
            <span className="sr-only">Search this list</span>
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this list" className="h-[44px] w-[180px] pl-8 pr-3 text-[13px] md:h-9 md:w-[200px]" />
          </label>
          {layout === 'table' && <IconButton size="icon-sm" aria-label={density === 'compact' ? 'Comfortable rows' : 'Compact rows'} onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
            icon={density === 'compact' ? <Rows3 size={15} /> : <Rows4 size={15} />} className="max-md:h-11 max-md:w-11" />}
          {cfg.board && (
            <ButtonGroup label="Layout">
              {(['table', 'board'] as const).map((l) => (
                <Button key={l} variant="quiet" size="sm" active={layout === l} onClick={() => setLayout(l)} className="capitalize">{l}</Button>
              ))}
            </ButtonGroup>
          )}
          </div>
        </div>

        <div className="-mt-1 flex flex-wrap items-center gap-1.5" aria-label="Saved views">
          {savedViews.map((v) => (
            <span key={v.id} className={cx('flex min-h-[34px] items-center rounded-row text-[12.5px] font-medium transition-colors', activeSaved === v.id ? 'bg-accentSoft text-accentText' : 'bg-surface2 text-text2 hover:text-text')}>
              <button type="button" aria-pressed={activeSaved === v.id} onClick={() => applySaved(v)} className="flex min-h-[34px] items-center gap-1.5 pl-3 pr-2" title={v.shared === 'me' ? 'Only you' : v.shared === 'team' ? 'Shared with ' + v.owner_role : 'Shared with everyone'}>
                <Bookmark size={13} aria-hidden />{v.name}{v.shared !== 'me' && <span className="text-[10.5px] text-muted">· {v.shared === 'team' ? 'team' : 'all'}</span>}
              </button>
              {(v.owner_id === s.staff.id || s.staff.role === 'Admin') && <Confirm align="left" ariaLabel={'Delete view ' + v.name} title={'Remove the view “' + v.name + '”?'} body={v.shared === 'me' ? undefined : 'Others who use it will lose it too.'} yes="Remove" onYes={() => deleteView(v)} className="flex h-[34px] w-7 items-center justify-center rounded-r-row text-muted hover:text-badText"><X size={13} /></Confirm>}
            </span>
          ))}
          {saving ? (
            <form onSubmit={(e) => { e.preventDefault(); saveView(); }} className="flex flex-wrap items-center gap-1.5">
              <input autoFocus aria-label="View name" placeholder="Name this view, e.g. Hot leads" maxLength={60} value={saving.name} onChange={(e) => setSaving({ ...saving, name: e.target.value })} className="h-[34px] w-[220px] px-3 text-[13px]" />
              <select aria-label="Who sees it" value={saving.shared} onChange={(e) => setSaving({ ...saving, shared: e.target.value })} className="h-[34px] px-2 text-[13px]">
                <option value="me">Just me</option><option value="team">My team ({s.staff.role})</option>
                {(s.staff.role === 'Admin' || s.staff.level === 'Head') && <option value="all">Everyone</option>}
              </select>
              <Button type="submit" variant="primary" size="sm">Save</Button>
              <Button variant="quiet" size="sm" onClick={() => setSaving(null)}>Cancel</Button>
            </form>
          ) : (
            <Button variant="quiet" size="sm" onClick={() => setSaving({ name: '', shared: 'me' })} leftIcon={<BookmarkPlus size={13} />} className="text-[12.5px]">Save this view</Button>
          )}
        </div>

        {filterCount > 0 && (
          <div className="-mt-1 flex flex-wrap items-center gap-1.5" aria-label="Active filters">
            {amountOn && (
              <span className="flex min-h-[32px] items-center gap-1 rounded-full bg-accentSoft pl-3 text-[12.5px] font-medium text-accentText">
                Amount: {rupees(amount![0])}–{rupees(amount![1])}
                <button type="button" aria-label="Remove filter Amount" onClick={() => setAmount(null)} className="flex h-8 w-7 items-center justify-center rounded-r-full hover:text-badText"><X size={13} /></button>
              </span>
            )}
            {activeFilters.map(([key, vals]) => (
              <span key={key} className="flex min-h-[32px] items-center gap-1 rounded-full bg-accentSoft pl-3 text-[12.5px] font-medium text-accentText">
                {columns.find((c) => c.key === key)?.label}: {vals.length > 2 ? vals.slice(0, 2).join(', ') + ' +' + (vals.length - 2) : vals.join(', ')}
                <button type="button" aria-label={'Remove filter ' + key} onClick={() => { const n = { ...filters }; delete n[key]; setFilters(n); }} className="flex h-8 w-7 items-center justify-center rounded-r-full hover:text-badText"><X size={13} /></button>
              </span>
            ))}
            <button type="button" onClick={() => { setFilters({}); setAmount(null); }} className="min-h-[32px] px-2 text-[12.5px] text-text2 underline">Clear all</button>
          </div>
        )}

        {cfg.kpis && rows && (
          <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
            {cfg.kpis.map((k) => <KpiCard key={k.label} label={k.label} value={<CountUp value={k.calc(rows)} />} />)}
          </section>
        )}

        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        {error && <Notice tone="bad">{error}</Notice>}
        {fresh > 0 && (
          <div className="sticky top-2 z-30 -mb-2 flex justify-center" aria-live="polite">
            <button type="button" onClick={() => { setFresh(0); load(); }} className="anim-rise flex min-h-[40px] items-center gap-2 rounded-full bg-accent px-4 text-[13px] font-semibold text-white shadow-lg hover:brightness-110">
              <ArrowUp size={14} aria-hidden />{fresh} new {fresh === 1 ? cfg.kind.toLowerCase() : cfg.kind.toLowerCase() + 's'} · Show
            </button>
          </div>
        )}

        {layout === 'table' && pickedRows.length > 0 && (
          <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-card bg-accentSoft px-3 py-2 shadow-2" aria-live="polite">
            <span className="text-[13px] font-semibold text-accentText">{pickedRows.length} selected</span>
            {canBulk && cfg.bulk!.map((b) => b.value ? (
              <Button key={b.label} variant="primary" size="sm" disabled={bulkBusy} onClick={() => runBulk(b, b.value!)}>{b.label}</Button>
            ) : (
              <span key={b.label} className="relative">
                <Button variant="outline" size="sm" disabled={bulkBusy} aria-expanded={bulkOpen?.label === b.label} onClick={() => setBulkOpen(bulkOpen?.label === b.label ? null : b)}>{b.label} …</Button>
                {bulkOpen?.label === b.label && (
                  <div role="menu" className="absolute left-0 z-30 mt-1 max-h-72 w-56 overflow-auto rounded-card bg-surface p-1 shadow-3">
                    {(b.ref ? (s.refs[b.ref] || []).map((x) => [x.id, x.label + ((x as { extra?: { role?: string } }).extra?.role ? ' · ' + (x as { extra?: { role?: string } }).extra!.role : '')]) : (b.options || s.lists[b.list || ''] || []).map((v) => [v, v])).map(([v, l]) => (
                      <button key={v} type="button" role="menuitem" onClick={() => runBulk(b, v)} className="block min-h-[38px] w-full rounded-lg px-2.5 text-left text-[13px] hover:bg-surface2">{l}</button>
                    ))}
                  </div>
                )}
              </span>
            ))}
            {canExport && <Button variant="outline" size="sm" onClick={exportCsv}>Export {pickedRows.length}</Button>}
            <span className="ml-auto"><IconButton size="icon-sm" aria-label="Clear selection" onClick={() => setPicked(new Set())} icon={<X size={16} />} /></span>
          </div>
        )}

        {rows === null ? (
          <TableSkeleton />
        ) : shown.length === 0 ? (
          q.trim() || filterCount || range ? (
            <EmptyState kind="search" title="No matches" body={'Nothing here matches your ' + [q.trim() && 'search “' + q.trim() + '”', filterCount && 'filters', range && 'dates'].filter(Boolean).join(' and ') + '.'}
              action={{ label: 'Clear search and filters', onClick: () => { setQ(''); setFilters({}); setRange(null); setAmount(null); setAdv(null); } }} />
          ) : rows.length && view > 0 ? (
            <EmptyState kind="done" title={'Nothing in “' + views[view].label + '”'} body="Try another tab above." action={{ label: 'Show ' + views[0].label, onClick: () => setView(0) }} />
          ) : (
            <EmptyState kind={cfg.empty ? 'done' : 'empty'} title={cfg.empty ? 'Nothing to do' : 'No ' + cfg.kind.toLowerCase() + 's yet'}
              body={cfg.empty || (canWrite && cfg.cta && !cfg.noCreate ? 'Add the first one to get started.' : 'There is nothing to show in this view.')}
              action={canWrite && cfg.fields && cfg.cta && !cfg.noCreate ? { label: cfg.cta, onClick: onCta } : undefined} />
          )
        ) : layout === 'board' && cfg.board ? (
          <Board stages={stages} items={shown} stageOf={(r) => r[cfg.board!.field]} selectedId={selId} storageKey={cfg.id}
            canMove={(r) => canWrite && !lockedFor(r, cfg.board!.field)} onMove={move} onOpen={openRow}
            renderCard={(r, next) => (<>
              <div className="text-[13px] font-semibold">{plain(columns[0], r) || cfg.rowTitle(r)}</div>
              <div className="mt-0.5 text-xs text-text2">{columns.slice(1, 5).filter((c) => c.key !== cfg.board!.field && c.type !== 'tags').map((c) => short(c, r)).filter(Boolean).join(' · ')}</div>
              {Array.isArray(r.tags) && r.tags.length > 0 && <div className="mt-1.5"><TagChips tags={r.tags} /></div>}
              <div className="mt-2 flex gap-1.5">
                {canWrite && next && lockedFor(r, cfg.board!.field) && <span className="flex min-h-[32px] flex-1 items-center rounded-lg bg-surface2 px-2 text-[11.5px] text-muted">Only {statusLockedBy(cfg, r, s.staff, s.refs.staff || [])} can move this</span>}
                {canWrite && next && !lockedFor(r, cfg.board!.field) && <button type="button" className="min-h-[32px] flex-1 rounded-lg border border-line2 bg-surface text-xs font-medium text-accentText" onClick={(e) => { e.stopPropagation(); move(r, next); }}>Move to {next} →</button>}
                {canWrite && cfg.fields && cfg.person && <button type="button" aria-label="Edit" className="flex h-8 w-8 items-center justify-center rounded-lg border border-line2 bg-surface" onClick={(e) => { e.stopPropagation(); setEditing(r); }}><Pencil size={13} /></button>}
              </div>
            </>)} />
        ) : (
          <Table label={(meta?.title || cfg.kind) + ' list'} density={density} className="overflow-x-auto">
            <THead>
              <Th className="ui-stick1 w-11 !pl-1 !pr-0"><Tick state={pageState} label="Select all rows on this page" onChange={togglePage} /></Th>
              {cols.map((c, ci) => {
                const on = sort?.key === c.key, num = NUMERIC.includes(c.type || '');
                return (
                  <Th key={c.key} numeric={num} aria-sort={on ? (sort!.asc ? 'ascending' : 'descending') : 'none'} className={cx('!px-1', ci === 0 && 'ui-stick2')}>
                    <button type="button" onClick={() => setSort(on ? (sort!.asc ? { key: c.key, asc: false } : null) : { key: c.key, asc: true })}
                      className={cx('inline-flex min-h-[32px] items-center gap-1 rounded-chip px-2 uppercase tracking-[inherit] transition-colors hover:bg-surface2 hover:text-text', num && 'flex-row-reverse', on && 'text-text')}>
                      {c.label}{on && (sort!.asc ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                    </button>
                  </Th>
                );
              })}
              {cfg.person && cfg.fields && <Th className="w-12"><span className="sr-only">Actions</span></Th>}
            </THead>
            <TBody>
              {pageRows.map((r) => (
                <Tr key={r.id ?? r.key ?? JSON.stringify(r)} onOpen={() => openRow(r)} selected={!!((r.id && picked.has(r.id)) || (selId === r.id && cfg.person))}>
                  <Td className="ui-stick1 w-11 !pl-1 !pr-0">{r.id ? <Tick state={picked.has(r.id)} label={'Select ' + cfg.rowTitle(r)} onChange={() => togglePick(r.id)} /> : null}</Td>
                  {cols.map((c, i) => {
                    const f0 = canWrite && (!cfg.readFrom || cfg.sameRows) && r.id ? fieldFor(cfg, c) : null;
                    const f = f0 && !lockedFor(r, f0.key) ? f0 : null;
                    const editing = f && cellEdit?.id === r.id && cellEdit?.key === c.key;
                    const tip = c.type === 'tags' || c.type === 'people' ? undefined : short(c, r) || undefined;
                    return (
                      <Td key={c.key} numeric={NUMERIC.includes(c.type || '')} title={editing ? undefined : tip} className={cx("whitespace-nowrap", i === 0 && "ui-stick2", editing && '!px-2', i === 0 ? 'font-semibold' : 'text-text2')}>
                        {editing ? inlineEditor(r, f!) : f ? hover(i === 0 && !!cfg.person?.(r), r,
                          <button type="button" title={(tip ? tip + ' · ' : '') + 'click to change'} aria-label={`${f.label}: ${plain(c, r) || 'empty'}. Change`} onClick={(e) => { e.stopPropagation(); setCellEdit({ id: r.id, key: c.key }); }}
                            className={cx('-mx-1.5 block rounded-chip px-1.5 py-0.5 text-left transition-colors hover:bg-surface2 hover:text-text', clip(c, i))}>{cell(c, r)}</button>
                        ) : hover(i === 0 && !!cfg.person?.(r), r, <span className={cx('block', clip(c, i))}>{cell(c, r)}</span>)}
                      </Td>
                    );
                  })}
                  {cfg.person && cfg.fields && (
                    <Td className="w-12 !pl-0 !pr-2">
                      <RowActions><IconButton size="icon-sm" aria-label={(canWrite ? 'Edit ' : 'View ') + cfg.rowTitle(r)} onClick={(e) => { e.stopPropagation(); setEditing(r); }} icon={<Pencil size={14} />} /></RowActions>
                    </Td>
                  )}
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        {rows && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>{layout === 'table' && pages > 1 ? `${page * PAGE + 1}–${Math.min(shown.length, page * PAGE + PAGE)} of ${shown.length}` : shown.length + ' shown'}{rows.length >= MAX_ROWS ? ` (first ${MAX_ROWS.toLocaleString('en-IN')} loaded)` : ''}</span>
            {layout === 'table' && pages > 1 && (
              <nav aria-label="Pages" className="flex items-center gap-1">
                <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page" className="flex h-9 items-center gap-1 rounded-row px-2 text-[12.5px] font-medium text-text2 transition-colors hover:bg-surface2 disabled:opacity-40"><ChevronLeft size={15} /><span className="max-sm:sr-only">Previous</span></button>
                <span className="px-1 text-[12.5px] sm:hidden">Page {page + 1} of {pages}</span>
                <span className="flex items-center gap-1 max-sm:hidden">
                  {pageItems(page + 1, pages).map((it, i) => it === 'gap' ? <span key={'g' + i} aria-hidden className="w-6 text-center">…</span> : (
                    <button key={it} type="button" onClick={() => setPage(it - 1)} aria-current={it === page + 1 ? 'page' : undefined} aria-label={'Page ' + it}
                      className={cx('h-9 min-w-9 rounded-row px-2 text-[12.5px] font-medium tabular-nums transition-colors', it === page + 1 ? 'bg-accentSoft font-semibold text-accentText' : 'text-text2 hover:bg-surface2')}>{it}</button>
                  ))}
                </span>
                <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Next page" className="flex h-9 items-center gap-1 rounded-row px-2 text-[12.5px] font-medium text-text2 transition-colors hover:bg-surface2 disabled:opacity-40"><span className="max-sm:sr-only">Next</span><ChevronRight size={15} /></button>
              </nav>
            )}
          </div>
        )}
      </main>
      {editing && <EditorPanel key={editing === 'new' ? 'new' : editing.id ?? editing.key} cfg={cfg} row={editing === 'new' ? null : editing} canWrite={canWrite} onClose={() => setEditing(null)} onSaved={saved} />}
      {showPanel && <QuickPanel person={person!} onClose={() => setPanelOpen(false)} onChanged={load}
        list={panelList} onNavigate={(np) => { setPerson(np); setSelId(shown.find((r) => cfg.person?.(r)?.id === np.id)?.id ?? null); }} />}
    </div>
  );
}
