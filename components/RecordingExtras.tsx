'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { Button, Notice } from './ui';
import { friendlyError } from './Fields';

type Seg = { speaker: string; start_ms: number; text: string };
const mmss = (ms: number) => Math.floor(ms / 60000) + ':' + String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');

/** Recordings page editor: play, transcript, AI draft to confirm, make a lead, re-run, delete. */
export function RecordingExtras({ row, values, setValue, onDone }: { row: Row; values: Row; setValue: (k: string, v: unknown) => void; onDone: (msg: string) => void }) {
  const s = useSession();
  const [audio, setAudio] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [lead, setLead] = useState<{ name: string; mobile: string } | null>(null);
  const [sure, setSure] = useState(false);
  const canWrite = s.can('recordings', 'w') || row.captured_by === s.staff.id;
  const draft = row.draft as { summary?: string; outcome?: string | null; follow_up?: string | null; follow_up_when?: string | null } | null;
  const segs = (Array.isArray(row.transcript) ? row.transcript : []) as Seg[];
  const db = supabase();

  const play = async () => {
    const { data, error } = await db.storage.from('recordings').createSignedUrl(row.audio_path, 300);
    if (error || !data) setMsg({ tone: 'bad', text: 'Could not open the audio.' }); else setAudio(data.signedUrl);
  };
  const rerun = async () => {
    setBusy(true); setMsg({ tone: 'good', text: 'Transcribing… this can take a minute or two.' });
    const res = await fetch('/api/recordings/process', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.id }) });
    const out = await res.json(); setBusy(false);
    if (out.ok) onDone('Transcript and draft summary ready.'); else setMsg({ tone: 'bad', text: out.error || 'Could not transcribe.' });
  };
  const confirm = async () => {
    if (!values.lead_id && !values.candidate_id) { setMsg({ tone: 'bad', text: 'Attach it to a lead or candidate first.' }); return; }
    if (!String(values.summary || '').trim()) { setMsg({ tone: 'bad', text: 'Write or accept a summary first.' }); return; }
    setBusy(true);
    const { error } = await db.from('recording').update({ lead_id: values.lead_id || null, candidate_id: values.candidate_id || null, summary: String(values.summary).trim(),
      outcome: values.outcome || null, follow_up: values.follow_up || null, status: 'Confirmed', confirmed_by: s.staff.id }).eq('id', row.id);
    if (!error && values.follow_up) {
      await db.from('follow_up').insert({ title: String(values.follow_up).slice(0, 120), [values.lead_id ? 'lead_id' : 'candidate_id']: values.lead_id || values.candidate_id,
        owner_id: s.staff.id, owner_role: s.staff.role, due_at: new Date(Date.now() + 86400000).toISOString(), created_by: s.staff.id });
    }
    if (!error) await db.from('note').insert({ [values.lead_id ? 'lead_id' : 'candidate_id']: values.lead_id || values.candidate_id, kind: 'Note', body: 'Recorded talk: ' + String(values.summary).trim(), by_id: s.staff.id });
    setBusy(false);
    if (error) setMsg({ tone: 'bad', text: friendlyError(error) }); else onDone('Confirmed. Summary added to their timeline' + (values.follow_up ? ' and a follow-up set for tomorrow.' : '.'));
  };
  const makeLead = async () => {
    if (!lead) { setLead({ name: '', mobile: row.number || '' }); return; }
    setBusy(true);
    const { error } = await db.rpc('lead_from_recording', { rid: row.id, p_name: lead.name, p_mobile: lead.mobile });
    setBusy(false);
    if (error) setMsg({ tone: 'bad', text: friendlyError(error) }); else onDone('Lead created and the recording attached to it.');
  };
  const remove = async () => {
    if (!sure) { setSure(true); return; }
    setBusy(true);
    if (row.audio_path) await db.storage.from('recordings').remove([row.audio_path]);
    const { error } = await db.from('recording').delete().eq('id', row.id);
    setBusy(false);
    if (error) setMsg({ tone: 'bad', text: friendlyError(error) }); else onDone('Recording deleted.');
  };

  return (
    <div className="flex flex-col gap-2.5">
      {row.audio_path ? (audio ? <audio controls autoPlay src={audio} className="w-full" /> : <Button onClick={play}>Play the audio</Button>)
        : <div className="text-[13px] text-muted">{row.audio_deleted_at ? 'Audio removed after the retention period; the transcript is kept.' : 'No audio.'}</div>}
      {row.process_error && <Notice tone="bad">Transcription problem: {row.process_error}</Notice>}
      {draft?.summary && (
        <div className="flex flex-col gap-1.5 rounded-[10px] bg-accentSoft p-3 text-[13px]">
          <div className="text-xs font-semibold text-accentText">AI draft · check it before confirming</div>
          <div>{draft.summary}</div>
          {draft.outcome && <div><span className="text-muted">Outcome:</span> {draft.outcome}</div>}
          {draft.follow_up && <div><span className="text-muted">Next:</span> {draft.follow_up}{draft.follow_up_when ? ' · ' + draft.follow_up_when : ''}</div>}
          {canWrite && row.status !== 'Confirmed' && <Button onClick={() => { setValue('summary', draft.summary); if (draft.outcome) setValue('outcome', draft.outcome); if (draft.follow_up) setValue('follow_up', draft.follow_up + (draft.follow_up_when ? ' (' + draft.follow_up_when + ')' : '')); }}>Use this draft</Button>}
        </div>
      )}
      {segs.length > 0 && (
        <details className="rounded-[10px] border border-line p-2.5 text-[13px]">
          <summary className="cursor-pointer font-medium">Transcript ({segs.length} parts)</summary>
          <div className="mt-2 flex max-h-72 flex-col gap-1.5 overflow-auto">
            {segs.map((g, i) => <div key={i}><span className="num text-muted">{mmss(g.start_ms)} · Speaker {g.speaker}</span><div>{g.text}</div></div>)}
          </div>
        </details>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {canWrite && (
        <div className="flex flex-col gap-2">
          {row.status !== 'Confirmed' && <Button variant="primary" disabled={busy} onClick={confirm}>Confirm summary</Button>}
          {row.audio_path && <Button disabled={busy} onClick={rerun}>{segs.length ? 'Transcribe again' : 'Transcribe now'}</Button>}
          {!values.lead_id && !values.candidate_id && (
            <div className="flex flex-col gap-2 rounded-[10px] border border-line p-2.5">
              {lead && <>
                <input aria-label="Lead name" placeholder="Their name" className="h-11 px-3 text-sm" value={lead.name} onChange={(e) => setLead({ ...lead, name: e.target.value })} />
                <input aria-label="Lead mobile" placeholder="10-digit mobile" inputMode="numeric" className="h-11 px-3 text-sm" value={lead.mobile} onChange={(e) => setLead({ ...lead, mobile: e.target.value })} />
              </>}
              <Button disabled={busy} onClick={makeLead}>{lead ? 'Create the lead' : 'Make a new lead from this'}</Button>
            </div>
          )}
          <Button variant="danger" disabled={busy} onClick={remove}>{sure ? 'Tap again to delete the recording and audio' : 'Delete recording'}</Button>
        </div>
      )}
    </div>
  );
}
