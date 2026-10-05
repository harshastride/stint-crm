'use client';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { Button, IconButton, Notice, Pill, cx } from '../ui';
import { PageHeader } from '../kit/PageHeader';
import { friendlyError } from '../Fields';

export function Dropdowns() {
  const s = useSession();
  const canWrite = s.can('dropdowns', 'w');
  const [lists, setLists] = useState<Row[]>([]);
  const [values, setValues] = useState<Row[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  const load = useCallback(async () => {
    const db = supabase();
    const [l, v] = await Promise.all([db.from('dropdown_list').select('*').order('name'), db.from('dropdown_value').select('*').order('sort')]);
    setLists(l.data || []); setValues(v.data || []);
    setSel((cur) => cur || l.data?.[0]?.id || null);
  }, []);
  useEffect(() => { load(); }, [load]);

  const mine = values.filter((v) => v.list_id === sel);
  const list = lists.find((l) => l.id === sel);
  const after = async (error: { code?: string; message?: string } | null, text: string) => {
    if (error) { setMsg({ tone: 'bad', text: friendlyError(error) }); return; }
    setMsg({ tone: 'good', text }); await load(); await s.reload();
  };
  const add = async () => {
    const v = draft.trim();
    if (!v) { setMsg({ tone: 'bad', text: 'Type a value first.' }); return; }
    const { error } = await supabase().from('dropdown_value').insert({ list_id: sel, value: v, sort: (mine[mine.length - 1]?.sort ?? -1) + 1 });
    setDraft(''); after(error, `“${v}” added. It shows in the dropdown straight away.`);
  };
  const toggle = async (v: Row) => {
    const { error } = await supabase().from('dropdown_value').update({ active: !v.active }).eq('id', v.id);
    after(error, v.active ? `“${v.value}” hidden. Old records keep it; new ones can’t pick it.` : `“${v.value}” is back in the dropdown.`);
  };
  const shift = async (i: number, dir: -1 | 1) => {
    const a = mine[i], b = mine[i + dir];
    if (!a || !b) return;
    const db = supabase();
    const r1 = await db.from('dropdown_value').update({ sort: b.sort }).eq('id', a.id);
    const r2 = await db.from('dropdown_value').update({ sort: a.sort }).eq('id', b.id);
    after(r1.error || r2.error, 'Order changed.');
  };

  return (
    <main className="flex flex-1 flex-col gap-section overflow-y-auto p-page-sm md:p-page">
      <PageHeader title="Dropdown values" description="The choices staff see in every dropdown. Hiding a value removes it for new records only; old records keep it. Locked values drive rules and can’t be hidden."
        actions={<span className="rounded-full bg-accentSoft px-2.5 py-1 text-xs font-semibold text-accentText">{s.staff.role + (canWrite ? ' · can edit' : ' · view only')}</span>} />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="grid gap-6 md:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
        <section aria-label="Lists" className="flex max-h-[70vh] flex-col gap-0.5 overflow-y-auto">
          {lists.map((l) => (
            <button key={l.id} type="button" onClick={() => { setSel(l.id); setMsg(null); }} className={cx('rounded-lg px-2.5 py-2 text-left transition-colors duration-150', sel === l.id ? 'bg-accentSoft' : 'hover:bg-surface2')}>
              <div className={cx('truncate text-[13.5px]', sel === l.id ? 'font-semibold text-accentText' : 'font-medium')}>{l.name}</div>
              <div className="truncate text-xs text-muted">{l.used_on} · {values.filter((v) => v.list_id === l.id && v.active).length} values</div>
            </button>
          ))}
        </section>
        <section className="min-w-0 rounded-card bg-surface p-card shadow-1">
          <h2 className="text-[17px] font-semibold">{list?.name}</h2>
          <p className="mb-3 mt-0.5 text-[13px] text-text2">Used on: {list?.used_on}. The order here is the order people see{/stage|status|result/i.test(list?.name || '') ? ', and the order of the board columns' : ''}.</p>
          <div className="flex flex-col">
            {mine.map((v, i) => (
              <div key={v.id} className="group flex min-h-[48px] items-center gap-1 border-b border-line px-1 last:border-0">
                {canWrite && <IconButton size="icon-sm" aria-label={'Move ' + v.value + ' up'} disabled={i === 0} onClick={() => shift(i, -1)} icon={<ArrowUp size={15} />} />}
                {canWrite && <IconButton size="icon-sm" aria-label={'Move ' + v.value + ' down'} disabled={i === mine.length - 1} onClick={() => shift(i, 1)} icon={<ArrowDown size={15} />} />}
                <span title={v.value} className={cx('ml-1 min-w-0 flex-1 truncate text-[13.5px] font-medium', !v.active && 'text-muted line-through')}>{v.value}</span>
                {v.locked ? <Pill>Locked</Pill> : <Pill>{v.active ? 'Active' : 'Hidden'}</Pill>}
                {canWrite && !v.locked && <Button size="sm" variant="quiet" onClick={() => toggle(v)}>{v.active ? 'Hide' : 'Show'}</Button>}
              </div>
            ))}
          </div>
          {canWrite && (
            <div className="mt-4 flex gap-2">
              <input aria-label="New value" className="h-10 min-w-0 flex-1 px-3 text-sm" placeholder="New value" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
              <Button variant="primary" onClick={add}>Add value</Button>
            </div>
          )}
          <p className="mt-3 text-xs text-muted">Hidden values stay on old records. Locked values are ones the app’s own rules depend on.</p>
        </section>
      </div>
    </main>
  );
}
