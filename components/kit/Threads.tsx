'use client';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, MessagesSquare, RotateCcw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { Button, cx, fmtDateTime } from '../ui';
import { friendlyError } from '../Fields';
import { MentionInput } from './MentionInput';

type Thread = {
  id: string; body: string; status: 'open' | 'resolved'; created_by: string; by_name: string | null; created_at: string;
  resolved_by_name: string | null; resolved_at: string | null; replies: number; mentions_me: boolean; mentioned: string[];
};
type Reply = { id: string; body: string; created_by: string; created_at: string; by_name?: string; edited_at?: string | null; _state?: 'pending' | 'failed'; mentioned: string[] };

export function ago(at: string) {
  const m = Math.round((Date.now() - +new Date(at)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  if (m < 60 * 24) return Math.round(m / 60) + 'h ago';
  if (m < 60 * 24 * 7) return Math.round(m / 1440) + 'd ago';
  return fmtDateTime(at);
}

/**
 * Internal discussions on one lead or candidate. The database decides who can read, reply,
 * resolve and edit; this only hides buttons people cannot use.
 * `compact` (Quick panel): one "Open discussions (n)" row that expands.
 */
export function Threads({ kind, id, compact }: { kind: 'lead' | 'candidate'; id: string; compact?: boolean }) {
  const s = useSession();
  const [list, setList] = useState<Thread[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(!compact);
  const [starting, setStarting] = useState(false);
  const [draft, setDraft] = useState(''); const [ment, setMent] = useState<string[]>([]); const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase().from('thread_feed').select('*').eq(kind === 'lead' ? 'lead_id' : 'candidate_id', id).is('deleted_at', null).order('created_at', { ascending: false }).limit(50);
    if (error) setError(friendlyError(error)); else { setError(''); setList(((data || []) as Thread[]).sort((x, y) => (x.status === y.status ? 0 : x.status === 'open' ? -1 : 1))); }
  }, [kind, id]);
  useEffect(() => { setList(null); load(); }, [load]);

  const openCount = (list || []).filter((t) => t.status === 'open').length;
  const mine = (list || []).filter((t) => t.status === 'open' && t.mentions_me).length;

  const start = async () => {
    const body = draft.trim(); if (!body || busy) return;
    setBusy(true);
    const { error } = await supabase().from('thread').insert({ [kind === 'lead' ? 'lead_id' : 'candidate_id']: id, body, mentioned: ment });
    setBusy(false);
    if (error) { setError(friendlyError(error)); return; } // draft is kept for retry
    setDraft(''); setMent([]); setStarting(false); load();
  };

  const header = (
    <div className="flex min-h-[36px] items-center justify-between gap-2">
      <button type="button" onClick={() => compact && setOpen((o) => !o)} aria-expanded={compact ? open : undefined}
        className={cx('flex min-h-[36px] items-center gap-1.5 text-[13px] font-semibold text-text', compact && 'hover:text-accentText')}>
        {compact && (open ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}
        <MessagesSquare size={15} strokeWidth={1.8} className="text-text2" aria-hidden />
        {openCount ? `Open discussions (${openCount})` : 'Discussions'}
        {mine > 0 && <span data-testid="thread-mine" title="Mentions you" className="num rounded-full bg-coral px-1.5 text-[11px] font-semibold text-white">@{mine}</span>}
      </button>
      {!starting && <Button size="sm" variant="ghost" onClick={() => { setStarting(true); setOpen(true); }}>Start discussion</Button>}
    </div>
  );

  return (
    <section aria-label="Discussions" data-testid="threads" className="flex flex-col gap-1.5">
      {header}
      {error && <p role="alert" className="text-[12.5px] text-badText">{error}</p>}
      {starting && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-line p-2">
          <MentionInput label="Discussion" placeholder="e.g. Fee issue — @Suresh please check" value={draft} onChange={setDraft} mentions={ment} onMentionsChange={setMent} />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => { setStarting(false); setDraft(''); setMent([]); }}>Cancel</Button>
            <Button size="sm" variant="primary" loading={busy} disabled={!draft.trim() || draft.length > 2000} onClick={start}>Post</Button>
          </div>
        </div>
      )}
      {open && list === null && <p className="text-[12.5px] text-muted">Loading…</p>}
      {open && list && list.length === 0 && !starting && <p className="text-[12.5px] text-muted">No discussions yet. Start one to ask a colleague about this person.</p>}
      {open && list && list.length > 0 && (
        <ul className="flex flex-col divide-y divide-line">
          {list.map((t) => <ThreadItem key={t.id} t={t} me={s.staff.id} admin={s.staff.role === 'Admin'} onChange={load} />)}
        </ul>
      )}
    </section>
  );
}

