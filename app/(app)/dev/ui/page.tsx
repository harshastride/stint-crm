'use client';
import type { CSSProperties } from 'react';
import { useState } from 'react';
import { Download, Filter, MoreHorizontal, Plus, Save, Trash2, ChevronDown, LayoutGrid, List } from 'lucide-react';
import { useSession } from '@/lib/session';
import { Table, THead, TBody, Th, Td, Tr, RowActions, useDensity } from '@/components/kit/Table';
import { PageHeader, KpiCard, BoardColumn } from '@/components/kit/PageHeader';
import { EmptyState } from '@/components/kit/EmptyState';
import { Button, Pill, ButtonGroup, IconButton, Toolbar, type ButtonSize, type ButtonVariant } from '@/components/ui';

// Hidden review page (Admin only). Not in the sidebar.
const LIGHT = { '--bg': '#F7F8FA', '--surface': '#FFFFFF', '--surface2': '#F2F4F7', '--line': '#E6E9EF', '--line2': '#D3D9E3', '--text': '#0F2545', '--text2': '#44506A', '--muted': '#5F6B7E', '--accent': '#4474B9', '--accentText': '#2F5C9E', '--accentSoft': '#EAF2FB', '--ink': '#0F2545', '--coral': '#FF6B35', '--badBg': '#FDECEA', '--badText': '#A12B1B' } as CSSProperties;
const DARK = { '--bg': '#0B1220', '--surface': '#121A2B', '--surface2': '#1B2538', '--line': '#263247', '--line2': '#384765', '--text': '#E8EDF6', '--text2': '#B7C2D6', '--muted': '#94A1B8', '--accent': '#4474B9', '--accentText': '#9CC2F2', '--accentSoft': '#1C2D4A', '--ink': '#2C3D61', '--coral': '#FF6B35', '--badBg': '#3B1D1B', '--badText': '#FFA194' } as CSSProperties;
const VARIANTS: ButtonVariant[] = ['primary', 'cta', 'secondary', 'outline', 'quiet', 'danger', 'link', 'ghost'];
const SIZES: ButtonSize[] = ['sm', 'md', 'lg'];

