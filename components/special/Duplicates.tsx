'use client';
import { useCallback, useEffect, useState } from 'react';
import { Merge } from 'lucide-react';
import { EmptyState } from '../kit/EmptyState';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { PageHeader } from '../kit/PageHeader';
import { Button, Notice, cx } from '../ui';
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
    <div className={cx('flex min-w-0 flex-1 flex-col gap-2 rounded-[10px] p-3 transition-colors duration-150', confirm?.pair === p && confirm.keep === which ? 'bg-accentSoft ring-2 ring-accent' : 'bg-surface2')}>
      <div className="truncate font-semibold" title={p[which + '_name']}>{p[which + '_name']}</div>
      <div className="line-clamp-2 text-[12.5px] text-text2" title={p[which + '_info'] || ''}>{p[which + '_info'] || '—'}</div>
      <Button variant="outline" size="sm" fullWidth className="mt-auto" disabled={busy} active={confirm?.pair === p && confirm.keep === which} onClick={() => setConfirm({ pair: p, keep: which })}>Keep this one</Button>
    </div>
  );

  return (
    <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <PageHeader title="Duplicates" description={'Records that look like the same person (same phone or email). Merging keeps one record, moves all calls, notes, payments and classes from the other onto it, and deletes the other. It can’t be undone.' + (s.staff.role === 'Admin' ? '' : ' View only.')} />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {pairs === null ? <div className="rounded-[14px] bg-surface p-6 text-muted shadow-[var(--shadow-1)]">Looking for duplicates…</div>
        : pairs.length === 0 ? <EmptyState kind="done" title="No duplicates found" body="Leads and students all look unique right now." />
        : pairs.map((p, i) => (
          <section key={i} className="rounded-[14px] bg-surface p-4 shadow-[var(--shadow-1)]">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
              <span className="rounded-full bg-accentSoft px-2.5 py-0.5 text-[12px] font-semibold capitalize text-accentText">{p.kind}</span>
              <span className="text-text2">{p.reason}</span>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">{side(p, 'a')}{side(p, 'b')}</div>
            {confirm?.pair === p && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[10px] bg-warnBg p-3 text-[13px] text-warnText">
                <span className="flex-1">Keep <b>{confirm.keep === 'a' ? p.a_name : p.b_name}</b> and merge <b>{confirm.keep === 'a' ? p.b_name : p.a_name}</b> into it? All of {confirm.keep === 'a' ? p.b_name : p.a_name}’s calls, notes, payments and classes move across, then that record is deleted. This can’t be undone.</span>
                <Button variant="outline" size="sm" onClick={() => setConfirm(null)}>Cancel</Button>
                <Button variant="primary" size="sm" loading={busy} leftIcon={<Merge size={15} />} onClick={merge}>Merge</Button>
              </div>
            )}
          </section>
        ))}
    </main>
  );
}