function ThreadItem({ t, me, admin, onChange }: { t: Thread; me: string; admin: boolean; onChange: () => void }) {
  const s = useSession();
  const [expanded, setExpanded] = useState(t.status === 'open');
  const [replies, setReplies] = useState<Reply[] | null>(null);
  useEffect(() => { setExpanded(t.status === 'open'); }, [t.status]);
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState(''); const [ment, setMent] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [editing, setEditing] = useState<string | null>(null); const [editText, setEditText] = useState('');
  const saveEdit = async (rid: string) => {
    setBusy(true); setErr('');
    // the database allows this only for the author within 15 minutes; 0 rows back means it refused
    const { data, error } = await supabase().from('thread_reply').update({ body: editText.trim() }).eq('id', rid).select('id');
    setBusy(false);
    if (error || !data?.length) { setErr(error ? friendlyError(error) : 'This reply can no longer be edited (15 minutes have passed).'); return; }
    setEditing(null); loadReplies();
  };
  const names = Object.fromEntries((s.refs.staff as { id: string; label: string }[]).map((p) => [p.id, p.label]));

  const loadReplies = useCallback(async () => {
    const { data } = await supabase().from('thread_reply').select('id,body,created_by,created_at,edited_at,mentioned').eq('thread_id', t.id).is('deleted_at', null).order('created_at').limit(200);
    setReplies((data || []) as Reply[]);
  }, [t.id]);
  useEffect(() => { if (expanded && t.replies > 0) loadReplies(); else if (expanded) setReplies([]); }, [expanded, t.replies, loadReplies]);

  const participant = t.created_by === me || t.mentions_me || (replies || []).some((r) => r.mentioned?.includes(me));
  const canResolve = admin || participant;

  const send = async (r: Reply) => {
    setReplies((xs) => [...(xs || []).filter((x) => x.id !== r.id), { ...r, _state: 'pending' }]);
    const { error } = await supabase().from('thread_reply').insert({ thread_id: t.id, body: r.body, mentioned: r.mentioned });
    if (error) { setReplies((xs) => (xs || []).map((x) => (x.id === r.id ? { ...x, _state: 'failed' } : x))); return; }
    await loadReplies();
  };
  const reply = () => {
    const body = draft.trim(); if (!body || body.length > 2000) return;
    send({ id: 'tmp-' + Date.now(), body, mentioned: ment, created_by: me, created_at: new Date().toISOString() });
    setDraft(''); setMent([]); setReplying(false);
  };
  const setStatus = async (status: 'open' | 'resolved') => {
    setBusy(true); setErr('');
    const { data, error } = await supabase().from('thread').update({ status }).eq('id', t.id).select('id');
    setBusy(false);
    if (error || !data?.length) { setErr(error ? friendlyError(error) : 'You cannot change this discussion.'); return; }
    onChange();
  };

  if (t.status === 'resolved' && !expanded) {
    return (
      <li className="py-1">
        <button type="button" onClick={() => setExpanded(true)} data-testid="thread-resolved" aria-label={'Show resolved discussion: ' + t.body.slice(0, 40)}
          className="flex min-h-[36px] w-full items-center gap-1.5 text-left text-[12.5px] text-text2 hover:text-text">
          <CheckCircle2 size={14} className="shrink-0 text-goodText" aria-hidden />
          <span className="truncate"><span className="text-text">{t.body.split('\n')[0]}</span> · Resolved by {t.resolved_by_name || 'someone'} · {t.resolved_at ? ago(t.resolved_at) : ''}</span>
        </button>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-1 py-2 text-[13px]" data-testid="thread">
      <div className="flex justify-between gap-2 text-[11.5px] text-muted">
        <span className="font-semibold text-text2">{t.by_name || 'Someone'}</span>
        <span>{ago(t.created_at)}{t.status === 'resolved' && <> · <span className="text-goodText">Resolved by {t.resolved_by_name}</span></>}</span>
      </div>
      <div className="whitespace-pre-wrap">{t.body}</div>
      {(replies || []).length > 0 && (
        <ul className="ml-2 flex flex-col gap-1.5 border-l-2 border-line pl-2.5" aria-label="Replies">
          {(replies || []).map((r) => (
            <li key={r.id} className={cx('text-[12.5px]', r._state === 'pending' && 'opacity-60')}>
              <div className="flex justify-between gap-2 text-[11px] text-muted">
                <span className="font-semibold text-text2">{names[r.created_by] || 'Someone'}</span>
                <span>{r._state === 'pending' ? 'Sending…' : r._state === 'failed' ? <span className="text-badText">Not sent</span> : ago(r.created_at) + (r.edited_at ? ' · edited' : '')}</span>
              </div>
              {editing === r.id ? (
                <div className="flex flex-col gap-1.5 pt-1">
                  <textarea aria-label="Edit reply" rows={2} value={editText} onChange={(e) => setEditText(e.target.value)} className="w-full rounded-lg border border-line2 bg-surface p-2 text-[13px]" autoFocus />
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                    <Button size="sm" variant="primary" loading={busy} disabled={!editText.trim() || editText.length > 2000} onClick={() => saveEdit(r.id)}>Save</Button>
                  </div>
                </div>
              ) : <div className="whitespace-pre-wrap">{r.body}</div>}
              {!r._state && editing !== r.id && r.created_by === me && Date.now() - +new Date(r.created_at) < 15 * 60000 && (
                <button type="button" onClick={() => { setEditing(r.id); setEditText(r.body); }} className="min-h-[32px] text-[12px] font-semibold text-accentText hover:underline">Edit</button>
              )}
              {r._state === 'failed' && <button type="button" onClick={() => send(r)} className="min-h-[32px] text-[12px] font-semibold text-accentText hover:underline">Retry</button>}
            </li>
          ))}
        </ul>
      )}
      {replying && (
        <div className="flex flex-col gap-1.5 pt-1">
          <MentionInput label="Reply" placeholder="Reply… type @ to notify" value={draft} onChange={setDraft} mentions={ment} onMentionsChange={setMent} />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setReplying(false)}>Cancel</Button>
            <Button size="sm" variant="primary" disabled={!draft.trim() || draft.length > 2000} onClick={reply}>Send reply</Button>
          </div>
        </div>
      )}
      {err && <p role="alert" className="text-[12px] text-badText">{err}</p>}
      {!replying && (
        <div className="flex flex-wrap items-center gap-1">
          {t.status === 'open' && <Button size="sm" variant="quiet" onClick={() => setReplying(true)}>Reply</Button>}
          {canResolve && (t.status === 'open'
            ? <Button size="sm" variant="quiet" loading={busy} leftIcon={<CheckCircle2 size={14} />} onClick={() => setStatus('resolved')}>Resolve</Button>
            : <Button size="sm" variant="quiet" loading={busy} leftIcon={<RotateCcw size={14} />} onClick={() => setStatus('open')}>Reopen</Button>)}
          {t.status === 'resolved' && <Button size="sm" variant="quiet" onClick={() => setExpanded(false)}>Collapse</Button>}
        </div>
      )}
    </li>
  );
}
