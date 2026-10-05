'use client';
import Link from 'next/link';
import { CalendarClock, ChevronDown, ChevronUp, Copy, Mail, Maximize2, MessageCircle, Mic, MoreHorizontal, Phone, X } from 'lucide-react';
import { Avatar } from './kit/Avatar';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { PersonRef, Row } from '@/lib/pages';
import { Button, Notice, cx, fmtDateTime, money } from './ui';
import { friendlyError } from './Fields';
import { Recorder } from './Recorder';
import { Timeline } from './Timeline';
import { trackRecent } from '@/lib/recent';
import { QuickDate } from './QuickDate';
import { useToast } from './Toasts';
import { MentionInput } from './kit/MentionInput';
import { VoiceInput, appendText } from './kit/VoiceInput';
import { useRouter } from 'next/navigation';
import { stepForFollowUp, stepsForStage, type Step } from '@/lib/nextSteps';
import { STEP_ICON } from '@/lib/icons';

import { STAGES, STAGE_OWNER as OWNER, STAGE_INDEX } from '@/lib/journey';
import { PanelSkeleton } from './Skeletons';
import { Meter } from './kit/Meter';
import { Viewers } from './kit/Viewers';
import { ChatThread } from './kit/ChatThread';
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
  const [tab, setTabRaw] = useState<'Log' | 'Timeline' | 'Chat' | 'Details'>(() => { try { return (localStorage.getItem('stint-panel-tab') as 'Log') || 'Log'; } catch { return 'Log'; } });
  const setTab = (t: 'Log' | 'Timeline' | 'Chat' | 'Details') => { setTabRaw(t); try { localStorage.setItem('stint-panel-tab', t); } catch {} };
  // width you dragged it to, remembered
  const [width, setWidth] = useState(() => { try { return Number(localStorage.getItem('stint-panel-w')) || 380; } catch { return 380; } });
  const at = list.findIndex((x) => x.kind === person.kind && x.id === person.id);
  const prev = at > 0 ? list[at - 1] : null, next = at >= 0 && at < list.length - 1 ? list[at + 1] : null;
  const fullHref = person.kind === 'candidate' ? '/candidate/' + person.id : '/p/lead?edit=lead:' + person.id;
  const [action, setAction] = useState<'note' | 'call' | 'task' | 'record' | null>(null);
  const [form, setForm] = useState<Row>({});
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [invite, setInvite] = useState<{ email: string; password: string; url: string; reset: boolean } | null>(null);
  const [tasksOpen, setTasksOpen] = useState(false);
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

  useEffect(() => { setP(null); setProg({}); setMsg(null); setAction(null); setForm({}); setMoreOpen(false); setTasksOpen(false); setInvite(null); load(); }, [load]);

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

  if (!p) return <aside aria-label="Quick panel" style={{ '--pw': width + 'px' } as React.CSSProperties} className="fixed inset-x-0 bottom-0 z-40 max-h-[85dvh] w-full rounded-t-2xl border-t border-line shadow-2xl md:static md:z-auto md:max-h-none md:rounded-none md:border-t-0 md:border-l md:shadow-none shrink-0 bg-surface p-5 text-muted md:w-[var(--pw)]"><PanelSkeleton /></aside>;

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
    const optimistic = { kind: form.kind || 'Note', body: String(form.body).trim(), by_name: s.staff.full_name, at: new Date().toISOString(), _pending: true };
    setTimeline((t) => [optimistic, ...t]); setTab('Log');
    const { error } = await supabase().from('note').insert({ [idCol]: person.id, kind: form.kind || 'Note', body: String(form.body).trim(), by_id: s.staff.id, mentioned: form.mentioned || [] });
    setBusy(false);
    if (error) { setTimeline((t) => t.filter((x) => x !== optimistic)); return fail(error); } done('Note saved on the timeline.');
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
    setMoreOpen(false);
    if (st.inline === 'call') { setAction('call'); setForm({}); setMsg(null); return; }
    if (st.inline === 'convert') { moveStage('Converted'); return; }
    if (st.href) router.push(st.href(person));
  };
  const nextSteps = stepsForStage(p.stage).filter(allowed);
  const pick = (a: 'note' | 'call' | 'task' | 'record') => { setAction(a); setForm(a === 'note' ? { kind: 'Note' } : {}); setMsg(null); };
  const mode = action;
  const save = () => (mode === 'note' ? saveNote() : mode === 'call' ? saveCall() : mode === 'task' ? saveTask() : undefined);
  const iconBtn = 'flex h-11 w-11 items-center justify-center rounded-[10px] text-text2 transition-[background-color,transform] duration-150 ease-out hover:bg-surface2 hover:text-text active:scale-[0.97] motion-reduce:transform-none disabled:opacity-40';
  const tabs = [['Log', null], ['Timeline', timeline.length], ['Chat', null], ['Details', null]] as const;
  const StepIcon = ({ k, size = 15 }: { k: string; size?: number }) => { const I = STEP_ICON[k]; return I ? <I size={size} strokeWidth={2} aria-hidden /> : null; };

  return (
    <aside aria-label="Quick panel" style={{ '--pw': width + 'px' } as React.CSSProperties} className="anim-slide fixed inset-x-0 bottom-0 z-40 flex h-[85dvh] w-full shrink-0 flex-col overflow-hidden rounded-t-2xl border-t border-line bg-surface shadow-2xl md:relative md:z-auto md:h-auto md:max-h-none md:w-[var(--pw)] md:self-stretch md:rounded-none md:border-l md:border-t-0 md:shadow-none">
      <div role="separator" aria-orientation="vertical" aria-label="Drag to resize the panel" onPointerDown={startResize} onDoubleClick={() => { setWidth(380); try { localStorage.setItem('stint-panel-w', '380'); } catch {} }}
        className="absolute inset-y-0 left-0 z-20 hidden w-1.5 cursor-col-resize transition-colors duration-150 hover:bg-accent/40 md:block" />
      <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-line2 md:hidden" aria-hidden />

      {/* 1. header */}
      <header className="shrink-0 border-b border-line px-4 pb-3 pt-3">
        <div className="flex items-center gap-3">
          <span title={`Showing what ${s.staff.role} can see`}><Avatar name={p.full_name || '?'} id={person.id} /></span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold leading-tight">{p.full_name}</div>
            <div className="truncate text-xs text-text2">{isLead ? 'Lead' : 'Candidate'} · {p.program?.name || 'No course'}{p.batch?.code ? ' · ' + p.batch.code : ''} · {p.owner?.full_name || 'No owner'}</div>
          </div>
          <div className="-mr-2 flex shrink-0 items-center">
            {onNavigate && list.length > 1 && <>
              <button type="button" aria-label="Previous person (K)" title="Previous (K)" disabled={!prev} onClick={() => prev && onNavigate(prev)} className={iconBtn}><ChevronUp size={17} /></button>
              <button type="button" aria-label="Next person (J)" title="Next (J)" disabled={!next} onClick={() => next && onNavigate(next)} className={iconBtn}><ChevronDown size={17} /></button>
            </>}
            <Link href={fullHref} title={person.kind === 'candidate' ? 'Open full profile' : 'Open the full lead form'} aria-label={person.kind === 'candidate' ? 'Open full profile' : 'Open the full lead form'} className={iconBtn}><Maximize2 size={15} /></Link>
            <button type="button" aria-label="Hide panel (Esc)" title="Hide (Esc)" onClick={onClose} className={iconBtn}><X size={17} /></button>
          </div>
        </div>
        <div className="mt-2.5 flex gap-0.5" aria-hidden>
          {STAGES.map((_, i) => <span key={i} className={cx('h-1 flex-1 rounded-full transition-colors duration-200', i < si ? 'bg-accent' : i === si ? 'bg-coral' : 'bg-line2')} />)}
        </div>
        <div className="mt-1.5 flex justify-between gap-2 text-[11.5px] text-muted">
          <span className="truncate"><span className="font-semibold text-text2">{STAGES[si]}</span> · {si + 1}/9 · with {OWNER[si]} · {days}d</span>
          <span className="shrink-0">{s.staff.role} view{list.length > 1 && at >= 0 ? ` · ${at + 1}/${list.length}` : ''}</span>
        </div>
      </header>

      {/* 2. contact */}
      {(contact.mobile || contact.email || lockReason) && (
        <div className="shrink-0 border-b border-line px-4 py-2">
          {contact.mobile && <div className="flex min-h-[32px] items-center justify-between gap-2 text-[13px]"><span className="text-muted">Mobile</span><Reveal kind={kind} id={person.id} field="mobile" label="mobile" masked={contact.mobile} /></div>}
          {contact.email && <div className="flex min-h-[32px] items-center justify-between gap-2 text-[13px]"><span className="text-muted">Email</span><Reveal kind={kind} id={person.id} field="email" label="email" masked={contact.email} /></div>}
          {(contact.mobile || contact.email) && (
            <div className="-mx-1.5 mt-1 flex flex-wrap items-center gap-0.5">
              {contact.mobile && <Button variant="quiet" size="sm" aria-label="Call" disabled={!!lockReason} title={lockReason || 'Call'} onClick={() => openContact('mobile', 'tel')} leftIcon={<Phone size={14} />}>Call</Button>}
              {contact.mobile && <Button variant="quiet" size="sm" aria-label="WhatsApp" disabled={!!lockReason} title={lockReason || 'WhatsApp'} onClick={() => openContact('mobile', 'wa')} leftIcon={<MessageCircle size={14} />}>WhatsApp</Button>}
              {contact.email && <Button variant="quiet" size="sm" aria-label="Email" disabled={!!lockReason} title={lockReason || 'Email'} onClick={() => openContact('email', 'mail')} leftIcon={<Mail size={14} />}>Email</Button>}
              {contact.mobile && isAdmin && <Button variant="quiet" size="sm" aria-label="Copy" disabled={!!lockReason} title={lockReason || 'Copy number'} onClick={() => openContact('mobile', 'copy')} leftIcon={<Copy size={13} />}>Copy</Button>}
            </div>
          )}
          {lockReason && <div role="note" className="my-1 rounded-[10px] bg-warnBg px-3 py-1.5 text-[12px] font-medium text-warnText">{lockReason.startsWith('Details locked') ? lockReason : 'Details locked: ' + lockReason} — ask Admin</div>}
        </div>
      )}

      {/* scroll area: only this part scrolls */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="panel-scroll">
        <div className="flex flex-col gap-2 px-4 pb-2 pt-3">
          <Viewers kind={person.kind} id={person.id} />
          {(prog.fees || prog.docs) && (
            <div className="flex flex-col gap-2 rounded-[10px] border border-line p-2.5">
              {prog.fees && <Meter label="Fees paid" value={prog.fees[0]} max={prog.fees[1]} text={`${money(prog.fees[0])} of ${money(prog.fees[1])}`} />}
              {prog.docs && <Meter label="Documents in" value={prog.docs[0]} max={prog.docs[1]} />}
            </div>
          )}

          {/* 3. next step strip */}
          {(nextSteps.length > 0 || tasks.length > 0) && (
            <div className="flex flex-col gap-1.5">
              {nextSteps.length > 0 && <div className="text-[11.5px] font-semibold text-muted">Next steps · {p.stage}</div>}
              {nextSteps[0] && <button type="button" title={nextSteps[0].label} onClick={() => runStep(nextSteps[0])} className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-[10px] bg-accent px-3 text-[13px] font-semibold text-white transition-transform duration-150 ease-out active:scale-[0.97] motion-reduce:transform-none"><StepIcon k={nextSteps[0].key} /><span className="truncate">{nextSteps[0].label}</span></button>}
              <div className="flex items-center gap-1.5">
                {nextSteps.length > 1 && (
                  <div className="relative flex-1">
                    <button type="button" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)} className="flex min-h-[44px] w-full items-center justify-center gap-1 rounded-[10px] bg-surface2 px-3 text-[13px] font-semibold text-text2"><MoreHorizontal size={16} aria-hidden />More steps ({nextSteps.length - 1})</button>
                    {moreOpen && <>
                      <div className="fixed inset-0 z-30" onClick={() => setMoreOpen(false)} aria-hidden />
                      <div role="menu" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setMoreOpen(false); } }} className="anim-fade absolute left-0 top-full z-40 mt-1 flex w-64 max-w-[calc(100vw-2rem)] origin-top-left flex-col rounded-[12px] border border-line bg-surface p-1 shadow-xl">
                        {nextSteps.slice(1).map((st) => <button key={st.key} role="menuitem" type="button" onClick={() => runStep(st)} className="flex min-h-[44px] items-center gap-2 rounded-lg px-2.5 text-left text-[13px] font-medium hover:bg-surface2"><StepIcon k={st.key} />{st.label}</button>)}
                      </div>
                    </>}
                  </div>
                )}
                {tasks.length > 0 && (
                  <button type="button" aria-expanded={tasksOpen} onClick={() => setTasksOpen((o) => !o)} className={cx('flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-[10px] px-3 text-[12.5px] font-semibold', overdue ? 'bg-badBg text-badText' : 'bg-surface2 text-text2', !nextSteps.length && 'flex-1 justify-between')}>
                    <CalendarClock size={15} aria-hidden />{tasks.length} follow-up{tasks.length > 1 ? 's' : ''}{overdue ? ` · ${overdue} late` : ''}
                    <ChevronDown size={14} aria-hidden className={cx('transition-transform duration-200 ease-out', tasksOpen && 'rotate-180')} />
                  </button>
                )}
              </div>
              {tasksOpen && tasks.length > 0 && (
                <div className="anim-fade flex flex-col divide-y divide-line rounded-[10px] border border-line">
                  {tasks.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[13px]">
                      <span className="min-w-0"><span className="font-medium">{t.title}</span> <span className={cx('text-[12px]', new Date(t.due_at).getTime() < Date.now() - 86400000 ? 'text-badText' : 'text-muted')}>· {t.owner_role} · {fmtDateTime(t.due_at)}</span></span>
                      <span className="flex shrink-0 gap-1">
                        {(() => { const st = stepForFollowUp(t.title, person.kind); return st && allowed(st) ? (
                          <button type="button" className="flex min-h-[36px] items-center gap-1 rounded-md bg-accent px-2.5 text-xs font-semibold text-white" onClick={() => runStep(st)}><StepIcon k={st.key} size={13} />{st.label}</button>) : null; })()}
                        {!t.owner_id || mayActFor(t.owner_id, s.staff, s.refs.staff || [])
                          ? <button type="button" className="min-h-[36px] rounded-md border border-line2 bg-surface px-2.5 text-xs font-medium" onClick={() => finishTask(t)}>Done</button>
                          : <span className="text-[11.5px] text-muted" title="Only the owner or their team head can close it">{(s.refs.staff || []).find((x) => x.id === t.owner_id)?.label.split(' ')[0]}’s</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 4. tab bar, sticks to the top of the scroll area */}
        <div role="tablist" className="sticky top-0 z-10 flex shrink-0 gap-4 border-b border-line bg-surface px-4">
          {tabs.map(([t, n]) => (
            <button key={t} type="button" role="tab" aria-label={t} aria-selected={tab === t} onClick={() => setTab(t)}
              className={cx('relative flex min-h-[44px] items-center gap-1.5 text-[13px] font-semibold transition-colors duration-150', tab === t ? 'text-text' : 'text-muted hover:text-text2')}>
              {t}{n ? <span aria-hidden className="num rounded-full bg-surface2 px-1.5 text-[11px] text-text2">{n}</span> : null}
              <span aria-hidden className={cx('absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent transition-opacity duration-150', tab === t ? 'opacity-100' : 'opacity-0')} />
            </button>
          ))}
        </div>

        {/* 5. content */}
        <div className="flex flex-1 flex-col gap-2.5 px-4 py-3">
          {tab === 'Log' && (
            <div className="anim-fade flex flex-col gap-2.5">
              {canWritePerson && (
                <label className="flex items-center justify-between gap-2 text-[12.5px] text-muted">
                  Move stage
                  <select className="h-9 min-w-0 max-w-[60%] rounded-lg border-transparent bg-surface2 px-2.5 text-[13px] font-medium text-text" value={p.stage} onChange={(e) => moveStage(e.target.value)}>
                    {stageList.map((st) => <option key={st}>{st}</option>)}
                  </select>
                </label>
              )}
              {!canWritePerson && !canCall && <div className="text-[13px] text-text2">You can add notes and follow-ups here. Changing the stage is for the team that owns it.</div>}
              <div className="text-[11.5px] font-semibold text-muted">Latest</div>
              {timeline.length === 0 && <div className="text-[13px] text-muted">Nothing logged yet. Use the box below.</div>}
              <ul className="flex flex-col gap-1.5">
                {[...timeline].sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 5).map((t, i) => (
                  <li key={i} className={cx('rounded-[10px] bg-surface2 px-3 py-2 text-[13px] transition-opacity duration-200', t._pending && 'opacity-60')}>
                    <div className="flex justify-between gap-2 text-[11.5px] text-muted"><span className="font-semibold text-text2">{t.kind}</span><span>{t._pending ? 'Saving…' : `${t.by_name || ''} · ${fmtDateTime(t.at)}`}</span></div>
                    <div className="line-clamp-3 whitespace-pre-wrap">{String(t.body || '')}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tab === 'Timeline' && <Timeline items={timeline} />}
          {tab === 'Chat' && <div className="flex min-h-[320px] flex-1 flex-col [&>[data-testid=chat]]:max-h-none [&>[data-testid=chat]]:flex-1"><ChatThread kind={isLead ? 'lead' : 'candidate'} id={person.id} /></div>}
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
                      if (res.ok) setInvite({ email: out.email, password: out.password, url: window.location.origin + '/login', reset: !!out.reset });
                      else setMsg({ tone: 'bad', text: out.error || 'Could not invite.' });
                    }} title="Creates the student's login, or gives them a new temporary password if they already have one">Invite or reset portal login</Button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 6. composer, always at the bottom */}
      <div className="max-h-[60%] shrink-0 overflow-y-auto border-t border-line bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2" data-testid="composer"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !busy) { e.preventDefault(); save(); } }}>
        {msg && <div className="mb-2"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
        {invite && <InviteCard invite={invite} name={p?.full_name || ''} onClose={() => setInvite(null)} />}

        <div className={cx('flex items-center gap-2', mode && 'mb-2')}>
          <div className="flex flex-1 gap-0.5">
            {([['note', 'Note', 'Add note'], ...(canCall ? [['call', 'Call', 'Log call']] : []), ['task', 'Follow-up', 'Add follow-up']] as ['note' | 'call' | 'task', string, string][]).map(([k, label, aria]) => (
              <button key={k} type="button" aria-label={aria} aria-pressed={mode === k} onClick={() => pick(k)}
                className={cx('btn h-8 rounded-full px-3 text-[12.5px] font-medium transition-[background-color,color] duration-150 ease-out', mode === k ? 'bg-accentSoft font-semibold text-accentText' : 'text-text2 hover:bg-surface2 hover:text-text')}>{label}</button>
            ))}
          </div>
          {mode && <button type="button" aria-label="Close the box" title="Close (keeps nothing)" onClick={() => { setAction(null); setForm({}); }} className={iconBtn}><X size={16} /></button>}
          {canRecord && <button type="button" aria-label="Record" title="Record a talk" aria-pressed={mode === 'record'} onClick={() => pick('record')} className={cx(iconBtn, mode === 'record' && 'bg-accentSoft text-accentText')}><Mic size={17} /></button>}
        </div>
        {mode === 'record' && <Recorder person={person} onSaved={(t) => { setMsg({ tone: 'good', text: t }); setAction(null); }} />}
        {mode === 'note' && (
          <div className="flex flex-col gap-2 rounded-2xl border border-line2 bg-surface2 p-2 transition-[border-color,box-shadow] duration-150 focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgb(68_116_185/0.15)] [&_textarea]:border-0 [&_textarea]:bg-transparent [&_textarea]:shadow-none [&_textarea]:outline-none">
            <MentionInput label="Note" placeholder="What happened? Type @ to notify a colleague" value={form.body || ''} onChange={(v) => setForm((f) => ({ ...f, body: v }))} mentions={form.mentioned || []} onMentionsChange={(ids) => setForm((f) => ({ ...f, mentioned: ids }))} />
            <div className="flex items-center gap-2">
              <select aria-label="Kind of note" className="h-9 rounded-lg border-transparent bg-surface px-2 text-[13px]" value={form.kind || 'Note'} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {['Note', 'Message', 'Training', 'Resume', 'Fee', 'Placement'].map((k) => <option key={k}>{k}</option>)}
              </select>
              <Button variant="primary" size="sm" className="ml-auto" disabled={busy} onClick={saveNote}>Save note</Button>
            </div>
          </div>
        )}
        {mode === 'call' && (
          <div className="flex flex-col gap-2 rounded-2xl border border-line2 bg-surface2 p-2">
            <div className="flex flex-wrap gap-1.5">
              {(s.lists.call_outcome || []).map((o) => (
                <button key={o} type="button" aria-pressed={form.outcome === o} onClick={() => setForm({ ...form, outcome: o })} className={cx('btn h-8 rounded-full border px-3 text-xs font-medium transition-colors duration-150', form.outcome === o ? 'border-accent bg-accentSoft text-accentText' : 'border-line2 bg-surface')}>{o}</button>
              ))}
            </div>
            <textarea aria-label="Call notes" placeholder="Notes (optional)" className="min-h-[56px] border-0 bg-transparent px-2 py-1.5 text-sm shadow-none outline-none" value={form.body || ''} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            <div className="flex items-center gap-2">
              <VoiceInput context="call" onText={(t, r) => setForm((f) => ({ ...f, body: appendText(f.body || '', t), outcome: f.outcome || ((s.lists.call_outcome || []).includes(r.outcome || '') ? r.outcome : f.outcome) }))} />
              <input aria-label="Minutes" type="number" min={0} inputMode="numeric" placeholder="Min" className="h-9 w-16 rounded-lg border-transparent bg-surface px-2 text-[13px]" value={form.duration ? Math.round(Number(form.duration) / 60) || '' : ''} onChange={(e) => setForm({ ...form, duration: Number(e.target.value || 0) * 60 })} />
              <Button variant="primary" size="sm" className="ml-auto" disabled={busy} onClick={saveCall}>Save call</Button>
            </div>
          </div>
        )}
        {mode === 'task' && (
          <div className="flex flex-col gap-2 rounded-2xl border border-line2 bg-surface2 p-2">
            {form.suggested && <div className="text-[12px] text-text2">{form.suggested} Change it if needed.</div>}
            <input aria-label="What needs doing" placeholder="What needs doing" className="h-11 px-3 text-sm" value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <QuickDate label="Due" value={form.due ? new Date(form.due).toISOString() : null} onChange={(iso) => setForm({ ...form, due: iso || '' })} />
            <Button variant="primary" size="sm" className="self-end" disabled={busy} onClick={saveTask}>Save follow-up</Button>
          </div>
        )}
        {mode && mode !== 'record' && <div className="mt-1.5 text-right text-[11px] text-muted max-md:hidden">Ctrl/⌘ + Enter to save</div>}
      </div>
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

/** Login details shown once after inviting a student or resetting their portal password. The password is not stored
 *  in a readable form, so it cannot be shown again: to give access later, press "Invite or reset portal login" again. */
function InviteCard({ invite, name, onClose }: { invite: { email: string; password: string; url: string; reset: boolean }; name: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `Hi ${name.split(' ')[0] || ''}, your Stint student portal login:\nAddress: ${invite.url}\nEmail: ${invite.email}\nTemporary password: ${invite.password}\nYou will choose your own password when you first sign in.`;
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ } };
  return (
    <div role="status" data-testid="invite-card" className="mb-2 flex flex-col gap-2 rounded-[12px] bg-goodBg p-3 text-[13px] text-goodText">
      <div className="font-semibold">{invite.reset ? 'New temporary password made' : 'Student portal login created'}</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-text">
        <dt className="text-text2">Address</dt><dd className="truncate">{invite.url}</dd>
        <dt className="text-text2">Email</dt><dd className="truncate">{invite.email}</dd>
        <dt className="text-text2">Password</dt><dd className="font-mono font-semibold">{invite.password}</dd>
      </dl>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="primary" onClick={copy}>{copied ? 'Copied ✓' : 'Copy login details'}</Button>
        <a className="btn inline-flex h-8 items-center rounded-[8px] bg-surface px-3 text-[13px] font-semibold text-text" target="_blank" rel="noreferrer" href={'https://wa.me/?text=' + encodeURIComponent(text)}>Share on WhatsApp</a>
        <Button size="sm" variant="quiet" onClick={onClose}>Done</Button>
      </div>
      <p className="text-[12px] text-text2">Shown only once. If the student loses it, press <b>Invite or reset portal login</b> again to make a new one.</p>
    </div>
  );
}
