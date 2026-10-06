'use client';
import { Board } from './kit/Board';
import { Funnel } from './kit/Funnel';
import { ArrowDown, ArrowUp, Bookmark, BookmarkPlus, Check, ListFilter, ChevronLeft, ChevronRight, Columns3, KanbanSquare, Lock, Minus, Pencil, RotateCw, Search, Settings2, Table2, X, Phone, CalendarPlus, NotebookPen } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { stageMoves, useStageRules } from '@/lib/stageMoves';
import { dayStart, getPath, mayReassign, statusLockedBy, type Bulk, type Col, type Field, type Kpi, type PageCfg, type PersonRef, type Q, type Row } from '@/lib/pages';
import { ilikeHas, likeTerm, pgQuote } from '@/lib/pgrst';
import { Button, ButtonGroup, IconButton, Notice, Pill, cx, fmtDate, fmtDateTime, fmtDuration, money } from './ui';
import { EditorPanel } from './EditorPanel';
import { QuickPanel } from './QuickPanel';
import { friendlyError } from './Fields';
import { useToast } from './Toasts';
import { ActivepiecesSetup } from './special/ActivepiecesSetup';
import { AutomationBuilder } from './special/AutomationBuilder';
import { ProgramCompare } from './special/ProgramCompare';
import { ReportHeader } from './special/ReportHeader';
import { TableSkeleton } from './Skeletons';
import { TagChips } from './kit/Tags';
import { DateRange, inRange, type Range } from './kit/DateRange';
import { EmptyState } from './kit/EmptyState';
import { HoverCard } from './kit/HoverCard';
import { Confirm } from './kit/Confirm';
import { RangeSlider, rupees } from './kit/RangeSlider';
import { FilterBuilder, advExpr, advFields, type Adv } from './kit/FilterBuilder';
import { PersonChip } from './kit/Avatar';
import { SwipeRow, type SwipeAction } from './kit/SwipeRow';
import { Table, THead, TBody, Th, Td, Tr, RowActions, useDensity } from './kit/Table';
import { AvatarStack, type StackPerson } from './kit/AvatarStack';

const TOP: Record<string, React.ComponentType> = { activepieces: ActivepiecesSetup, builder: AutomationBuilder, compare: ProgramCompare, funnel: Funnel, report: ReportHeader };

/** When the next call / follow-up is due: overdue (before today), today, or later. */
const dueOf = (v: unknown): { tone: 'bad' | 'today' | 'later'; text: string } => {
  const d = new Date(String(v).length === 10 ? String(v) + 'T00:00' : String(v));
  const dateOnly = String(v).length === 10;
  if (d.getTime() < new Date(dayStart()).getTime()) return { tone: 'bad', text: 'Overdue · ' + d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) };
  if (d.getTime() < new Date(dayStart(1)).getTime()) return { tone: 'today', text: 'Today' + (dateOnly ? '' : ' ' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })) };
  return { tone: 'later', text: dateOnly ? fmtDate(v) : fmtDateTime(v) };
};
const cell = (c: Col, r: Row, lists: Record<string, string[]> = {}) => {
  const v = c.get ? c.get(r) : getPath(r, c.key);
  if (c.type === 'due') {
    if (c.doneWhen?.(r)) return v ? <span className="text-muted">{fmtDateTime(v)}</span> : <span className="text-muted">—</span>;
    if (v == null || v === '') return <span className="text-muted">Not set</span>;
    const d = dueOf(v);
    return <span data-due={d.tone} className={cx('inline-flex items-center gap-1.5 whitespace-nowrap', d.tone === 'bad' ? 'font-semibold text-badText' : d.tone === 'today' ? 'font-semibold text-accentText' : 'text-text2')}>
      {d.tone !== 'later' && <span aria-hidden className={cx('h-1.5 w-1.5 rounded-full', d.tone === 'bad' ? 'bg-coral' : 'bg-accent')} />}{d.text}</span>;
  }
  if (c.type === 'progress') {
    const steps = lists[c.list || ''] || [], at = steps.indexOf(String(v ?? ''));
    if (v == null || v === '') return <span className="text-muted">—</span>;
    return <span className="inline-flex items-center gap-2 whitespace-nowrap"><Pill>{v as string}</Pill>
      {at >= 0 && <span className="flex items-center gap-[3px]" title={`Step ${at + 1} of ${steps.length}`}>{steps.map((st, i) => <span key={st} aria-hidden className={cx('h-1.5 w-2.5 rounded-full', i <= at ? 'bg-accent' : 'bg-line2')} />)}<span className="sr-only">Step {at + 1} of {steps.length}</span></span>}</span>;
  }
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
const PAGE = 100;      // rows per page in the table (lists loaded whole)
const SPAGE = 50;      // rows per page for server lists (cfg.server)
const BOARD_MAX = 300; // cards fetched for a server list's board; column counts are exact
const NONE = '00000000-0000-0000-0000-000000000000';
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
  // names, IDs and contact details are never edited inside the table (open the record instead)
  if (f && (f.adminEdit || ['full_name', 'name', 'code', 'mobile', 'email'].includes(f.key))) return null;
  return f && INLINE.includes(f.type) && !f.readOnly && !f.createOnly ? f : null;
};

