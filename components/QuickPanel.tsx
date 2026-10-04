'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { PersonRef, Row } from '@/lib/pages';
import { Button, Notice, Pill, cx, fmtDateTime, initials } from './ui';
import { friendlyError } from './Fields';

const STAGES = ['Lead', 'Calls', 'Counselling', 'Enrolled', 'Training', 'Mocks', 'Resume + docs', 'Placement', 'Alumni'];
const OWNER = ['Marketing', 'Telecaller', 'Sales', 'Front desk and HR', 'Trainer', 'SME', 'HR', 'Placement', 'Placement'];
const STAGE_INDEX: Record<string, number> = { New: 0, Callback: 1, Interested: 1, Counselling: 2, Converted: 3, 'Not interested': 1, Enrolled: 3, Training: 4, Mocks: 5, Resume: 6, Docs: 6, Ready: 7, Placed: 7, Alumni: 8 };
const CALL_TO_STAGE: Record<string, string> = { Interested: 'Interested', Callback: 'Callback', 'Booked counselling': 'Counselling', 'Not interested': 'Not interested' };
const GROUP_LABEL: Record<string, string> = { contact: 'Contact', family: 'Family', identity: 'Identity', bank: 'Bank' };

export function QuickPanel({ person, onClose, onChanged }: { person: PersonRef; onClose: () => void; onChanged: () => void }) {
  const s = useSession();
  const isLead = person.kind === 'lead';
  const [p, setP] = useState<Row | null>(null);
  const [timeline, setTimeline] = useState<Row[]>([]);
  const [tasks, setTasks] = useState<Row[]>([]);
  const [priv, setPriv] = useState<Row | null>(null);
  const [tab, setTab] = useState<'Log' | 'Timeline' | 'Details'>('Log');
  const [action, setAction] = useState<'note' | 'call' | 'task' | null>(null);
  const [form, setForm] = useState<Row>({});
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const canWritePerson = isLead ? s.can('lead', 'w') : s.can('candidate', 'w');
  const canCall = isLead && s.can('call', 'w');
  const idCol = isLead ? 'lead_id' : 'candidate_id';

  const load = useCallback(async () => {
    const db = supabase();
    const sel = isLead ? '*, program:program_id(name), owner:owner_id(full_name), source:source_id(name)' : '*, program:program_id(name), batch:batch_id(code), owner:poc_id(full_name)';
    const [one, tl, fu] = await Promise.all([
      db.from(person.kind).select(sel).eq('id', person.id).maybeSingle(),
      db.rpc('person_timeline', { p_lead: isLead ? person.id : null, p_candidate: isLead ? null : person.id }),
      db.from('follow_up').select('*').eq(idCol, person.id).eq('status', 'Open').order('due_at'),
    ]);
    setP(one.data); setTimeline(tl.data || []); setTasks(fu.data || []);
    if (!isLead) { const { data } = await db.rpc('candidate_private_get', { cid: person.id }); setPriv(data); }
  }, [person.kind, person.id, isLead, idCol]);

  useEffect(() => { setP(null); setMsg(null); setAction(null); setForm({}); load(); }, [load]);

  if (!p) return <aside aria-label="Quick panel" className="w-[380px] shrink-0 border-l border-line bg-surface p-5 text-muted">Loading…</aside>;

  const si = STAGE_INDEX[p.stage] ?? 0;
  const days = Math.floor((Date.now() - new Date(p.stage_changed_at).getTime()) / 86400000);
  const stageList = s.lists[isLead ? 'lead_stage' : 'candidate_stage'] || [];
  const overdue = tasks.filter((t) => new Date(t.due_at).getTime() < Date.now() - 86400000).length;

  const done = (text: string) => { setMsg({ tone: 'good', text }); setAction(null); setForm({}); load(); onChanged(); };
  const fail = (e: { code?: string; message?: string }) => setMsg({ tone: 'bad', text: friendlyError(e) });

  const saveNote = async () => {
    if (!String(form.body || '').trim()) { setMsg({ tone: 'bad', text: 'Write the note first.' }); return; }
    setBusy(true);
    const { error } = await supabase().from('note').insert({ [idCol]: person.id, kind: form.kind || 'Note', body: String(form.body).trim(), by_id: s.staff.id });
    setBusy(false);
    if (error) return fail(error); done('Note saved on the timeline.');
  };
  const saveCall = async () => {
    if (!form.outcome) { setMsg({ tone: 'bad', text: 'Pick the outcome.' }); return; }
    setBusy(true);
    const db = supabase();
    const { error } = await db.from('call_log').insert({ lead_id: person.id, caller_id: s.staff.id, outcome: form.outcome, notes: form.body || null, duration_sec: Number(form.duration || 0) });
    if (error) { setBusy(false); return fail(error); }
    let extra = '';
    const next = CALL_TO_STAGE[form.outcome];
    if (next && next !== p.stage && canWritePerson) {
      const up = await db.from('lead').update({ stage: next }).eq('id', person.id);
      if (!up.error) extra = ` Stage moved to ${next}.`;
    }
    if (['Callback', 'No answer'].includes(form.outcome)) {
      const due = new Date(Date.now() + 86400000);
      await db.from('follow_up').insert({ title: form.outcome === 'Callback' ? 'Call back' : 'Call again', lead_id: person.id, owner_id: s.staff.id, owner_role: s.staff.role, due_at: due.toISOString(), created_by: s.staff.id });
      extra += ' Follow-up set for tomorrow.';
    }
    setBusy(false);
    done('Call logged.' + extra);
  };
  const saveTask = async () => {
    if (!String(form.title || '').trim() || !form.due) { setMsg({ tone: 'bad', text: 'Add what needs doing and when.' }); return; }
    setBusy(true);
    const { error } = await supabase().from('follow_up').insert({ title: String(form.title).trim(), [idCol]: person.id, owner_id: s.staff.id, owner_role: s.staff.role, due_at: new Date(form.due).toISOString(), created_by: s.staff.id });
    setBusy(false);
    if (error) return fail(error); done('Follow-up added.');
  };
  const moveStage = async (stage: string) => {
    const { error } = await supabase().from(person.kind).update({ stage }).eq('id', person.id);
    if (error) return fail(error);
    done(stage === 'Converted' ? 'Converted. A candidate record was created with follow-ups for front desk, HR and finance.' : 'Moved to ' + stage + '. Recorded in status history.');
  };
  const finishTask = async (t: Row) => {
    const { error } = await supabase().from('follow_up').update({ status: 'Done' }).eq('id', t.id);
    if (error) return fail(error); done('Done: ' + t.title);
  };

  return (
    <aside aria-label="Quick panel" className="anim-slide flex w-[380px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-base font-semibold">Quick panel</div>
          <div className="text-xs font-medium text-muted">Showing what {s.staff.role} can see</div>
        </div>
        <Button className="!min-h-[38px] px-3 text-[13px]" onClick={onClose}>Hide</Button>
      </div>

      <div className="rounded-[12px] bg-surface2 p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-accentSoft text-sm font-semibold text-accentText">{initials(p.full_name)}</div>
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">{p.full_name}</div>
            <div className="text-xs text-text2">{isLead ? 'Lead' : 'Candidate'} · {p.program?.name || 'No course'}{p.batch?.code ? ' · ' + p.batch.code : ''} · Owner {p.owner?.full_name || 'none'}</div>
          </div>
        </div>
        <div className="mt-3 flex gap-1" aria-hidden>
          {STAGES.map((_, i) => <span key={i} className={cx('h-1.5 flex-1 rounded-full', i < si ? 'bg-accent' : i === si ? 'bg-coral' : 'bg-line2')} />)}
        </div>
        <div className="mt-2 text-xs font-medium text-text2">Stage {si + 1} of 9 · {STAGES[si]} · with {OWNER[si]} · {days} day{days === 1 ? '' : 's'} here</div>
      </div>

      {overdue > 0 && <Notice tone="bad">Overdue: {overdue} follow-up{overdue > 1 ? 's are' : ' is'} past the due date.</Notice>}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      {tasks.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-xs font-semibold text-text2">Follow-ups</div>
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 rounded-[10px] border border-line px-3 py-2 text-[13px]">
              <span><span className="font-medium">{t.title}</span> <span className="text-muted">· {t.owner_role} · {fmtDateTime(t.due_at)}</span></span>
              <button type="button" className="rounded-md border border-line2 bg-surface px-2 py-1 text-xs font-medium" onClick={() => finishTask(t)}>Done</button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 rounded-[10px] bg-surface2 p-1" role="tablist">
        {(['Log', 'Timeline', 'Details'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('min-h-[36px] rounded-lg text-[13px] font-semibold', tab === t ? 'bg-surface text-text shadow-sm' : 'text-text2')}>{t}</button>
        ))}
      </div>

      {tab === 'Log' && (
        <div className="anim-fade flex flex-col gap-2.5">
          <div className="grid grid-cols-2 gap-2">
            {canCall && <Button className={action === 'call' ? '!border-accent' : ''} onClick={() => { setAction('call'); setForm({}); setMsg(null); }}>Log call</Button>}
            <Button className={action === 'note' ? '!border-accent' : ''} onClick={() => { setAction('note'); setForm({ kind: 'Note' }); setMsg(null); }}>Add note</Button>
            <Button className={action === 'task' ? '!border-accent' : ''} onClick={() => { setAction('task'); setForm({}); setMsg(null); }}>Add follow-up</Button>
          </div>
          {action === 'call' && (
            <div className="flex flex-col gap-2 rounded-[12px] border border-accent p-3">
              <div className="text-sm font-semibold">Log call</div>
              <div className="flex flex-wrap gap-1.5">
                {(s.lists.call_outcome || []).map((o) => (
                  <button key={o} type="button" onClick={() => setForm({ ...form, outcome: o })} className={cx('rounded-full border px-3 py-1.5 text-xs font-medium', form.outcome === o ? 'border-accent bg-accentSoft text-accentText' : 'border-line2 bg-surface')}>{o}</button>
                ))}
              </div>
              <textarea aria-label="Call notes" placeholder="Notes (optional)" className="min-h-[64px] px-3 py-2 text-sm" value={form.body || ''} onChange={(e) => setForm({ ...form, body: e.target.value })} />
              <Button variant="primary" disabled={busy} onClick={saveCall}>Save call</Button>
            </div>
          )}
          {action === 'note' && (
            <div className="flex flex-col gap-2 rounded-[12px] border border-accent p-3">
              <div className="text-sm font-semibold">Note</div>
              <select aria-label="Kind of note" className="h-10 px-2 text-sm" value={form.kind || 'Note'} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {['Note', 'Message', 'Training', 'Resume', 'Fee', 'Placement'].map((k) => <option key={k}>{k}</option>)}
              </select>
              <textarea aria-label="Note" placeholder="What happened?" className="min-h-[84px] px-3 py-2 text-sm" value={form.body || ''} onChange={(e) => setForm({ ...form, body: e.target.value })} />
              <Button variant="primary" disabled={busy} onClick={saveNote}>Save note</Button>
            </div>
          )}
          {action === 'task' && (
            <div className="flex flex-col gap-2 rounded-[12px] border border-accent p-3">
              <div className="text-sm font-semibold">Follow-up</div>
              <input aria-label="What needs doing" placeholder="What needs doing" className="h-10 px-3 text-sm" value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <input aria-label="Due" type="datetime-local" className="h-10 px-3 text-sm" value={form.due || ''} onChange={(e) => setForm({ ...form, due: e.target.value })} />
              <Button variant="primary" disabled={busy} onClick={saveTask}>Save follow-up</Button>
            </div>
          )}
          {canWritePerson && (
            <label className="flex flex-col gap-1 text-xs font-medium text-text2">
              Move stage
              <select className="h-[42px] px-3 text-sm" value={p.stage} onChange={(e) => moveStage(e.target.value)}>
                {stageList.map((st) => <option key={st}>{st}</option>)}
              </select>
            </label>
          )}
          {!canWritePerson && !canCall && <div className="text-[13px] text-text2">You can add notes and follow-ups here. Changing the stage is for the team that owns it.</div>}
        </div>
      )}

      {tab === 'Timeline' && (
        <div className="anim-fade flex flex-col">
          {timeline.length === 0 && <div className="text-[13px] text-muted">Nothing recorded yet.</div>}
          {timeline.map((t, i) => (
            <div key={i} className="flex flex-col gap-0.5 border-b border-line py-2.5">
              <div className="flex items-center justify-between gap-2">
                <Pill>{t.kind}</Pill>
                <span className="text-xs text-muted">{fmtDateTime(t.at)}</span>
              </div>
              <div className="text-[13px] leading-snug">{t.body}</div>
              <div className="text-xs text-muted">by {t.by_name || 'System'}</div>
            </div>
          ))}
        </div>
      )}

      {tab === 'Details' && (
        <div className="anim-fade flex flex-col gap-2.5">
          {isLead ? (
            <Group title="Enquiry" rows={[['Mobile', p.mobile], ['Email', p.email], ['City', p.city], ['Source', p.source?.name], ['Preferred mode', p.preferred_mode], ['Currently', p.currently], ['Notes', p.notes]]} />
          ) : (
            <>
              <Group title="Candidate" rows={[['ID', p.code], ['Program', p.program?.name], ['Batch', p.batch?.code], ['Joined', p.joined_on]]} />
              {priv && Object.keys(GROUP_LABEL).map((g) => (
                priv.modes[g] === 'h'
                  ? <div key={g} className="rounded-[10px] bg-warnBg px-3 py-2 text-xs font-medium text-warnText">{GROUP_LABEL[g]}: hidden for your role</div>
                  : <Group key={g} title={GROUP_LABEL[g]} tag={priv.modes[g] === 'm' ? 'Masked' : 'Full'} rows={Object.entries(priv[g] || {}).map(([k, v]) => [k.replace(/_/g, ' '), String(v)])} />
              ))}
              <Link href={'/candidate/' + person.id} className="flex min-h-[44px] items-center justify-center rounded-[10px] border border-ink bg-surface text-sm font-semibold">Open full profile</Link>
            </>
          )}
        </div>
      )}
    </aside>
  );
}

function Group({ title, tag, rows }: { title: string; tag?: string; rows: [string, unknown][] }) {
  return (
    <div className="rounded-[10px] border border-line p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="text-xs font-semibold">{title}</div>
        {tag && <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', tag === 'Masked' ? 'bg-warnBg text-warnText' : 'bg-goodBg text-goodText')}>{tag}</span>}
      </div>
      {rows.length === 0 && <div className="text-xs text-muted">Nothing filled in yet.</div>}
      {rows.map(([l, v]) => (
        <div key={l} className="flex justify-between gap-3 py-1 text-[13px]">
          <span className="capitalize text-muted">{l}</span>
          <span className="num text-right font-medium">{v == null || v === '' ? '—' : String(v)}</span>
        </div>
      ))}
    </div>
  );
}
