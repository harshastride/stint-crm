'use client';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { Button, Notice, Pill, cx } from '../ui';
import { PageHeader } from '../ListPage';
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
    <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
      <PageHeader group="Admin settings" title="Dropdown values" purpose="The choices in every dropdown, in Stint’s own words. Pick a list to edit its values." scope={s.staff.role + (canWrite ? ' · can edit' : ' · view only')} />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(240px, 320px) minmax(0, 1fr)' }}>
        <section aria-label="Lists" className="flex max-h-[70vh] flex-col overflow-y-auto rounded-xl border border-line bg-surface p-1.5">
          {lists.map((l) => (
            <button key={l.id} type="button" onClick={() => { setSel(l.id); setMsg(null); }} className={cx('rounded-lg px-3 py-2 text-left', sel === l.id ? 'bg-accentSoft' : 'hover:bg-surface2')}>
              <div className={cx('text-[13px] font-semibold', sel === l.id && 'text-accentText')}>{l.name}</div>
              <div className="text-xs text-muted">{l.used_on} · {values.filter((v) => v.list_id === l.id && v.active).length} values</div>
            </button>
          ))}
        </section>
        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="text-lg font-semibold">{list?.name}</h2>
          <p className="mb-3 text-[13px] text-text2">Used on: {list?.used_on}. The order here is the order people see{/stage|status|result/i.test(list?.name || '') ? ', and the order of the board columns' : ''}.</p>
          <div className="flex flex-col gap-1.5">
            {mine.map((v, i) => (
              <div key={v.id} className="flex items-center gap-2 rounded-[10px] border border-line px-2.5 py-2">
                {canWrite && <button type="button" aria-label={'Move ' + v.value + ' up'} disabled={i === 0} onClick={() => shift(i, -1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-line2 bg-surface"><ArrowUp size={14} /></button>}
                {canWrite && <button type="button" aria-label={'Move ' + v.value + ' down'} disabled={i === mine.length - 1} onClick={() => shift(i, 1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-line2 bg-surface"><ArrowDown size={14} /></button>}
                <span className={cx('flex-1 text-sm font-medium', !v.active && 'text-muted line-through')}>{v.value}</span>
                {v.locked ? <Pill>Locked</Pill> : <Pill>{v.active ? 'Active' : 'Hidden'}</Pill>}
                {canWrite && !v.locked && <button type="button" onClick={() => toggle(v)} className="min-h-[32px] rounded-lg border border-line2 bg-surface px-3 text-xs font-medium">{v.active ? 'Hide' : 'Show'}</button>}
              </div>
            ))}
          </div>
          {canWrite && (
            <div className="mt-3 flex gap-2">
              <input aria-label="New value" className="h-11 flex-1 px-3 text-sm" placeholder="New value" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
              <Button variant="cta" onClick={add}>Add value</Button>
            </div>
          )}
          <p className="mt-3 text-xs text-muted">Hidden values stay on old records. Locked values are ones the app’s own rules depend on.</p>
        </section>
      </div>
    </main>
  );
}