/** The dropdown field behind a column, for server-side value filters: stage, owner, course, tags… */
const filterField = (cfg: PageCfg, c: Col): Field | null => {
  if (c.get) return null;
  const key = c.key.includes('.') ? c.key.split('.')[0] + '_id' : c.key;
  const f = (cfg.fields || []).find((x) => x.key === key);
  if (f && ['select', 'ref', 'tags'].includes(f.type)) return f;
  if (cfg.board && c.key === cfg.board.field) return { key, label: c.label, type: 'select', list: cfg.board.list };
  return null;
};
/** How the database sorts a column: plain column, or a to-one join like owner(full_name). null = not sortable on the server. */
const orderKey = (c: Col) => (c.get || c.key.startsWith('custom.') ? null : c.key.includes('.') ? c.key.split('.')[0] + '(' + c.key.split('.')[1] + ')' : c.key);

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
  if (c.type === 'due') return dueOf(v).text;
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
  const canRead = s.can(cfg.id, 'r');
  const canWrite = s.can(cfg.id, 'w') && !cfg.readOnly;
  const server = !!cfg.server;
  const src = cfg.readFrom || cfg.table;
  // lead and candidate stages follow the Stage rules page (migration 073): only allowed moves are offered
  const ruleKind = cfg.board?.field === 'stage' && (cfg.table === 'lead' || cfg.table === 'candidate') ? cfg.table : null;
  const stageRules = useStageRules(ruleKind || 'lead', cfg.board ? s.lists[cfg.board.list] || [] : []);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);          // server lists: rows matching everything picked
  const [boardTotals, setBoardTotals] = useState<Record<string, number> | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [anyRows, setAnyRows] = useState<boolean | null>(null);     // server lists: does this person see any record at all?
  const [kpiVals, setKpiVals] = useState<Record<string, number> | null>(null);
  const [chip, setChip] = useState<string | null>(null);            // summary number clicked as a filter (its label)
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
  const [qDeb, setQDeb] = useState('');
  useEffect(() => { const t = setTimeout(() => setQDeb(q), server ? 300 : 0); return () => clearTimeout(t); }, [q, server]);
  const [sort, setSort] = useState<{ key: string; asc: boolean } | null>(null);
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState<Bulk | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBox = useRef<HTMLDivElement>(null);
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [range, setRange] = useState<Range>(null);
  const [adv, setAdv] = useState<Adv>(null);   // advanced filter, applied by the database
  const advRef = useRef<string | null>(null);
  advRef.current = advExpr(adv, advFields(cfg));
  const advKey = advRef.current;
  const [amount, setAmount] = useState<[number, number] | null>(null);   // Amount filter (pages with a money column)
  // the date the range picker filters on: the page's own sort date (added, due, called…)
  // ?on=paid_on lets a dashboard link pick a different date column for the range (same population as its tile)
  const onCol = params.get('on');
  const dateKey = onCol && /^[a-z_]+_(at|on)$/.test(onCol) ? onCol : cfg.order && /(_at|_on)$/.test(cfg.order.col) ? cfg.order.col : null;
  const dateLabel = columns0(cfg).find((c) => c.key === dateKey)?.label || (dateKey === 'created_at' ? 'Added' : 'Dates');
  const [filterOpen, setFilterOpen] = useState<string | null>(null);   // '' = list of columns, key = that column's values
  const [savedViews, setSavedViews] = useState<Row[]>([]);
  const [activeSaved, setActiveSaved] = useState<string | null>(null);
  const [cellEdit, setCellEdit] = useState<{ id: string; key: string } | null>(null);
  const [saving, setSaving] = useState<{ name: string; shared: string } | null>(null);
  const [density, setDensity] = useDensity();
  // toolbar labels shrink to icons when the list is narrow (e.g. quick panel open), so it stays one row
  const barRef = useRef<HTMLDivElement>(null);
  const [roomy, setRoomy] = useState(true);
  useEffect(() => {
    const el = barRef.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setRoomy(e.contentRect.width >= 900));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const loadSaved = useCallback(async () => {
    const { data } = await supabase().from('saved_view').select('*').eq('page_id', cfg.id).order('created_at');
    setSavedViews(data || []);
  }, [cfg.id]);
  useEffect(() => { setActiveSaved(null); setSaving(null); loadSaved(); }, [loadSaved]);
  useEffect(() => {
    if (!menuOpen) return;
    const away = (e: MouseEvent) => { if (menuBox.current && !menuBox.current.contains(e.target as Node)) setMenuOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role=dialog][aria-label="Advanced filter"],[role=dialog][aria-label="Pick dates"]')) setMenuOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [menuOpen]);

  // admin-defined fields shown as extra columns ("Show in list")
  const columns = useMemo<Col[]>(() => [
    ...cfg.columns,
    ...s.custom.filter((f) => f.page_id === cfg.id && f.in_list === 'Yes').map((f) => ({
      key: 'custom.' + f.key, label: f.label,
      get: (r: Row) => { const v = r.custom?.[f.key]; return v === true ? 'Yes' : v === false ? 'No' : v ?? null; },
    })),
  ], [cfg, s.custom]);
  const views = cfg.views || [{ label: 'All' }];
  const moneyCol = useMemo(() => columns.find((c) => c.type === 'money' && c.key === 'amount') || columns.find((c) => c.type === 'money') || null, [columns]);
  const chipKpi: Kpi | undefined = chip ? cfg.kpis?.find((k) => k.label === chip) : undefined;

  /* ---------- server lists: the database filters, sorts and pages ---------- */
  // search: text columns of the list, plus names behind owner / course / person columns (looked up first)
  const searchOr = useCallback(async (term: string): Promise<string[]> => {
    const out: string[] = [], low = term.toLowerCase();
    for (const c of columns) {
      if (c.get || c.key.startsWith('custom.')) continue;
      if (!c.key.includes('.')) { if (!c.type || c.type === 'text' || c.type === 'pill' || c.type === 'progress') out.push(ilikeHas(c.key, term)); continue; }
      const f = (cfg.fields || []).find((x) => x.key === c.key.split('.')[0] + '_id');
      if (f?.type === 'ref') { const ids = (s.refs[f.ref || ''] || []).filter((x) => x.label.toLowerCase().includes(low)).map((x) => x.id).slice(0, 200); if (ids.length) out.push(`${f.key}.in.(${ids.join(',')})`); }
    }
    for (const f of (cfg.fields || []).filter((x) => x.type === 'person' && x.person)) {
      const { data } = await supabase().from(f.person === 'lead' ? 'lead_list' : 'candidate').select('id').ilike('full_name', '%' + term + '%').limit(200);
      const ids = (data || []).map((x: Row) => x.id); if (ids.length) out.push(`${f.key}.in.(${ids.join(',')})`);
    }
    return out;
  }, [columns, cfg, s.refs]);
  // every filter picked on the page, applied to a query (sync: never return a query builder from an async function, awaiting runs it)
  const scope = useCallback((query: Q, ors: string[] | null, opt: { noChip?: boolean } = {}) => {
    const v = views[view]; if (v?.filter) query = v.filter(query, s.staff.id);
    if (!opt.noChip && chipKpi?.filter) query = chipKpi.filter(query);
    for (const [key, vals] of Object.entries(filters)) {
      const col = columns.find((c) => c.key === key), f = col && filterField(cfg, col);
      if (!f || !vals.length) continue;
      const empty = vals.includes('(empty)');
      let raw = vals.filter((x) => x !== '(empty)');
      if (f.type === 'ref') raw = raw.map((l) => (s.refs[f.ref || ''] || []).find((x) => x.label === l)?.id).filter(Boolean) as string[];
      if (f.type === 'tags') query = raw.length ? query.overlaps(f.key, raw) : query.or(`${f.key}.is.null,${f.key}.eq.{}`);
      else if (empty && raw.length) query = query.or(`${f.key}.is.null,${f.key}.in.(${raw.map(pgQuote).join(',')})`);
      else if (empty) query = query.is(f.key, null);
      else query = query.in(f.key, raw.length ? raw : [NONE]);
    }
    if (range && dateKey) {
      if (dateKey.endsWith('_on')) query = query.gte(dateKey, range.from).lte(dateKey, range.to);
      else { const end = new Date(range.to + 'T00:00'); end.setDate(end.getDate() + 1); query = query.gte(dateKey, new Date(range.from + 'T00:00').toISOString()).lt(dateKey, end.toISOString()); }
    }
    if (amount && moneyCol && orderKey(moneyCol) === moneyCol.key) query = query.gte(moneyCol.key, amount[0]).lte(moneyCol.key, amount[1]);
    if (advRef.current) query = query.or(advRef.current);
    if (ors) query = ors.length ? query.or(ors.join(',')) : query.eq('id', NONE);
    return query;
  }, [views, view, s.staff.id, s.refs, chipKpi, filters, columns, cfg, range, dateKey, amount, moneyCol]);
  const ordered = useCallback((query: Q) => {
    const col = sort && columns.find((c) => c.key === sort.key), k = col && orderKey(col);
    const o = k ? { col: k, asc: sort!.asc } : views[view]?.order || cfg.order;
    if (o) query = query.order(o.col, { ascending: !!o.asc, nullsFirst: false });
    return query.order('id');
  }, [sort, columns, views, view, cfg.order]);

  const reqRef = useRef(0);
  const loadServer = useCallback(async () => {
    if (!server || !canRead) return;
    const id = ++reqRef.current; setBusy(true);
    const term = likeTerm(qDeb);
    const ors = term ? await searchOr(term) : null;
    if (id !== reqRef.current) return;
    const sel = cfg.select || '*';
    if (layout === 'board' && cfg.board) {
      const field = cfg.board.field, stagesL = s.lists[cfg.board.list] || [];
      const [res, ...counts] = await Promise.all([
        ordered(scope(supabase().from(src).select(sel, { count: 'exact' }), ors)).range(0, BOARD_MAX - 1),
        ...stagesL.map((st) => scope(supabase().from(src).select('id', { count: 'exact', head: true }), ors).eq(field, st)),
      ]);
      if (id !== reqRef.current) return;
      setBusy(false);
      if (res.error) { setError(friendlyError(res.error)); setRows([]); setTotal(0); return; }
      setError(null); setRows((res.data as Row[]) || []); setTotal(res.count ?? 0);
      setBoardTotals(Object.fromEntries(stagesL.map((st, i) => [st, (counts[i] as { count: number | null }).count ?? 0])));
      return;
    }
    const res = await ordered(scope(supabase().from(src).select(sel, { count: 'exact' }), ors)).range(page * SPAGE, page * SPAGE + SPAGE - 1);
    if (id !== reqRef.current) return;
    setBusy(false);
    if (res.error) {
      if (page > 0 && /range|PGRST103/i.test(res.error.message + (res.error.code || ''))) { setPage(0); return; }
      setError(friendlyError(res.error)); setRows([]); setTotal(0); return;
    }
    setError(null); setRows((res.data as Row[]) || []); setTotal(res.count ?? 0); setBoardTotals(undefined);
  }, [server, canRead, qDeb, searchOr, cfg, layout, s.lists, ordered, scope, src, page]);

  // summary numbers: counted by the database over every record this person may see (row security applies)
  const loadKpis = useCallback(async () => {
    if (!server || !cfg.kpis || !canRead) return;
    const out: Record<string, number> = {};
    await Promise.all(cfg.kpis.filter((k) => k.filter && !k.sumKey).map(async (k) => {
      const { count } = await k.filter!(supabase().from(src).select('id', { count: 'exact', head: true }));
      out[k.label] = count ?? 0;
    }));
    if (cfg.summaryRpc) {
      const { data } = await supabase().rpc(cfg.summaryRpc);
      cfg.kpis.filter((k) => k.sumKey).forEach((k) => { out[k.label] = Number((data as Row | null)?.[k.sumKey!] ?? 0); });
    }
    setKpiVals(out);
  }, [server, cfg, src, canRead]);

  /* ---------- small lists: fetch everything the person may see, in chunks, so search, sort, views and totals cover all rows ---------- */
  const loadClient = useCallback(async () => {
    if (server || !canRead) return;
    const all: Row[] = [];
    for (let from = 0; from < MAX_ROWS; from += CHUNK) {
      let query = supabase().from(src).select(cfg.select || '*').range(from, from + CHUNK - 1);
      if (advRef.current) query = query.or(advRef.current);
      if (cfg.order) query = query.order(cfg.order.col, { ascending: !!cfg.order.asc, nullsFirst: false });
      const { data, error } = await query;
      if (error) { setError(friendlyError(error)); setRows([]); return; }
      all.push(...((data as Row[]) || []));
      if (!data || data.length < CHUNK) break;
    }
    setError(null); setRows(all);
  }, [cfg, server, src, canRead, advKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // after a change (save, move, bulk): fetch the list and the summary again
  const load = useCallback(() => { if (server) { loadServer(); loadKpis(); } else loadClient(); }, [server, loadServer, loadKpis, loadClient]);

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
    setQ(''); setQDeb(''); setSort(null); setPage(0); setPicked(new Set()); setBulkOpen(null); setMenuOpen(false); setFilters({}); setFilterOpen(null); setAmount(null); setAdv(null); setChip(null);
    setRows(null); setTotal(null); setKpiVals(null); setAnyRows(null); setView(0); setPerson(null); setSelId(null); setEditing(null); setNotice(null); setRange(null); setLayout(cfg.board && !phone() ? 'board' : 'table');
    const optional = cfg.columns.filter((c) => c.optional).map((c) => c.key);
    try { const saved = localStorage.getItem('stint-cols:' + cfg.id); setHidden(new Set(saved ? JSON.parse(saved) : optional)); } catch { setHidden(new Set(optional)); }
  }, [cfg]);
  useEffect(() => { if (server) loadServer(); else loadClient(); }, [server, loadServer, loadClient]);
  useEffect(() => { loadKpis(); }, [loadKpis]);
  // server list came back empty with nothing picked: is it a new list, or just this tab?
  useEffect(() => {
    if (!server || total !== 0 || anyRows !== null) return;
    supabase().from(src).select('id', { count: 'exact', head: true }).then(({ count }: { count: number | null }) => setAnyRows((count ?? 0) > 0));
  }, [server, total, anyRows, src]);

  const toggleCol = (key: string) => setHidden((old) => {
    const n = new Set(old); if (n.has(key)) n.delete(key); else if (cfg.columns.length - n.size > 1) n.add(key);
    try { localStorage.setItem('stint-cols:' + cfg.id, JSON.stringify([...n])); } catch {}
    return n;
  });
  const cols = columns.filter((c) => !hidden.has(c.key));
  // columns worth filtering: a short list of repeating values (stage, owner, course, source…)
  const filterable = useMemo(() => {
    if (server) {
      return columns.map((c) => {
        const f = filterField(cfg, c); if (!f) return null;
        const opts = f.type === 'ref' ? (s.refs[f.ref || ''] || []).map((x) => x.label) : (f.options || s.lists[f.list || ''] || []);
        return { col: c, values: [...opts, ...(f.type === 'tags' ? [] : ['(empty)'])].map((v) => [v, null] as [string, number | null]) };
      }).filter((x): x is { col: Col; values: [string, number | null][] } => !!x && x.values.length > 1 && x.values.length <= 60);
    }
    if (!rows?.length) return [] as { col: Col; values: [string, number | null][] }[];
    return columns.filter((c) => !['money', 'number', 'date', 'datetime', 'duration', 'due'].includes(c.type || '')).map((c) => {
      const m = new Map<string, number>();
      rows.forEach((r) => { for (const v of values(c, r)) m.set(v, (m.get(v) || 0) + 1); });
      return { col: c, values: [...m.entries()].sort((a, b) => b[1] - a[1]) as [string, number | null][] };
    }).filter((f) => f.values.length > 1 && f.values.length <= 40 && f.values.length < rows.length);
  }, [server, rows, columns, cfg, s.refs, s.lists]);
  const activeFilters = Object.entries(filters).filter(([, v]) => v.length);
  // Amount filter: the first money column; bounds from the loaded rows (server lists: smallest and largest in the database)
  const [serverBounds, setServerBounds] = useState<[number, number] | null>(null);
  useEffect(() => {
    setServerBounds(null);
    if (!server || !moneyCol || orderKey(moneyCol) !== moneyCol.key || !canRead) return;
    (async () => {
      const [lo, hi] = await Promise.all([true, false].map((asc) => supabase().from(src).select(moneyCol.key).not(moneyCol.key, 'is', null).order(moneyCol.key, { ascending: asc }).limit(1)));
      const a = Number((lo.data as Row[] | null)?.[0]?.[moneyCol.key]), b = Number((hi.data as Row[] | null)?.[0]?.[moneyCol.key]);
      if (!isNaN(a) && !isNaN(b) && (lo.data as Row[]).length) setServerBounds([Math.floor(a), Math.ceil(b)]);
    })();
  }, [server, moneyCol, src, canRead]);
  const moneyBounds = useMemo(() => {
    if (server) return serverBounds;
    if (!moneyCol || !rows?.length) return null;
    const ns = rows.map((r) => raw(moneyCol, r)).filter((v) => v != null && v !== '' && !isNaN(Number(v))).map(Number);
    return ns.length ? [Math.floor(Math.min(...ns)), Math.ceil(Math.max(...ns))] as [number, number] : null;
  }, [server, serverBounds, moneyCol, rows]);
  const amountOn = !!(amount && moneyCol);
  const filterCount = activeFilters.length + (amountOn ? 1 : 0);
  const narrowed = !!(q.trim() || filterCount || range || chip || advKey);
  const clearAll = () => { setQ(''); setFilters({}); setRange(null); setAmount(null); setAdv(null); setChip(null); };
  const applySaved = (v: Row) => {
    const c = v.config || {};
    setView(Math.min(Number(c.view) || 0, (cfg.views || [{ label: 'All' }]).length - 1)); setQ(c.q || ''); setSort(c.sort || null);
    setHidden(new Set(c.hidden || [])); setFilters(c.filters || {}); setRange(c.range || null); setAmount(c.amount || null); setAdv(c.adv || null); setChip(c.chip || null); if (c.layout && (c.layout === 'table' || cfg.board)) setLayout(c.layout);
    setActiveSaved(v.id);
  };
  const saveView = async () => {
    if (!saving?.name.trim()) return;
    const { data, error } = await supabase().from('saved_view').insert({ page_id: cfg.id, name: saving.name.trim(), shared: saving.shared,
      config: { view, q, sort, hidden: [...hidden], layout, filters, range, amount, adv, chip } }).select().single();
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
      let opts: [string, string][] = f.type === 'ref' ? (s.refs[f.ref || ''] || []).map((x) => [x.id, x.label]) : (f.options || (f.list === '__roles' ? s.roles : s.lists[f.list || ''] || [])).map((v) => [v, v]);
      const ok = ruleKind && f.key === 'stage' ? stageRules(r.stage) : null; // only the current stage and the allowed next ones
      if (ok) opts = opts.filter(([v]) => v === r.stage || ok.includes(v));
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

  // open a new record with the person filled in: /p/payment?new=candidate:<id> (quick panel "Next steps")
  useEffect(() => {
    const n = params.get('new');
    if (!n || !n.includes(':') || !canWrite || !cfg.fields) return;
    const [kind, id] = n.split(':');
    const due = params.get('due_at'); // calendar "add follow-up on a day" prefills the due time
    if (kind === 'lead' || kind === 'candidate') setEditing({ [kind + '_id']: id, ...(due ? { due_at: due } : {}) }); else if (!cfg.noCreate) setEditing(due ? { due_at: due } : 'new');   // ?new=x: = blank form
    router.replace('/p/' + cfg.id);
  }, [params, canWrite, cfg, router]);

  // open an existing record's editor: /p/candidate?edit=candidate:<id> (e.g. "Assign batch"); server lists fetch it if it is not on this page
  useEffect(() => {
    const e = params.get('edit');
    if (!e || !rows || !cfg.fields) return;
    const id = e.split(':')[1];
    const row = rows.find((r) => r.id === id);
    if (row) { setEditing(row); router.replace('/p/' + cfg.id); return; }
    if (server) supabase().from(src).select(cfg.select || '*').eq('id', id).maybeSingle().then(({ data }: { data: Row | null }) => { if (data) setEditing(data); router.replace('/p/' + cfg.id); });
  }, [params, rows, cfg, router, server, src]);

  // open a list filtered to one stage: /p/lead?stage=Interested (funnel chart)
  // dashboard drill-through: ?stage=A,B  ?f.status=Overdue (comma = any of)  ?view=Overdue  ?from=YYYY-MM-DD&to=YYYY-MM-DD
  useEffect(() => {
    const f: Record<string, string[]> = {};
    const st = params.get('stage'); if (st) f.stage = st.split(',');
    params.forEach((v, k) => { if (k.startsWith('f.') && v) f[k.slice(2)] = v.split(','); });
    if (Object.keys(f).length) setFilters(f);
    const vw = params.get('view'); const vi = vw ? (cfg.views || []).findIndex((x) => x.label === vw) : -1; if (vi >= 0) setView(vi);
    const from = params.get('from'), to = params.get('to');
    if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) setRange({ from, to, label: from === to ? from : from + ' to ' + to });
  }, [params, cfg]);

  // open a person straight from the search box: /p/lead?person=lead:<id>
  useEffect(() => {
    const p = params.get('person');
    if (p && p.includes(':')) { const [kind, id] = p.split(':'); if (kind === 'lead' || kind === 'candidate') { setPerson({ kind, id }); setPanelOpen(true); } }
  }, [params]);

  // long text gets a max width and “…” (full text on hover); badges, people, dates and numbers keep their natural width
  const clip = (c: Col, i: number) => (['pill', 'person', 'people', 'tags', 'date', 'datetime', 'money', 'number', 'pct', 'duration', 'due', 'progress'].includes(c.type || '') ? '' : cx('truncate', i === 0 ? 'max-w-[260px]' : 'max-w-[220px]'));
  const hover = (on: boolean, r: Row, node: React.ReactNode) => (on ? <HoverCard block card={() => peek(cfg, columns, r)}>{node}</HoverCard> : node);
  // status changes belong to the assigned person; reassigning to Admin, them or their team head
  const lockedFor = (r: Row, key: string) => !!cfg.assignee && ((key === cfg.assignee.status && !!statusLockedBy(cfg, r, s.staff, s.refs.staff || [])) || (key === cfg.assignee.field && !mayReassign(cfg, r, s.staff, s.refs.staff || [])));
  const shown = useMemo(() => {
    if (server) return rows || [];
    let out = (rows || []).filter((r) => !views[view]?.where || views[view].where!(r, s.staff.id));
    if (chipKpi?.where) out = out.filter(chipKpi.where);
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
  }, [server, rows, views, view, chipKpi, s.staff.id, q, sort, columns, filters, range, dateKey, amount, moneyCol]);
  const per = server ? SPAGE : PAGE;
  const totalN = server ? (total ?? 0) : shown.length;
  const pages = Math.max(1, Math.ceil(totalN / per));
  // people in the current list order, for Previous / Next in the quick panel (each person once)
  const panelList = useMemo(() => {
    const seen = new Set<string>(), out: PersonRef[] = [];
    shown.forEach((r) => { const p = cfg.person?.(r); if (p && !seen.has(p.kind + p.id)) { seen.add(p.kind + p.id); out.push(p); } });
    return out;
  }, [shown, cfg]);
  const pageRows = useMemo(() => (server ? shown : shown.slice(page * PAGE, page * PAGE + PAGE)), [server, shown, page]);
  useEffect(() => { setPage(0); }, [qDeb, sort, view, filters, chip, range, amount, advKey, layout]);
  useEffect(() => { setAnyRows(null); }, [view]);
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
  // Phone cards (Leads, Follow-ups, Candidates): swipe or "⋯" opens the quick panel and starts the chosen action there,
  // so calls still go through the panel's reveal flow (logged) and the list never holds an unmasked number.
  const SWIPE = ['lead', 'followups', 'candidate'].includes(cfg.id);
  const [swipeOpen, setSwipeOpen] = useState<string | null>(null);
  const [panelAct, setPanelAct] = useState<string | null>(null);   // aria-label of the quick-panel button to press once it is ready
  useEffect(() => {
    if (!panelAct) return;
    let n = 0;
    const t = setInterval(() => {
      const b = document.querySelector<HTMLButtonElement>(`aside[aria-label="Quick panel"] button[aria-label="${panelAct}"]`);
      if (b && !b.disabled) { b.click(); b.scrollIntoView({ block: 'nearest' }); }
      if (b || ++n > 30) { clearInterval(t); setPanelAct(null); }
    }, 100);
    return () => clearInterval(t);
  }, [panelAct, person]);
  const rowActs = (r: Row): { primary?: SwipeAction; actions: SwipeAction[] } => {
    const p = cfg.person?.(r);
    if (!p) return { actions: [] };
    const go = (label: string) => () => { openRow(r); setPanelAct(label); };
    const actions: SwipeAction[] = [];
    if (p.kind === 'lead' && s.can('call', 'w')) actions.push({ key: 'log', label: 'Log outcome', icon: <NotebookPen size={17} />, run: go('Log call') });
    actions.push({ key: 'task', label: 'Follow-up', icon: <CalendarPlus size={17} />, tone: 'warn', run: go('Add follow-up') });
    if (cfg.id === 'followups' && canWrite && r.status !== 'Done') actions.push({ key: 'done', label: 'Done', icon: <Check size={17} />, tone: 'good', run: async () => {
      const { error } = await supabase().from('follow_up').update({ status: 'Done' }).eq('id', r.id);
      if (error) toast('Can’t mark done: ' + friendlyError(error), { tone: 'bad' });
      else toast('Marked done: ' + cfg.rowTitle(r) + '.', { undo: async () => { await supabase().from('follow_up').update({ status: 'Open' }).eq('id', r.id); load(); } });
      load();
    } });
    return { primary: { key: 'call', label: 'Call', icon: <Phone size={17} />, tone: 'good', run: go('Call') }, actions };
  };
  const saved = (text: string) => { setEditing(null); setNotice({ tone: 'good', text }); load(); if (['users', 'program', 'batch', 'branch', 'company', 'source', 'campaign', 'fields'].includes(cfg.id)) s.reload(); };

  const move = async (r: Row, to: string) => {
    const field = cfg.board!.field, from = r[field];
    const { error } = await supabase().from(cfg.table).update({ [field]: to }).eq('id', r.id);
    if (error) { toast('Can’t move ' + cfg.rowTitle(r) + ': ' + friendlyError(error) + (error.code === '23514' && cfg.person ? ' Open the record to see what’s needed.' : ''), { tone: 'bad' }); return; }
    const converted = cfg.id === 'lead' && to === 'Converted';
    toast(cfg.rowTitle(r) + ' moved to ' + to + (converted ? '. A candidate record was created.' : '.'), converted ? {} : {
      undo: ruleKind && !stageRules(to)?.includes(from) ? undefined : async () => { const u = await supabase().from(cfg.table).update({ [field]: from }).eq('id', r.id); if (u.error) toast('Could not undo: ' + friendlyError(u.error), { tone: 'bad' }); else toast('Moved back to ' + from + '.'); load(); },
    });
    load();
  };

  const exportCsv = async () => {
    const esc = (v: string) => '"' + v.replace(/"/g, '""') + '"';
    let out = pickedRows.length ? pickedRows : shown;
    if (server && !pickedRows.length) {   // every matching row, not just this page
      const term = likeTerm(qDeb), ors = term ? await searchOr(term) : null, all: Row[] = [];
      for (let from = 0; from < MAX_ROWS; from += CHUNK) {
        const { data, error } = await ordered(scope(supabase().from(src).select(cfg.select || '*'), ors)).range(from, from + CHUNK - 1);
        if (error) { setNotice({ tone: 'bad', text: friendlyError(error) }); return; }
        all.push(...((data as Row[]) || [])); if (!data || data.length < CHUNK) break;
      }
      out = all;
    }
    const text = [cols.map((c) => esc(c.label)).join(','), ...out.map((r) => cols.map((c) => esc(c.type === 'due' ? (plain(c, r) ? fmtDateTime(plain(c, r)) : '') : plain(c, r))).join(','))].join('\n');
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
  const kpiValue = (k: Kpi): string | null => {
    if (server) { const v = kpiVals?.[k.label]; return v == null ? null : k.money ? money(v) : v.toLocaleString('en-IN'); }
    if (!rows) return null;
    const v = k.calc(rows); return typeof v === 'number' ? v.toLocaleString('en-IN') : v;
  };
  const kind = cfg.kind.toLowerCase();
  const plural = kind.endsWith('s') ? kind : kind + 's';

  if (!canRead) {
    return (
      <main className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
        <PageHeader group={meta?.grp || ''} title={meta?.title || cfg.id} purpose={cfg.purpose} scope={s.staff.role + ' · no access'} />
        <div className="anim-fade flex flex-col items-center rounded-xl border border-dashed border-line2 bg-surface px-6 py-10 text-center" data-testid="empty-noaccess">
          <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-surface2 text-muted"><Lock size={24} aria-hidden /></span>
          <div className="text-[15px] font-semibold">This list is not open to your role</div>
          <p className="mt-1 max-w-md text-[13.5px] text-text2">{s.staff.role} can’t see {meta?.title || plural}. If you need it for your work, ask your Admin to give your role access in Roles and access.</p>
        </div>
      </main>
    );
  }

  // controls that live in the "View" menu (all of them on a phone; on a computer only the less-used ones)
  const layoutToggle = cfg.board && (
    <ButtonGroup label="Layout">
      {(['table', 'board'] as const).map((l) => (
        <Button key={l} variant="quiet" size="sm" active={layout === l} onClick={() => setLayout(l)} leftIcon={l === 'table' ? <Table2 size={14} aria-hidden /> : <KanbanSquare size={14} aria-hidden />} title={roomy ? undefined : l === 'table' ? 'Table' : 'Board'} className="capitalize"><span className={roomy || menuOpen ? undefined : 'sr-only'}>{l}</span></Button>
      ))}
    </ButtonGroup>
  );
  const menuLabel = 'px-1 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted';

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden p-4 md:p-6 [&>*]:shrink-0">
        <PageHeader group={meta?.grp || ''} title={meta?.title || cfg.id} purpose={cfg.purpose}
          scope={s.staff.role === 'Admin' ? 'Admin · all records' : s.staff.role + (canWrite ? ' · can edit' : ' · view only')}>
          {cfg.csv && canExport && <Button variant="quiet" onClick={exportCsv}>Export</Button>}
          {cfg.person && person && !panelOpen && <Button variant="quiet" onClick={() => setPanelOpen(true)}>Show panel</Button>}
          {canWrite && cfg.fields && !cfg.noCreate && cfg.cta && <Button variant="cta" onClick={onCta}>{cfg.cta}</Button>}
        </PageHeader>

        {cfg.top && TOP[cfg.top] && (() => { const Top = TOP[cfg.top!]; return <Top />; })()}

        {cfg.kpis && (
          <div role="group" aria-label="Summary" data-testid="summary-strip" className="-mt-1 flex flex-wrap items-center gap-x-1 gap-y-1 text-[12.5px]">
            {cfg.kpis.map((k, i) => {
              const v = kpiValue(k), can = server ? !!k.filter : !!k.where, on = chip === k.label;
              const warn = /overdue|late|no answer/i.test(k.label) && v != null && v !== '0' && v !== '₹0';
              return (
                <span key={k.label} className="flex items-center">
                  {i > 0 && <span aria-hidden className="mr-1 hidden text-muted md:inline">·</span>}
                  <button type="button" disabled={!can} aria-pressed={can ? on : undefined} onClick={() => setChip(on ? null : k.label)}
                    title={can ? (on ? 'Showing only these. Click to show all.' : 'Show only these') : undefined}
                    className={cx('flex min-h-[32px] items-center gap-1.5 rounded-full px-2.5 transition-colors', on ? 'bg-accentSoft text-accentText' : can ? 'hover:bg-surface2' : 'cursor-default')}>
                    <span className={on ? 'font-medium' : 'text-text2'}>{k.label}</span>
                    <span className={cx('num font-semibold', warn && !on ? 'text-badText' : on ? '' : 'text-text')}>{v ?? '…'}</span>
                  </button>
                </span>
              );
            })}
          </div>
        )}

        <div ref={barRef} className="flex flex-wrap items-center gap-2 md:flex-nowrap" data-testid="list-toolbar">
          <div className="-mx-1 flex min-w-0 max-w-full gap-1 overflow-x-auto px-1 md:mx-0 md:shrink-0 md:px-0 [scrollbar-width:none]" role="tablist">
            {views.map((v, i) => (
              <button key={v.label} type="button" role="tab" aria-selected={view === i && !activeSaved} onClick={() => { setView(i); setActiveSaved(null); }}
                className={cx('min-h-[36px] shrink-0 whitespace-nowrap rounded-row px-3 text-[13px] font-medium transition-colors duration-150', view === i && !activeSaved ? 'bg-accentSoft font-semibold text-accentText' : 'text-text2 hover:bg-surface2 hover:text-text')}>{v.label}</button>
            ))}
          </div>
          <div className="flex w-full min-w-0 items-center justify-end gap-1.5 md:w-auto md:flex-1">
            <label className="relative min-w-0 flex-1 md:max-w-[240px]">
              <span className="sr-only">Search this list</span>
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this list" className="h-[44px] w-full pl-8 pr-3 text-[13px] md:h-9" />
            </label>
            {(filterable.length > 0 || moneyBounds) && (
              <div className="relative shrink-0">
                <Button variant="quiet" size="sm" aria-expanded={filterOpen !== null} active={filterCount > 0} aria-pressed={undefined} onClick={() => setFilterOpen(filterOpen === null ? '' : null)} leftIcon={<ListFilter size={14} />} className="max-md:h-11">
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
                      <button key={col.key} type="button" onClick={() => setFilterOpen(col.key)} className="flex min-h-[44px] w-full items-center justify-between rounded-lg px-2.5 text-left text-[13px] hover:bg-surface2">
                        <span>{col.label}</span><span className="text-[11.5px] text-muted">{filters[col.key]?.length ? filters[col.key].length + ' picked' : '›'}</span>
                      </button>
                    )) : (() => {
                      const f = filterable.find((x) => x.col.key === filterOpen); if (!f) return null;
                      const cur = filters[f.col.key] || [];
                      return (<>
                        <button type="button" onClick={() => setFilterOpen('')} className="flex min-h-[44px] w-full items-center px-2.5 text-[12px] font-semibold text-accentText">‹ {f.col.label}</button>
                        <div className="max-h-64 overflow-y-auto">
                          {f.values.map(([v, n]) => (
                            <button key={v} type="button" role="menuitemcheckbox" aria-checked={cur.includes(v)}
                              onClick={() => setFilters({ ...filters, [f.col.key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] })}
                              className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] hover:bg-surface2">
                              <span className={cx('flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border', cur.includes(v) ? 'border-accent bg-accent text-white' : 'border-line2')}>{cur.includes(v) && <Check size={11} strokeWidth={3} />}</span>
                              <span className="min-w-0 flex-1 truncate">{v === '(empty)' ? 'Not set' : v}</span><span className="num text-[11.5px] text-muted">{n ?? ''}</span>
                            </button>
                          ))}
                        </div>
                        {cur.length > 0 && <button type="button" onClick={() => { const n = { ...filters }; delete n[f.col.key]; setFilters(n); }} className="mt-1 min-h-[44px] w-full border-t border-line text-[12.5px] font-medium text-text2">Clear {f.col.label}</button>}
                      </>);
                    })()}
                  </div>
                )}
              </div>
            )}
            <div className="hidden shrink-0 md:block"><FilterBuilder cfg={cfg} value={adv} onChange={setAdv} compact={!roomy} /></div>
            <div ref={menuBox} className="relative shrink-0">
              <Button variant="quiet" size="sm" aria-expanded={menuOpen} aria-haspopup="dialog" active={!!range} aria-pressed={undefined} onClick={() => setMenuOpen(!menuOpen)} leftIcon={<Settings2 size={14} />} className="max-md:h-11">
                View{range ? ' · 1' : ''}
              </Button>
              {menuOpen && (
                <div role="dialog" aria-label="View options" className="absolute right-0 z-30 mt-1 flex max-h-[70vh] w-[min(300px,calc(100vw-32px))] flex-col gap-1 overflow-y-auto rounded-card bg-surface p-2 shadow-3">
                  {cfg.board && <div className="md:hidden"><div className={menuLabel}>Show as</div>{layoutToggle}</div>}
                  {dateKey && (
                    <div><div className={menuLabel}>{dateLabel}</div>
                      <DateRange value={range} onChange={(r) => { setRange(r); setMenuOpen(false); }} label={dateLabel} className="[&>[role=dialog]]:left-auto [&>[role=dialog]]:right-0" />
                    </div>
                  )}
                  <div className="md:hidden"><div className={menuLabel}>More conditions</div><FilterBuilder cfg={cfg} value={adv} onChange={setAdv} /></div>
                  {layout === 'table' && (<>
                    <div className={menuLabel}>Rows</div>
                    <ButtonGroup label="Row height">
                      <Button variant="quiet" size="sm" active={density !== 'compact'} onClick={() => setDensity('comfortable')}>Comfortable</Button>
                      <Button variant="quiet" size="sm" active={density === 'compact'} onClick={() => setDensity('compact')}>Compact</Button>
                    </ButtonGroup>
                    <div className={cx(menuLabel, 'flex items-center gap-1.5')}><Columns3 size={12} aria-hidden />Columns{hidden.size ? ` · ${cols.length}/${columns.length}` : ''}</div>
                    <div role="group" aria-label="Show columns">
                      {columns.map((c) => (
                        <button key={c.key} type="button" role="menuitemcheckbox" aria-checked={!hidden.has(c.key)} onClick={() => toggleCol(c.key)}
                          className="flex min-h-[40px] w-full items-center gap-2 rounded-lg px-1.5 text-left text-[13px] hover:bg-surface2">
                          <span className={cx('flex h-4 w-4 items-center justify-center rounded-[4px] border', !hidden.has(c.key) ? 'border-accent bg-accent text-white' : 'border-line2')}>{!hidden.has(c.key) && <Check size={11} strokeWidth={3} />}</span>
                          {c.label}
                        </button>
                      ))}
                    </div>
                    {hidden.size > 0 && <button type="button" onClick={() => { setHidden(new Set()); try { localStorage.setItem('stint-cols:' + cfg.id, '[]'); } catch {} }} className="min-h-[40px] w-full rounded-lg border-t border-line text-[12.5px] font-medium text-accent">Show all columns</button>}
                  </>)}
                </div>
              )}
            </div>
            {cfg.board && <div className="hidden shrink-0 md:block">{layoutToggle}</div>}
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

        {(filterCount > 0 || range) && (
          <div className="-mt-1 flex flex-wrap items-center gap-1.5" aria-label="Active filters">
            {range && (
              <span className="flex min-h-[32px] items-center gap-1 rounded-full bg-accentSoft pl-3 text-[12.5px] font-medium text-accentText">
                {dateLabel}: {range.label || `${fmtDate(range.from)} – ${fmtDate(range.to)}`}
                <button type="button" aria-label={'Remove filter ' + dateLabel} onClick={() => setRange(null)} className="flex h-8 w-7 items-center justify-center rounded-r-full hover:text-badText"><X size={13} /></button>
              </span>
            )}
            {amountOn && (
              <span className="flex min-h-[32px] items-center gap-1 rounded-full bg-accentSoft pl-3 text-[12.5px] font-medium text-accentText">
                Amount: {rupees(amount![0])}–{rupees(amount![1])}
                <button type="button" aria-label="Remove filter Amount" onClick={() => setAmount(null)} className="flex h-8 w-7 items-center justify-center rounded-r-full hover:text-badText"><X size={13} /></button>
              </span>
            )}
            {activeFilters.map(([key, vals]) => (
              <span key={key} className="flex min-h-[32px] items-center gap-1 rounded-full bg-accentSoft pl-3 text-[12.5px] font-medium text-accentText">
                {columns.find((c) => c.key === key)?.label}: {(vals.length > 2 ? vals.slice(0, 2).join(', ') + ' +' + (vals.length - 2) : vals.join(', ')).replace('(empty)', 'Not set')}
                <button type="button" aria-label={'Remove filter ' + key} onClick={() => { const n = { ...filters }; delete n[key]; setFilters(n); }} className="flex h-8 w-7 items-center justify-center rounded-r-full hover:text-badText"><X size={13} /></button>
              </span>
            ))}
            <button type="button" onClick={() => { setFilters({}); setAmount(null); setRange(null); }} className="min-h-[32px] px-2 text-[12.5px] text-text2 underline">Clear all</button>
          </div>
        )}

        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        {error && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1"><Notice tone="bad">{error}</Notice></div>
            <Button variant="outline" size="sm" leftIcon={<RotateCw size={14} />} onClick={() => { setError(null); load(); }}>Try again</Button>
          </div>
        )}
        {fresh > 0 && (
          <div className="sticky top-2 z-30 -mb-2 flex justify-center" aria-live="polite">
            <button type="button" onClick={() => { setFresh(0); load(); }} className="anim-rise flex min-h-[40px] items-center gap-2 rounded-full bg-accent px-4 text-[13px] font-semibold text-white shadow-lg hover:brightness-110">
              <ArrowUp size={14} aria-hidden />{fresh} new {fresh === 1 ? kind : plural} · Show
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
        ) : shown.length === 0 && !error ? (
          narrowed ? (
            <EmptyState kind="search" title="No matches" body={'Nothing here matches your ' + [q.trim() && 'search “' + q.trim() + '”', (filterCount || advKey) && 'filters', chip && '“' + chip + '”', range && 'dates'].filter(Boolean).join(' and ') + '.'}
              action={{ label: 'Clear search and filters', onClick: clearAll }} />
          ) : (server ? anyRows : (rows.length > 0)) && (view > 0 || views[view]?.filter || views[view]?.where) ? (() => {
            const all = views.findIndex((v) => !v.filter && !v.where);
            return <EmptyState kind="done" title={'Nothing in “' + views[view].label + '”'} body={cfg.empty && view === 0 ? cfg.empty : 'Nothing needs you here right now. Other tabs still have ' + plural + '.'}
              action={all >= 0 && all !== view ? { label: 'Show ' + views[all].label, onClick: () => setView(all) } : undefined} />;
          })() : server && anyRows === null ? (
            <TableSkeleton />
          ) : (
            <EmptyState kind={cfg.empty ? 'done' : 'empty'} title={cfg.empty ? 'Nothing to do' : 'No ' + plural + ' yet'}
              body={cfg.empty || (canWrite && cfg.cta && !cfg.noCreate ? `Add the first ${kind} to get started.` : `When ${plural} are added or shared with your role (${s.staff.role}), they appear here.`)}
              action={canWrite && cfg.fields && cfg.cta && !cfg.noCreate ? { label: cfg.cta, onClick: onCta } : undefined} />
          )
        ) : shown.length === 0 ? null : layout === 'board' && cfg.board ? (
          <div className={cx('transition-opacity', busy && 'opacity-60')} aria-busy={busy}>
          <Board stages={stages} items={shown} stageOf={(r) => r[cfg.board!.field]} selectedId={selId} storageKey={cfg.id} totals={server ? boardTotals : undefined}
            canMove={(r) => canWrite && !lockedFor(r, cfg.board!.field)} onMove={move} onOpen={openRow}
            allowedFrom={ruleKind ? stageRules : undefined}
            onRefused={(r, to, a) => toast(`Can’t move ${cfg.rowTitle(r)} from ${r.stage} to ${to}: that move isn’t allowed.` + (a.length ? ' Allowed next: ' + a.join(', ') + '.' : ''), { tone: 'bad' })}
            renderCard={(r, colNext) => { const next = ruleKind ? stageMoves(ruleKind, r.stage, stages, stageRules(r.stage) || []).next : colNext; return (<>
              <div className="text-[13px] font-semibold">{plain(columns[0], r) || cfg.rowTitle(r)}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-text2">
                {columns.slice(1, 5).filter((c) => c.key !== cfg.board!.field && c.type !== 'tags' && c.type !== 'progress' && (c.type === 'due' ? !c.doneWhen?.(r) : short(c, r))).map((c, i) => (
                  <span key={c.key} className="flex items-center gap-1.5">{i > 0 && <span aria-hidden className="text-muted">·</span>}{c.type === 'due' ? cell(c, r, s.lists) : short(c, r)}</span>
                ))}
              </div>
              {Array.isArray(r.tags) && r.tags.length > 0 && <div className="mt-1.5"><TagChips tags={r.tags} /></div>}
              <div className="mt-2 flex gap-1.5">
                {canWrite && next && lockedFor(r, cfg.board!.field) && <span className="flex min-h-[32px] flex-1 items-center rounded-lg bg-surface2 px-2 text-[11.5px] text-muted">Only {statusLockedBy(cfg, r, s.staff, s.refs.staff || [])} can move this</span>}
                {canWrite && next && !lockedFor(r, cfg.board!.field) && <button type="button" className="min-h-[32px] flex-1 rounded-lg border border-line2 bg-surface text-xs font-medium text-accentText" onClick={(e) => { e.stopPropagation(); move(r, next); }}>Move to {next} →</button>}
                {canWrite && cfg.fields && cfg.person && <button type="button" aria-label="Edit" className="flex h-8 w-8 items-center justify-center rounded-lg border border-line2 bg-surface" onClick={(e) => { e.stopPropagation(); setEditing(r); }}><Pencil size={13} /></button>}
              </div>
            </>); }} />
          </div>
        ) : (
          <>
          {SWIPE && (
            <ul className={cx('flex flex-col gap-2 md:hidden', busy && 'opacity-60')} aria-label={(meta?.title || cfg.kind) + ' cards'} data-testid="phone-cards">
              {pageRows.map((r) => { const k = String(r.id ?? r.key); const a = rowActs(r); return (
                <li key={k}>
                  <SwipeRow label={cfg.rowTitle(r)} primary={a.primary} actions={a.actions} open={swipeOpen === k} onOpenChange={(o) => setSwipeOpen(o ? k : null)} onTap={() => openRow(r)}>
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{plain(columns[0], r) || cfg.rowTitle(r)}</span>
                      {(() => { const c = columns.find((c) => c.type === 'pill'); return c && short(c, r) ? <span className="shrink-0">{cell(c, r, s.lists)}</span> : null; })()}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-text2">
                      {columns.slice(1, 6).filter((c) => c.type !== 'pill' && c.type !== 'tags' && c.type !== 'progress' && c.type !== 'people' && short(c, r)).slice(0, 3).map((c, i) => (
                        <span key={c.key} className="flex min-w-0 items-center gap-1.5">{i > 0 && <span aria-hidden className="text-muted">·</span>}<span className="truncate">{c.type === 'due' ? cell(c, r, s.lists) : short(c, r)}</span></span>
                      ))}
                    </span>
                  </SwipeRow>
                </li>
              ); })}
            </ul>
          )}
          <Table label={(meta?.title || cfg.kind) + ' list'} density={density} className={cx('overflow-x-auto transition-opacity', busy && 'opacity-60', SWIPE && 'max-md:hidden')}>
            <THead>
              <Th className="ui-stick1 w-11 !pl-1 !pr-0"><Tick state={pageState} label="Select all rows on this page" onChange={togglePage} /></Th>
              {cols.map((c, ci) => {
                const on = sort?.key === c.key, num = NUMERIC.includes(c.type || ''), sortable = !server || !!orderKey(c);
                return (
                  <Th key={c.key} numeric={num} aria-sort={on ? (sort!.asc ? 'ascending' : 'descending') : 'none'} className={cx('!px-1', ci === 0 && 'ui-stick2')}>
                    {sortable ? (
                      <button type="button" onClick={() => setSort(on ? (sort!.asc ? { key: c.key, asc: false } : null) : { key: c.key, asc: true })}
                        className={cx('inline-flex min-h-[32px] items-center gap-1 rounded-chip px-2 uppercase tracking-[inherit] transition-colors hover:bg-surface2 hover:text-text', num && 'flex-row-reverse', on && 'text-text')}>
                        {c.label}{on && (sort!.asc ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                      </button>
                    ) : <span className="inline-flex min-h-[32px] items-center px-2">{c.label}</span>}
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
                            className={cx('-mx-1.5 block rounded-chip px-1.5 py-0.5 text-left transition-colors hover:bg-surface2 hover:text-text', clip(c, i))}>{cell(c, r, s.lists)}</button>
                        ) : hover(i === 0 && !!cfg.person?.(r), r, <span className={cx('block', clip(c, i))}>{cell(c, r, s.lists)}</span>)}
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
          </>
        )}
        {rows && shown.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted" data-testid="list-count">
            <span aria-live="polite">{layout === 'board'
              ? (server && shown.length < totalN ? `Showing ${shown.length.toLocaleString('en-IN')} of ${totalN.toLocaleString('en-IN')} on the board` : `${totalN} shown`)
              : pages > 1 ? `Showing ${(page * per + 1).toLocaleString('en-IN')}–${Math.min(totalN, page * per + per).toLocaleString('en-IN')} of ${totalN.toLocaleString('en-IN')}` : totalN + ' shown'}
              {!server && rows.length >= MAX_ROWS ? ` (first ${MAX_ROWS.toLocaleString('en-IN')} loaded)` : ''}</span>
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
