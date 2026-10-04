'use client';
import { Phone, Play, StickyNote, MessageCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { cx, fmtDuration } from '../ui';

// Chat view of one person: calls, notes and recordings as bubbles.
// No message table exists yet, so WhatsApp/messages only show when saved as a note
// with a kind like "WhatsApp" / "Message" / "Inbound" (those sit on the left as the person).
// Contact numbers are never selected here (recording.number is left out on purpose).
type Item = { id: string; at: string; side: 'me' | 'them'; kind: 'call' | 'note' | 'msg' | 'rec'; title: string; body?: string | null; by?: string | null; secs?: number; audio?: string | null };

const INBOUND = /whatsapp|message|sms|inbound|reply/i;
const dayLabel = (d: Date) => {
  const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

export function ChatThread({ kind, id }: { kind: 'lead' | 'candidate'; id: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [audio, setAudio] = useState<Record<string, string>>({});
  const end = useRef<HTMLDivElement>(null);
  const col = kind === 'lead' ? 'lead_id' : 'candidate_id';

  useEffect(() => {
    let live = true;
    const db = supabase();
    (async () => {
      const [notes, calls, recs] = await Promise.all([
        db.from('note').select('id, kind, body, created_at, by:by_id(full_name)').eq(col, id).order('created_at').limit(300),
        kind === 'lead' ? db.from('call_log').select('id, outcome, duration_sec, notes, called_at, by:caller_id(full_name)').eq('lead_id', id).order('called_at').limit(300) : Promise.resolve({ data: [] }),
        db.from('recording').select('id, length_sec, summary, outcome, audio_path, created_at, by:captured_by(full_name)').eq(col, id).order('created_at').limit(100),
      ]);
      const name = (r: { by?: unknown }) => (r.by as { full_name?: string } | null)?.full_name ?? null;
      const out: Item[] = [];
      for (const n of (notes.data ?? []) as Record<string, unknown>[]) {
        const inbound = INBOUND.test(String(n.kind ?? ''));
        out.push({ id: 'n' + n.id, at: String(n.created_at), side: inbound ? 'them' : 'me', kind: inbound ? 'msg' : 'note', title: String(n.kind ?? 'Note'), body: n.body as string, by: name(n) });
      }
      for (const c of (calls.data ?? []) as Record<string, unknown>[])
        out.push({ id: 'c' + c.id, at: String(c.called_at), side: 'me', kind: 'call', title: 'Call · ' + c.outcome, body: c.notes as string | null, by: name(c), secs: Number(c.duration_sec || 0) });
      for (const r of (recs.data ?? []) as Record<string, unknown>[])
        out.push({ id: 'r' + r.id, at: String(r.created_at), side: 'me', kind: 'rec', title: 'Recorded call' + (r.outcome ? ' · ' + r.outcome : ''), body: r.summary as string | null, by: name(r), secs: Number(r.length_sec || 0), audio: (r.audio_path as string) || null });
      out.sort((a, b) => a.at.localeCompare(b.at));
      if (live) setItems(out);
    })();
    return () => { live = false; };
  }, [col, id, kind]);

  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }); }, [items]);

  const play = async (it: Item) => {
    if (!it.audio) return;
    const { data } = await supabase().storage.from('recordings').createSignedUrl(it.audio, 300);
    if (data) setAudio((a) => ({ ...a, [it.id]: data.signedUrl }));
  };

  if (!items) return <p className="py-6 text-center text-[13px] text-text2">Loading…</p>;
  let lastDay = '';
  return (
    <div data-testid="chat" className="flex min-h-[240px] max-h-[60vh] shrink-0 flex-col gap-2 overflow-y-auto rounded-[10px] bg-surface2 p-3" role="log" aria-label="Chat">
      {items.length === 0 && <p className="py-6 text-center text-[13px] text-text2">No calls or notes yet.</p>}
      {items.map((it) => {
        const d = new Date(it.at); const day = dayLabel(d); const sep = day !== lastDay; lastDay = day;
        const Icon = it.kind === 'msg' ? MessageCircle : it.kind === 'note' ? StickyNote : Phone;
        return (
          <div key={it.id} className="contents">
            {sep && <h4 className="my-1 self-center rounded-full bg-surface px-3 py-0.5 text-[11px] font-semibold text-text2">{day}</h4>}
            <div data-side={it.side} data-kind={it.kind} className={cx('max-w-[85%] rounded-2xl px-3 py-2 text-[13px] shadow-sm', it.side === 'me' ? 'self-end rounded-br-sm bg-accent text-white' : 'self-start rounded-bl-sm bg-surface text-text')}>
              <div className="flex items-center gap-1.5 text-[12px] font-semibold"><Icon size={13} aria-hidden />{it.title}{it.secs ? <span className="font-normal opacity-80">· {fmtDuration(it.secs)}</span> : null}</div>
              {it.body && <p className="mt-0.5 whitespace-pre-wrap break-words">{it.body}</p>}
              {it.audio && (audio[it.id]
                ? <audio controls src={audio[it.id]} className="mt-1 w-full" autoPlay />
                : <button type="button" onClick={() => play(it)} className="mt-1 inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-[12px] font-semibold underline"><Play size={13} aria-hidden />Play recording</button>)}
              <div className="mt-0.5 text-right text-[10px] opacity-75">{it.by ? it.by + ' · ' : ''}{d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</div>
            </div>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}
