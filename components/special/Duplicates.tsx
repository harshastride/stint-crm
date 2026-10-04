'use client';
import { useCallback, useEffect, useState } from 'react';
import { Merge } from 'lucide-react';
import { EmptyState } from '../kit/EmptyState';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { PageHeader } from '../ListPage';
import { Notice, cx } from '../ui';
import { friendlyError } from '../Fields';

/** Admin: records that look like the same person, and a one-click merge that keeps everything linked to both. */
export function Duplicates() {
  const s = useSession();
  const [pairs, setPairs] = useState<Row[] | null>(null);
  const [confirm, setConfirm] = useState<{ pair: Row; keep: 'a' | 'b' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const load = useCallback(async () => { const { data, error } = await supabase().rpc('find_duplicates'); if (error) setMsg({ tone: 'bad', text: friendlyError(error) }); setPairs(data || []); }, []);
  useEffect(() => { load(); }, [load]);

  const merge = async () => {
    if (!confirm) return;
    const { pair, keep } = confirm;
    const keepId = keep === 'a' ? pair.a_id : pair.b_id, dropId = keep === 'a' ? pair.b_id : pair.a_id;
    setBusy(true);
    const { data, error } = await supabase().rpc('merge_people', { p_kind: pair.kind, keep_id: keepId, drop_id: dropId });
    setBusy(false); setConfirm(null);
    if (error) { setMsg({ tone: 'bad', text: friendlyError(error) }); return; }
    setMsg({ tone: 'good', text: `Merged into ${keep === 'a' ? pair.a_name : pair.b_name}: ${data.moved} linked items moved, the duplicate removed.` });
    load();
  };

  const side = (p: Row, which: 'a' | 'b') => (
    <div className={cx('flex flex-1 flex-col gap-2 rounded-xl border p-3', confirm?.pair === p && confirm.keep === which ? 'border-accent bg-accentSoft' : 'border-line')}>
      <div className="font-semibold">{p[which + '_name']}</div>
      <div className="text-[12.5px] text-text2">{p[which + '_info'] || '—'}</div>
      <button type="button" disabled={busy} onClick={() => setConfirm({ pair: p, keep: which })} className="mt-auto min-h-[40px] rounded-[10px] border border-line2 bg-surface text-[13px] font-semibold">Keep this one</button>
    </div>
  );

  return (
    <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <PageHeader group="Admin settings" title="Duplicates" purpose="Records that look like the same person. Pick the one to keep; calls, notes, quotes, payments and history from the other move onto it." scope={s.staff.role + (s.staff.role === 'Admin' ? ' · can merge' : ' · view only')} />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {pairs === null ? <div className="rounded-xl border border-line bg-surface p-6 text-muted">Looking for duplicates…</div>
        : pairs.length === 0 ? <EmptyState kind="done" title="No duplicates found" body="Leads and students all look unique right now." />
        : pairs.map((p, i) => (
          <section key={i} className="rounded-xl border border-line bg-surface p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
              <span className="rounded-full bg-surface2 px-2.5 py-1 font-semibold capitalize">{p.kind}</span>
              <span className="text-text2">{p.reason}</span>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">{side(p, 'a')}{side(p, 'b')}</div>
            {confirm?.pair === p && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-warnBg p-3 text-[13px] text-warnText">
                <span className="flex-1">Keep <b>{confirm.keep === 'a' ? p.a_name : p.b_name}</b> and merge <b>{confirm.keep === 'a' ? p.b_name : p.a_name}</b> into it? This can’t be undone.</span>
                <button type="button" disabled={busy} onClick={merge} className="flex min-h-[40px] items-center gap-1.5 rounded-[10px] bg-accent px-3 font-semibold text-white"><Merge size={15} />{busy ? 'Merging…' : 'Merge'}</button>
                <button type="button" onClick={() => setConfirm(null)} className="min-h-[40px] px-2 text-text2">Cancel</button>
              </div>
            )}
          </section>
        ))}
    </main>
  );
}
