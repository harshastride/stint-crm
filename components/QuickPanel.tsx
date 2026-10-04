'use client';
import Link from 'next/link';
import { ChevronDown, ChevronUp, Copy, Mail, Maximize2, MessageCircle, Phone, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { PersonRef, Row } from '@/lib/pages';
import { Button, Notice, Pill, cx, fmtDateTime, initials, money } from './ui';
import { friendlyError } from './Fields';
import { Recorder } from './Recorder';
import { Timeline } from './Timeline';
import { trackRecent } from '@/lib/recent';
import { QuickDate } from './QuickDate';
import { useToast } from './Toasts';
import { MentionText } from './MentionText';
import { useRouter } from 'next/navigation';
import { stepForFollowUp, stepsForStage, type Step } from '@/lib/nextSteps';
import { STEP_ICON } from '@/lib/icons';

import { STAGES, STAGE_OWNER as OWNER, STAGE_INDEX } from '@/lib/journey';
import { PanelSkeleton } from './Skeletons';
import { Meter } from './kit/Meter';
import { Viewers } from './kit/Viewers';
import { mayActFor } from '@/lib/pages';
import { Reveal, contactStatus, revealOnce } from './kit/Reveal';
const CALL_TO_STAGE: Record<string, string> = { Interested: 'Interested', Callback: 'Callback', 'Booked counselling': 'Counselling', 'Not interested': 'Not interested' };
const GROUP_LABEL: Record<string, string> = { contact: 'Contact', family: 'Family', identity: 'Identity', bank: 'Bank' };

export function QuickPanel({ person, onClose, onChanged, list = [], onNavigate }: { person: PersonRef; onClose: () => void; onChanged: () => void; list?: PersonRef[]; onNavigate?: (p: PersonRef) => void }) {
  const s = useSession();
  const router = useRouter();
  const toast = useToast();
  const isLead = person.kind === 'lead';
  const [p, setP] = useState<Row | null>(null);
  const [timeline, setTimeline] = useState<Row[]>([]);
  const [tasks, setTasks] = useState<Row[]>([]);
  const [priv, setPriv] = useState<Row | null>(null);
  const [prog, setProg] = useState<{ fees?: [number, number]; docs?: [number, number] }>({});
  // the tab you were on is kept for the next person
  const [tab, setTabRaw] = useState<'Log' | 'Timeline' | 'Details'>(() => { try { return (localStorage.getItem('stint-panel-tab') as 'Log') || 'Log'; } catch { return 'Log'; } });
  const setTab = (t: 'Log' | 'Timeline' | 'Details') => { setTabRaw(t); try { localStorage.setItem('stint-panel-tab', t); } catch {} };
  // width you dragged it to, remembered
  const [width, setWidth] = useState(() => { try { return Number(localStorage.getItem('stint-panel-w')) || 380; } catch { return 380; } });
  const at = list.findIndex((x) => x.kind === person.kind && x.id === person.id);
  const prev = at > 0 ? list[at - 1] : null, next = at >= 0 && at < list.length - 1 ? list[at + 1] : null;
  const fullHref = person.kind === 'candidate' ? '/candidate/' + person.id : '/p/lead?edit=lead:' + person.id;
  const [action, setAction] = useState<'note' | 'call' | 'task' | 'record' | null>(null);
  const [form, setForm] = useState<Row>({});
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [cst, setCst] = useState<{ allowed: boolean; reason: string | null } | null>(null);

  const canWritePerson = isLead ? s.can('lead', 'w') : s.can('candidate', 'w');
  const canCall = isLead && s.can('call', 'w');
  const idCol = isLead ? 'lead_id' : 'candidate_id';
  const canRecord = s.can('recordings', 'w') || (isLead ? s.can('lead', 'w') : s.can('candidate', 'r'));

  const load = useCallback(async () => {
    const db = supabase();
    // leads come from lead_list: full mobile/email are not readable, only the masked copies
    const loadOne = async () => {
      if (!isLead) return db.from('candidate').select('*, program:program_id(name), batch:batch_id(code), owner:poc_id(full_name)').eq('id', person.id).maybeSingle();
      const r = await db.from('lead_list').select('*, program:program_id(name), owner:owner_id(full_name), source:source_id(name)').eq('id', person.id).maybeSingle();
      if (!r.error) return r;
      const plain = await db.from('lead_list').select('*').eq('id', person.id).maybeSingle();
      const d = plain.data as Row | null;
      if (d) {
        const [pg, ow, so] = await Promise.all([
          d.program_id ? db.from('program').select('name').eq('id', d.program_id).maybeSingle() : Promise.resolve({ data: null }),
          d.owner_id ? db.from('staff').select('full_name').eq('id', d.owner_id).maybeSingle() : Promise.resolve({ data: null }),
          d.source_id ? db.from('lead_source').select('name').eq('id', d.source_id).maybeSingle() : Promise.resolve({ data: null }),
        ]);
        Object.assign(d, { program: pg.data, owner: ow.data, source: so.data });
      }
      return plain;
    };
    const [one, tl, fu, st] = await Promise.all([
      loadOne(),
      db.rpc('person_timeline', { p_lead: isLead ? person.id : null, p_candidate: isLead ? null : person.id }),
      db.from('follow_up').select('*').eq(idCol, person.id).eq('status', 'Open').order('due_at'),
      contactStatus(person.kind as 'lead' | 'candidate', person.id, true),
    ]);
    setCst(st);
    setP(one.data as Row | null); setTimeline(tl.data || []); setTasks(fu.data || []);
    if (one.data) trackRecent(s.staff.id, { kind: person.kind, id: person.id, name: (one.data as Row).full_name });
    if (!isLead) {
      const [pv, plan, pay, docs] = await Promise.all([
        db.rpc('candidate_private_get', { cid: person.id }),
        s.can('plan') ? db.from('fee_plan').select('total').eq('candidate_id', person.id).maybeSingle() : Promise.resolve({ data: null }),
        s.can('payment') ? db.from('fee_payment').select('amount').eq('candidate_id', person.id).eq('status', 'Received') : Promise.resolve({ data: null }),
        s.can('doc') ? db.from('candidate_document').select('status').eq('candidate_id', person.id) : Promise.resolve({ data: null }),
      ]);
      setPriv(pv.data);
      const total = Number((plan.data as Row | null)?.total || 0);
      setProg({
        fees: total > 0 && pay.data ? [(pay.data as Row[]).reduce((a, r) => a + Number(r.amount), 0), total] : undefined,
        docs: (docs.data as Row[] | null)?.length ? [(docs.data as Row[]).filter((d) => d.status !== 'Missing').length, (docs.data as Row[]).length] : undefined,
      });
    }
  }, [person.kind, person.id, isLead, idCol]);

  useEffect(() => { setP(null); setProg({}); setMsg(null); setAction(null); setForm({}); load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [contenteditable]') || document.querySelector('[role="dialog"], [role="menu"]')) return;
      if (e.key === 'Escape') onClose();
      else if ((e.key === 'j' || e.key === 'ArrowDown') && next && onNavigate) { e.preventDefault(); onNavigate(next); }
      else if ((e.key === 'k' || e.key === 'ArrowUp') && prev && onNavigate) { e.preventDefault(); onNavigate(prev); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, onNavigate, onClose]);
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = width;
    const move = (ev: PointerEvent) => setWidth(Math.min(680, Math.max(340, w0 + (x0 - ev.clientX))));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setWidth((w) => { try { localStorage.setItem('stint-panel-w', String(w)); } catch {} return w; }); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  if (!p) return <aside aria-label="Quick panel" className="fixed inset-x-0 bottom-0 z-40 max-h-[85dvh] w-full rounded-t-2xl border-t border-line shadow-2xl md:static md:z-auto md:max-h-none md:rounded-none md:border-t-0 md:border-l md:shadow-none shrink-0 bg-surface p-5 text-muted md:w-[380px]"><PanelSkeleton /></aside>;

  // masked copies only; the real value is fetched (and logged) on tap
  const kind = person.kind as 'lead' | 'candidate';
  const contact: { mobile: string; email: string } = isLead ? { mobile: p.mobile_masked || '', email: p.email_masked || '' }
    : { mobile: priv?.modes?.contact === 'h' ? '' : String(priv?.contact?.mobile || ''), email: priv?.modes?.contact === 'h' ? '' : String(priv?.contact?.email || '') };
  const lockReason = cst && !cst.allowed ? (cst.reason || 'Details locked') : (!isLead && priv?.locked ? String(priv.locked) : null);
  const isAdmin = s.staff.role === 'Admin';
  const openContact = async (field: 'mobile' | 'email', how: 'tel' | 'wa' | 'mail' | 'copy') => {
    if (lockReason) return;
    const v = await revealOnce(kind, person.id, field);
    if (!v) { setMsg({ tone: 'bad', text: 'Could not show this detail. ' + (lockReason || '') }); return; }
    const digits = v.replace(/\D/g, '').slice(-10);
    if (how === 'tel') window.location.href = 'tel:+91' + digits;
    else if (how === 'wa') window.open('https://wa.me/91' + digits, '_blank', 'noopener');
    else if (how === 'mail') window.location.href = 'mailto:' + v;
    else { navigator.clipboard?.writeText('+91 ' + digits); toast('Number copied'); }
  };
  const btn = 'flex min-h-[44px] flex-col items-center justify-center rounded-[10px] bg-surface text-[11px] font-semibold text-text2 hover:text-accentText disabled:opacity-40';
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
    // Follow-up rules (Admin settings) suggest what comes next; the caller confirms or changes it
    const { data: sug } = await db.rpc('suggest_follow_up', { p_trigger: 'Call: ' + form.outcome });
    setBusy(false);
    done('Call logged.' + extra);
    if (sug?.title) {
      const d = new Date(sug.due_at);
      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      setAction('task'); setForm({ title: sug.title, due: local, suggested: sug.after ? `Suggested by the follow-up rule (${sug.after}).` : 'Suggested by the follow-up rule.' });
    }
  };
  const saveTask = async () => {
    if (!String(form.title || '').trim() || !form.due) { setMsg({ tone: 'bad', text: 'Add what needs doing and when.' }); return; }
    setBusy(true);
    const { error } = await supabase().from('follow_up').insert({ title: String(form.title).trim(), [idCol]: person.id, owner_id: s.staff.id, owner_role: s.staff.role, due_at: new Date(form.due).toISOString(), created_by: s.staff.id });
    setBusy(false);
    if (error) return fail(error); done('Follow-up added.');
  };
  const moveStage = async (stage: string) => {
    const from = p?.stage;
    const { error } = await supabase().from(person.kind).update({ stage }).eq('id', person.id);
    if (error) return fail(error);
    if (stage === 'Converted') { done('Converted. A candidate record was created with follow-ups for front desk, HR and finance.'); return; }
    setMsg(null); load(); onChanged();
    toast('Moved to ' + stage + '. Recorded in status history.', { undo: async () => { await supabase().from(person.kind).update({ stage: from }).eq('id', person.id); toast('Moved back to ' + from + '.'); load(); onChanged(); } });
  };
  const finishTask = async (t: Row) => {
    const { error } = await supabase().from('follow_up').update({ status: 'Done' }).eq('id', t.id);
    if (error) return fail(error);
    setMsg(null); load(); onChanged();
    toast('Done: ' + t.title, { undo: async () => { await supabase().from('follow_up').update({ status: 'Open' }).eq('id', t.id); load(); onChanged(); } });
  };

  const allowed = (st: Step) => (st.inline === 'call' ? canCall : st.inline === 'convert' ? canWritePerson && isLead : s.can(st.page, 'w'));
  const runStep = (st: Step) => {
    if (st.inline === 'call') { setTab('Log'); setAction('call'); setForm({}); setMsg(null); return; }
    if (st.inline === 'convert') { setTab('Log'); moveStage('Converted'); return; }
    if (st.href) router.push(st.href(person));
  };
  const nextSteps = stepsForStage(p.stage).filter(allowed);

  return (
    <aside aria-label="Quick panel" style={{ '--pw': width + 'px' } as React.CSSProperties} className="anim-slide fixed inset-x-0 bottom-0 z-40 max-h-[85dvh] w-full rounded-t-2xl border-t border-line shadow-2xl md:relative md:z-auto md:max-h-none md:rounded-none md:border-t-0 md:border-l md:shadow-none flex shrink-0 flex-col gap-3 overflow-y-auto bg-surface p-4 md:w-[var(--pw)]">
      <div role="separator" aria-orientation="vertical" aria-label="Drag to resize the panel" onPointerDown={startResize} onDoubleClick={() => { setWidth(380); try { localStorage.setItem('stint-panel-w', '380'); } catch {} }}
        className="absolute inset-y-0 left-0 z-20 hidden w-1.5 cursor-col-resize hover:bg-accent/40 md:block" />
      <div className="mx-auto -mb-1 h-1.5 w-10 rounded-full bg-line2 md:hidden" aria-hidden />
      <div className="sticky -top-4 z-10 -mx-4 -mt-4 flex flex-col gap-3 bg-surface px-4 pb-1 pt-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-base font-semibold">Quick panel</div>
            <div className="truncate text-xs font-medium text-muted">Showing what {s.staff.role} can see{list.length > 1 && at >= 0 ? ` · ${at + 1} of ${list.length}` : ''}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onNavigate && list.length > 1 && <>
              <button type="button" aria-label="Previous person (K)" title="Previous (K)" disabled={!prev} onClick={() => prev && onNavigate(prev)} className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-line2 disabled:opacity-40"><ChevronUp size={16} /></button>
              <button type="button" aria-label="Next person (J)" title="Next (J)" disabled={!next} onClick={() => next && onNavigate(next)} className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-line2 disabled:opacity-40"><ChevronDown size={16} /></button>
            </>}
            <Link href={fullHref} title={person.kind === 'candidate' ? 'Open full profile' : 'Open the full lead form'} aria-label={person.kind === 'candidate' ? 'Open full profile' : 'Open the full lead form'} className="flex h-9 items-center gap-1.5 rounded-[10px] border border-line2 px-2.5 text-[12.5px] font-semibold"><Maximize2 size={14} /><span className="max-sm:hidden">Full {person.kind === 'candidate' ? 'profile' : 'view'}</span></Link>
            <button type="button" aria-label="Hide panel (Esc)" title="Hide (Esc)" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-line2"><X size={16} /></button>
          </div>
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
        {(contact.mobile || contact.email) && (
          <div className="mt-3 flex flex-col gap-1.5">
            {contact.mobile && <div className="flex items-center justify-between gap-2 text-[13px]"><span className="text-muted">Mobile</span><Reveal kind={kind} id={person.id} field="mobile" label="mobile" masked={contact.mobile} /></div>}
            {contact.email && <div className="flex items-center justify-between gap-2 text-[13px]"><span className="text-muted">Email</span><Reveal kind={kind} id={person.id} field="email" label="email" masked={contact.email} /></div>}
            <div className={cx('grid gap-1.5', isAdmin ? 'grid-cols-4' : 'grid-cols-3')}>
              {contact.mobile && <button type="button" disabled={!!lockReason} title={lockReason || 'Call'} onClick={() => openContact('mobile', 'tel')} className={btn}><Phone size={15} />Call</button>}
              {contact.mobile && <button type="button" disabled={!!lockReason} title={lockReason || 'WhatsApp'} onClick={() => openContact('mobile', 'wa')} className={btn}><MessageCircle size={15} />WhatsApp</button>}
              {contact.email && <button type="button" disabled={!!lockReason} title={lockReason || 'Email'} onClick={() => openContact('email', 'mail')} className={btn}><Mail size={15} />Email</button>}
              {contact.mobile && isAdmin && <button type="button" disabled={!!lockReason} title={lockReason || 'Copy number'} onClick={() => openContact('mobile', 'copy')} className={btn}><Copy size={15} />Copy</button>}
            </div>
          </div>
        )}
        {lockReason && <div role="note" className="mt-2 rounded-[10px] bg-warnBg px-3 py-2 text-[12px] font-medium text-warnText">{lockReason.startsWith('Details locked') ? lockReason : 'Details locked: ' + lockReason} — ask Admin</div>}
      </div>
      </div>

      <Viewers kind={person.kind} id={person.id} />
      {(prog.fees || prog.docs) && (
        <div className="flex flex-col gap-2.5 rounded-[12px] border border-line p-3">
          {prog.fees && <Meter label="Fees paid" value={prog.fees[0]} max={prog.fees[1]} text={`${money(prog.fees[0])} of ${money(prog.fees[1])}`} />}
          {prog.docs && <Meter label="Documents in" value={prog.docs[0]} max={prog.docs[1]} />}
        </div>
      )}
      {overdue > 0 && <Notice tone="bad">Overdue: {overdue} follow-up{overdue > 1 ? 's are' : ' is'} past the due date.</Notice>}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      {nextSteps.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-xs font-semibold text-text2">Next steps · {p.stage}</div>
          <div className="flex flex-wrap gap-1.5">
            {nextSteps.map((st, i) => (
              <button key={st.key} type="button" onClick={() => runStep(st)}
                className={cx('flex min-h-[40px] items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-semibold', i === 0 ? 'bg-accent text-white' : 'border border-line2 bg-surface text-text')}>
                {(() => { const I = STEP_ICON[st.key]; return I ? <I size={15} strokeWidth={2} aria-hidden /> : null; })()}{st.label}</button>
            ))}
          </div>
        </div>
      )}

      {tasks.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-xs font-semibold text-text2">Follow-ups</div>
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 rounded-[10px] border border-line px-3 py-2 text-[13px]">
              <span><span className="font-medium">{t.title}</span> <span className="text-muted">· {t.owner_role} · {fmtDateTime(t.due_at)}</span></span>
              <span className="flex shrink-0 gap-1.5">
                {(() => { const st = stepForFollowUp(t.title, person.kind); return st && allowed(st) ? (
                  <button type="button" className="flex min-h-[32px] items-center gap-1 rounded-md bg-accent px-2.5 text-xs font-semibold text-white" onClick={() => runStep(st)}>{(() => { const I = STEP_ICON[st.key]; return I ? <I size={13} strokeWidth={2.2} aria-hidden /> : null; })()}{st.label}</button>) : null; })()}
                {!t.owner_id || mayActFor(t.owner_id, s.staff, s.refs.staff || [])
                  ? <button type="button" className="min-h-[32px] rounded-md border border-line2 bg-surface px-2 text-xs font-medium" onClick={() => finishTask(t)}>Done</button>
                  : <span className="text-[11.5px] text-muted" title="Only the owner or their team head can close it">{(s.refs.staff || []).find((x) => x.id === t.owner_id)?.label.split(' ')[0]}’s</span>}
              </span>
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
            {canRecord && <Button className={action === 'record' ? '!border-accent' : ''} onClick={() => { setAction('record'); setMsg(null); }}>Record</Button>}
            <Button className={action === 'task' ? '!border-accent' : ''} onClick={() => { setAction('task'); setForm({}); setMsg(null); }}>Add follow-up</Button>
          </div>
          {action === 'record' && <Recorder person={person} onSaved={(t) => { setMsg({ tone: 'good', text: t }); setAction(null); }} />}
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
              <MentionText label="Note" placeholder="What happened? Type @ to notify a colleague" value={form.body || ''} onChange={(v) => setForm({ ...form, body: v })} />
              <Button variant="primary" disabled={busy} onClick={saveNote}>Save note</Button>
            </div>
          )}
          {action === 'task' && (
            <div className="flex flex-col gap-2 rounded-[12px] border border-accent p-3">
              <div className="text-sm font-semibold">Follow-up</div>
              {form.suggested && <div className="text-[12px] text-text2">{form.suggested} Change it if needed, or close this.</div>}
              <input aria-label="What needs doing" placeholder="What needs doing" className="h-10 px-3 text-sm" value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <QuickDate label="Due" value={form.due ? new Date(form.due).toISOString() : null} onChange={(iso) => setForm({ ...form, due: iso || '' })} />
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

      {tab === 'Timeline' && <Timeline items={timeline} />}

      {tab === 'Details' && (
        <div className="anim-fade flex flex-col gap-2.5">
          {isLead ? (
            <Group title="Enquiry" rows={[['Mobile', p.mobile_masked], ['Email', p.email_masked], ['City', p.city], ['Source', p.source?.name], ['Preferred mode', p.preferred_mode], ['Currently', p.currently], ['Notes', p.notes]]} />
          ) : (
            <>
              <Group title="Candidate" rows={[['ID', p.code], ['Program', p.program?.name], ['Batch', p.batch?.code], ['Joined', p.joined_on]]} />
              {priv && Object.keys(GROUP_LABEL).map((g) => (
                priv.modes[g] === 'h'
                  ? null   // hidden groups are left out entirely, not announced
                  : <Group key={g} title={GROUP_LABEL[g]} tag={priv.modes[g] === 'm' ? 'Masked' : 'Full'} rows={Object.entries(priv[g] || {}).map(([k, v]) => [k.replace(/_/g, ' '), g === 'contact' && priv.modes[g] === 'm' ? <Reveal kind="candidate" id={person.id} field={k} label={k.replace(/_/g, ' ')} masked={String(v ?? '')} /> : String(v)])} />
              ))}
              <Link href={'/candidate/' + person.id} className="flex min-h-[44px] items-center justify-center rounded-[10px] border border-ink bg-surface text-sm font-semibold">Open full profile</Link>
              {(s.can('candidate', 'w') || s.can('enrolform', 'w')) && (
                <Button disabled={busy} onClick={async () => {
                  setBusy(true);
                  const res = await fetch('/api/portal/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidate_id: person.id }) });
                  const out = await res.json(); setBusy(false);
                  setMsg(res.ok ? { tone: 'good', text: `${out.reset ? 'Portal password reset' : 'Invited to the student portal'}. Login: ${out.email} · temporary password: ${out.password} — share it privately; they choose their own at first sign-in. Portal address: ${window.location.origin}/login` }
                    : { tone: 'bad', text: out.error || 'Could not invite.' });
                }}>Invite to student portal</Button>
              )}
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
          <span className="num text-right font-medium">{v == null || v === '' ? '—' : typeof v === 'object' ? (v as React.ReactNode) : String(v)}</span>
        </div>
      ))}
    </div>
  );
}
