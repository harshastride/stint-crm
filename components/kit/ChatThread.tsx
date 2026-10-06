'use client';
import { Phone, Play, StickyNote, MessageCircle, Mail, Check, CheckCheck, Clock, AlertCircle, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button, cx, fmtDuration } from '../ui';

// Chat view of one person: calls, notes and recordings as bubbles.
// WhatsApp/email rows come from the message table (inbound left, outbound right with status ticks).
// Notes saved with a kind like "WhatsApp" / "Inbound" also sit on the left as the person.
// Contact numbers are never selected here (message.to_addr/from_addr and recording.number are not readable by staff).
type Item = { id: string; at: string; side: 'me' | 'them'; kind: 'call' | 'note' | 'msg' | 'rec' | 'wa' | 'mail'; title: string; body?: string | null; by?: string | null; secs?: number; audio?: string | null; status?: string; error?: string | null };
export type ChatChannel = 'whatsapp' | 'email';
type Tpl = { id: string; channel: ChatChannel; name: string; subject: string | null; body: string };

function Ticks({ status, error }: { status?: string; error?: string | null }) {
  if (!status) return null;
  const label = { queued: 'Waiting to send', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Not sent', received: 'Received' }[status] || status;
  const Icon = status === 'queued' ? Clock : status === 'failed' ? AlertCircle : status === 'sent' ? Check : CheckCheck;
  return <span data-status={status} title={error ? label + ': ' + error : label} aria-label={label} className={cx('inline-flex items-center', status === 'read' && 'text-sky-200')}><Icon size={12} aria-hidden /></span>;
}

const INBOUND = /whatsapp|message|sms|inbound|reply/i;
const dayLabel = (d: Date) => {
  const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

export function ChatThread({ kind, id, channel: initial, composer = true }: { kind: 'lead' | 'candidate'; id: string; channel?: ChatChannel; composer?: boolean }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [tick, setTick] = useState(0);
  const [audio, setAudio] = useState<Record<string, string>>({});
  const end = useRef<HTMLDivElement>(null);
  const col = kind === 'lead' ? 'lead_id' : 'candidate_id';

  useEffect(() => {
    let live = true;
    const db = supabase();
    (async () => {
      const [notes, calls, recs, msgs] = await Promise.all([
        db.from('note').select('id, kind, body, created_at, by:by_id(full_name)').eq(col, id).order('created_at').limit(300),
        kind === 'lead' ? db.from('call_log').select('id, outcome, duration_sec, notes, called_at, by:caller_id(full_name)').eq('lead_id', id).order('called_at').limit(300) : Promise.resolve({ data: [] }),
        db.from('recording').select('id, length_sec, summary, outcome, audio_path, created_at, by:captured_by(full_name)').eq(col, id).order('created_at').limit(100),
        db.from('message').select('id, channel, direction, subject, body, status, error, created_at, created_by').eq(col, id).order('created_at').limit(300),
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
      for (const m of (msgs.data ?? []) as Record<string, unknown>[]) {
        const wa = m.channel === 'whatsapp', inbound = m.direction === 'in';
        out.push({ id: 'm' + m.id, at: String(m.created_at), side: inbound ? 'them' : 'me', kind: wa ? 'wa' : 'mail', title: (wa ? 'WhatsApp' : 'Email') + (m.subject ? ' · ' + m.subject : ''), body: m.body as string | null, status: inbound ? undefined : String(m.status), error: m.error as string | null });
      }
      out.sort((a, b) => a.at.localeCompare(b.at));
      if (live) setItems(out);
    })();
    return () => { live = false; };
  }, [col, id, kind, tick]);

  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }); }, [items]);

  const play = async (it: Item) => {
    if (!it.audio) return;
    const { data } = await supabase().storage.from('recordings').createSignedUrl(it.audio, 300);
    if (data) setAudio((a) => ({ ...a, [it.id]: data.signedUrl }));
  };

  if (!items) return <p className="py-6 text-center text-[13px] text-text2">Loading…</p>;
  let lastDay = '';
  const thread = (
    <div data-testid="chat" className="flex min-h-[240px] max-h-[60vh] shrink-0 flex-col gap-1.5 overflow-y-auto rounded-[10px] bg-surface2 p-2" role="log" aria-label="Chat">
      {items.length === 0 && <p className="py-6 text-center text-[13px] text-text2">No calls or notes yet.</p>}
      {items.map((it) => {
        const d = new Date(it.at); const day = dayLabel(d); const sep = day !== lastDay; lastDay = day;
        const Icon = it.kind === 'mail' ? Mail : it.kind === 'msg' || it.kind === 'wa' ? MessageCircle : it.kind === 'note' ? StickyNote : Phone;
        return (
          <div key={it.id} className="contents">
            {sep && <h4 className="my-1 self-center rounded-full bg-surface px-3 py-0.5 text-[11px] font-semibold text-text2">{day}</h4>}
            <div data-side={it.side} data-kind={it.kind} className={cx('max-w-[85%] rounded-2xl px-3 py-2 text-[13px] shadow-sm', it.side === 'me' ? 'self-end rounded-br-sm bg-accent text-white' : 'self-start rounded-bl-sm bg-surface text-text')}>
              <div className="flex items-center gap-1.5 text-[12px] font-semibold"><Icon size={13} aria-hidden />{it.title}{it.secs ? <span className="font-normal opacity-80">· {fmtDuration(it.secs)}</span> : null}</div>
              {it.body && <p className="mt-0.5 whitespace-pre-wrap break-words">{it.body}</p>}
              {it.audio && (audio[it.id]
                ? <audio controls src={audio[it.id]} className="mt-1 w-full" autoPlay />
                : <button type="button" onClick={() => play(it)} className="mt-1 inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-[12px] font-semibold underline"><Play size={13} aria-hidden />Play recording</button>)}
              <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] opacity-75">{it.by ? it.by + ' · ' : ''}{d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}<Ticks status={it.status} error={it.error} /></div>
              {it.status === 'failed' && it.error && <p className="mt-0.5 text-[11px] opacity-90">{it.error}</p>}
            </div>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
  if (!composer) return thread;
  return <div className="flex flex-1 flex-col gap-2 [&>[data-testid=chat]]:flex-1">{thread}<Composer kind={kind} id={id} initial={initial} onSent={() => setTick((t) => t + 1)} /></div>;
}

/** Send box: WhatsApp / Email toggle, template picker, free text. The server looks up the real number or email. */
function Composer({ kind, id, initial, onSent }: { kind: 'lead' | 'candidate'; id: string; initial?: ChatChannel; onSent: () => void }) {
  const [channel, setChannel] = useState<ChatChannel>(initial || 'whatsapp');
  const [ready, setReady] = useState<Record<ChatChannel, boolean> | null>(null);
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [tpl, setTpl] = useState('');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ bad: boolean; text: string } | null>(null);
  useEffect(() => { if (initial) setChannel(initial); }, [initial]);
  useEffect(() => {
    fetch('/api/messages/send').then((r) => r.ok ? r.json() : null).then((j) => j && setReady({ whatsapp: !!j.whatsapp, email: !!j.email })).catch(() => {});
    supabase().from('message_template').select('id, channel, name, subject, body').eq('approved', true).order('name').then(({ data }) => setTpls((data || []) as Tpl[]));
  }, []);
  const list = tpls.filter((t) => t.channel === channel);
  const pick = (v: string) => { setTpl(v); const t = tpls.find((x) => x.id === v); if (t) { setText(t.body); if (t.subject) setSubject(t.subject); } };
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setNote(null);
    const t = tpls.find((x) => x.id === tpl);
    const r = await fetch('/api/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, [kind === 'lead' ? 'lead_id' : 'candidate_id']: id, body: text, subject: channel === 'email' ? subject : undefined, template: t?.name }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: 'No connection. Please try again.' };
    setBusy(false);
    if (r?.ok) { setText(''); setTpl(''); setSubject(''); setNote({ bad: false, text: 'Sent.' }); }
    else setNote({ bad: true, text: j.notSetUp ? j.error + ' The message is saved and will go out once it is set up.' : j.error || 'Could not send.' });
    if (j.id) onSent();
  };
  const seg = (c: ChatChannel, label: string, Icon: typeof Mail) => (
    <button type="button" role="radio" aria-checked={channel === c} onClick={() => { setChannel(c); setTpl(''); }}
      className={cx('inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-[8px] text-[13px] font-semibold transition-colors', channel === c ? 'bg-surface text-text shadow-sm' : 'text-text2 hover:text-text')}>
      <Icon size={14} aria-hidden />{label}
    </button>
  );
  return (
    <form data-testid="chat-composer" className="flex shrink-0 flex-col gap-2 rounded-[10px] border border-line bg-surface p-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <div role="radiogroup" aria-label="Send by" className="flex gap-1 rounded-[10px] bg-surface2 p-1">{seg('whatsapp', 'WhatsApp', MessageCircle)}{seg('email', 'Email', Mail)}</div>
      {ready && !ready[channel] && <p role="note" className="rounded-[8px] bg-warnBg px-2 py-1 text-[12px] text-warnText">{channel === 'whatsapp' ? 'WhatsApp' : 'Email'} is not set up yet. Messages are saved and sent once the admin adds the keys.</p>}
      {list.length > 0 && (
        <select aria-label="Template" value={tpl} onChange={(e) => pick(e.target.value)} className="min-h-[44px] rounded-[8px] border border-line bg-surface px-2 text-[13px] text-text">
          <option value="">{channel === 'whatsapp' ? 'Template (needed after 24 hours without a reply)' : 'Template (optional)'}</option>
          {list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      {channel === 'email' && <input aria-label="Subject" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="min-h-[44px] rounded-[8px] border border-line bg-surface px-2 text-[13px] text-text" />}
      <div className="flex items-end gap-2">
        <textarea aria-label="Message" rows={2} placeholder={'Type a message. {{first_name}} becomes their first name.'} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
          className="min-h-[44px] flex-1 resize-y rounded-[8px] border border-line bg-surface px-2 py-2 text-[13px] text-text" />
        <Button type="submit" variant="primary" loading={busy} disabled={!text.trim()} leftIcon={<Send size={14} />}>Send</Button>
      </div>
      {note && <p role="status" className={cx('text-[12px]', note.bad ? 'text-badText' : 'text-text2')}>{note.text}</p>}
    </form>
  );
}