function Board({ name, vars }: { name: string; vars: CSSProperties }) {
  const [view, setView] = useState('list');
  const [busy, setBusy] = useState(false);
  return (
    <section aria-label={name + ' theme'} style={vars} className="flex flex-col gap-5 rounded-2xl border border-line bg-bg p-5 text-text">
      <h2 className="text-xs font-medium text-muted">{name}</h2>
      {VARIANTS.map((v) => (
        <div key={v} className="flex flex-wrap items-center gap-3">
          <span className="w-20 text-xs font-medium text-muted">{v}{v === 'ghost' && ' (old)'}</span>
          {SIZES.map((s) => <Button key={s} variant={v} size={s}>{s === 'md' ? 'Save' : s}</Button>)}
          <Button variant={v} leftIcon={<Plus size={16} />}>Icon</Button>
          <Button variant={v} disabled>Disabled</Button>
          <Button variant={v} loading>Loading</Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-20 text-xs font-medium text-muted">icons</span>
        <IconButton aria-label="Filter" size="icon-sm" icon={<Filter size={15} />} />
        <IconButton aria-label="Download" icon={<Download size={16} />} variant="outline" />
        <IconButton aria-label="More" size="icon-lg" icon={<MoreHorizontal size={18} />} />
        <Button variant="quiet" active leftIcon={<Filter size={16} />}>Active (pressed)</Button>
        <Button variant="primary" loading={busy} onClick={() => { setBusy(true); setTimeout(() => setBusy(false), 1200); }}>Try loading</Button>
      </div>
      <ButtonGroup label="View">
        <Button size="sm" variant="quiet" active={view === 'list'} onClick={() => setView('list')} leftIcon={<List size={15} />}>List</Button>
        <Button size="sm" variant="quiet" active={view === 'board'} onClick={() => setView('board')} leftIcon={<LayoutGrid size={15} />}>Board</Button>
      </ButtonGroup>
      <Toolbar sticky={false} start={<Button variant="quiet" rightIcon={<ChevronDown size={15} />}>More</Button>} primary={<Button variant="primary" leftIcon={<Save size={16} />}>Save</Button>}>
        <Button variant="danger" leftIcon={<Trash2 size={16} />}>Delete</Button>
        <Button>Cancel</Button>
      </Toolbar>
    </section>
  );
}

const ROWS = [
  { id: '1', name: 'Priya Reddy', course: 'Data Engineering', status: 'Interested', fee: 45000 },
  { id: '2', name: 'Ravi Kumar', course: 'Azure', status: 'Callback', fee: 38000 },
  { id: '3', name: 'Sana Shaik', course: 'Power BI', status: 'Not interested', fee: 22000 },
];
function Patterns() {
  const [density, setDensity] = useDensity('demo-density');
  const [sel, setSel] = useState('1');
  return (
    <section aria-label="Patterns" className="mt-section flex flex-col gap-section">
      <PageHeader title="Leads" description="Everyone who asked about a course, newest first."
        actions={<Button variant="primary" leftIcon={<Plus size={16} />}>New lead</Button>}
        filters={<><Button size="sm" variant="quiet" active>Mine</Button><Button size="sm" variant="quiet">Today</Button><Button size="sm" variant="quiet" leftIcon={<Filter size={15} />}>Filter</Button>
          <ButtonGroup label="Density" className="ml-auto"><Button size="sm" variant="quiet" active={density === 'comfortable'} onClick={() => setDensity('comfortable')}>Comfortable</Button><Button size="sm" variant="quiet" active={density === 'compact'} onClick={() => setDensity('compact')}>Compact</Button></ButtonGroup></>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="New today" value={12} hint="+3 vs yesterday" tone="good" />
        <KpiCard label="Follow-ups due" value={7} hint="2 overdue" tone="bad" />
        <KpiCard label="Converted" value="18%" />
        <KpiCard label="Fees this month" value="₹4.2L" />
      </div>
      <Table label="Sample leads" density={density}>
        <THead><Th>Name</Th><Th>Course</Th><Th>Status</Th><Th numeric>Fee</Th><Th><span className="sr-only">Actions</span></Th></THead>
        <TBody>{ROWS.map((r) => (
          <Tr key={r.id} selected={sel === r.id} onOpen={() => setSel(r.id)}>
            <Td>{r.name}</Td><Td className="text-text2">{r.course}</Td><Td><Pill>{r.status}</Pill></Td><Td numeric>₹{r.fee.toLocaleString('en-IN')}</Td>
            <Td><RowActions><IconButton size="icon-sm" aria-label={'More for ' + r.name} icon={<MoreHorizontal size={15} />} /></RowActions></Td>
          </Tr>))}</TBody>
      </Table>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {[['New', 2, undefined], ['Overdue', 1, 'bad']].map(([t, n, tone]) => (
          <BoardColumn key={String(t)} title={String(t)} count={Number(n)} tone={tone as 'bad' | undefined}>
            {ROWS.slice(0, Number(n)).map((r) => <div key={r.id} className="ui-card"><div className="font-semibold">{r.name}</div><div className="mt-1 text-xs text-text2">{r.course}</div></div>)}
          </BoardColumn>))}
      </div>
      <EmptyState title="No leads match" body="Try clearing a filter." kind="search" />
    </section>
  );
}

export default function UiDemo() {
  const s = useSession();
  if (s.staff.role !== 'Admin') return <p className="p-6 text-text2">This page is for Admins only.</p>;
  return (
    <main className="flex-1 overflow-y-auto p-4 md:p-6">
      <h1 className="mb-1 text-[22px] font-semibold">UI kit</h1>
      <p className="mb-5 text-text2">Every variant, size and state. Rules: docs/design/system.md and buttons.md</p>
      <div className="grid gap-5 xl:grid-cols-2"><Board name="Light" vars={LIGHT} /><Board name="Dark" vars={DARK} /></div>
      <Patterns />
    </main>
  );
}
