'use client';
import { plainMessage } from '@/lib/plainMessage';
import Link from 'next/link';
import { CalendarPlus, PanelRightClose, ChevronDown, ChevronUp, Copy, Mail, Maximize2, MessageCircle, Mic, Phone, Sparkles, X } from 'lucide-react';
import { Avatar } from './kit/Avatar';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { PersonRef, Row } from '@/lib/pages';
import { Button, Notice, cx, fmtDate, fmtDateTime, money } from './ui';
import { friendlyError } from './Fields';
import { explainStageError } from '@/lib/stageMoves';
import { Recorder } from './Recorder';
import { Timeline } from './Timeline';
import { trackRecent } from '@/lib/recent';
import { QuickDate } from './QuickDate';
import { useToast } from './Toasts';
import { MentionInput } from './kit/MentionInput';
import { Threads, ago } from './kit/Threads';
import { VoiceInput, appendText } from './kit/VoiceInput';
import { useRouter } from 'next/navigation';
import { stepForFollowUp, stepsForStage, type Step } from '@/lib/nextSteps';
import { StageControl } from './profile/StageControl';
import { NextSteps, StepIcon } from './profile/NextSteps';
import { DetailGroup, PrivateDetails } from './profile/PrivateDetails';
import { PanelSkeleton } from './Skeletons';
import { Viewers } from './kit/Viewers';
import { ChatThread } from './kit/ChatThread';
import { mayActFor } from '@/lib/pages';
import { Reveal, contactStatus, revealOnce } from './kit/Reveal';
import { RailCard } from './panel/RailCard';
import { FeesCard } from './panel/FeesCard';
import { AttendanceCard } from './panel/AttendanceCard';
import { MocksResumeCard } from './panel/MocksResumeCard';
import { DocumentsCard } from './panel/DocumentsCard';
import { BrochureCard } from './panel/BrochureCard';
import { LeadSignalLine } from './kit/ScoreBadge';
const CALL_TO_STAGE: Record<string, string> = { Interested: 'Interested', Callback: 'Callback', 'Booked counselling': 'Counselling', 'Not interested': 'Not interested' };

/** Cards each role usually needs first (Stage, Next follow-ups, Fees, Attendance, Mocks and resume, Documents, Calls and notes, Activity, Messages, Details). */
const ROLE_OPEN: Record<string, string[]> = {
  Admin: ['stage', 'follow', 'fees'], Finance: ['fees', 'follow'], Trainer: ['attend', 'log'], SME: ['mocks', 'log'], Placement: ['mocks', 'docs'],
  'HR / Counsellor': ['stage', 'mocks'], Telecaller: ['follow', 'log'], Sales: ['stage', 'follow'], 'Front desk': ['follow', 'log'], Marketing: ['stage', 'log'],
};
const OPEN_KEY = 'stint-panel-open';
function readOpen(key: string): string[] | null {
  try { const m = JSON.parse(localStorage.getItem(OPEN_KEY) || '{}'); return Array.isArray(m[key]) ? m[key] : null; } catch { return null; }
}
function writeOpen(key: string, ids: string[]) {
  try {
    const m = JSON.parse(localStorage.getItem(OPEN_KEY) || '{}'); delete m[key]; m[key] = ids;
    const keys = Object.keys(m); for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete m[k];   // keep the last 200 people
    localStorage.setItem(OPEN_KEY, JSON.stringify(m));
  } catch { /* storage blocked: cards still work, just not remembered */ }
}

export function QuickPanel({ person, onClose, onChanged, list = [], onNavigate }: { person: PersonRef; onClose: () => void; onChanged: () => void; list?: PersonRef[]; onNavigate?: (p: PersonRef) => void }) {
  const s = useSession();
  const router = useRouter();
  const toast = useToast();
  const isLead = person.kind === 'lead';
  const [p, setP] = useState<Row | null>(null);
  const [timeline, setTimeline] = useState<Row[]>([]);
  const [tasks, setTasks] = useState<Row[]>([]);
  const [priv, setPriv] = useState<Row | null>(null);
  const [chatChannel, setChatChannel] = useState<'whatsapp' | 'email' | undefined>(undefined);
  const [msgReady, setMsgReady] = useState<{ whatsapp: boolean; email: boolean } | null>(null);
  useEffect(() => { fetch('/api/messages/send').then((r) => (r.ok ? r.json() : null)).then((j) => j && setMsgReady({ whatsapp: !!j.whatsapp, email: !!j.email })).catch(() => {}); }, []);
  // which cards are open: remembered per person in this browser; a new person starts with the cards this role uses most
  const [openCards, setOpenCards] = useState<string[]>([]);
  const cardKey = person.kind + ':' + person.id;
  useEffect(() => { setOpenCards(readOpen(cardKey) ?? (ROLE_OPEN[s.staff.role] || ['stage', 'log'])); }, [cardKey, s.staff.role]);
  const saveOpen = (next: (ids: string[]) => string[]) => setOpenCards((cur) => { const ids = next(cur); writeOpen(cardKey, ids); return ids; });
  const toggleCard = (id: string) => saveOpen((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const openCard = (id: string) => {
    saveOpen((cur) => (cur.includes(id) ? cur : [...cur, id]));
    requestAnimationFrame(() => document.querySelector(`aside[aria-label="Quick panel"] [data-card="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };
  const [tick, setTick] = useState(0);
  // width you dragged it to, remembered
  const [width, setWidth] = useState(() => { try { return Number(localStorage.getItem('stint-panel-w')) || 372; } catch { return 372; } });
  const at = list.findIndex((x) => x.kind === person.kind && x.id === person.id);
  const prev = at > 0 ? list[at - 1] : null, next = at >= 0 && at < list.length - 1 ? list[at + 1] : null;
  const fullHref = person.kind === 'candidate' ? '/candidate/' + person.id : '/p/lead?edit=lead:' + person.id;
  const [action, setAction] = useState<'note' | 'call' | 'task' | 'record' | null>(null);
  const [form, setForm] = useState<Row>({});
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [stageAsk, setStageAsk] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ email: string; password: string; url: string; reset: boolean } | null>(null);
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
    if (!isLead) { const pv = await db.rpc('candidate_private_get', { cid: person.id }); setPriv(pv.data); }
    setTick((n) => n + 1);
  }, [person.kind, person.id, isLead, idCol]);

  useEffect(() => { setP(null); setMsg(null); setAction(null); setForm({}); setStageAsk(null); setInvite(null); load(); }, [load]);
  // back from Live help: open Log call filled with the call summary (kept in this tab only, never in the address)
  useEffect(() => {
    if (!p || p.id !== person.id || !isLead || !canCall) return;   // after the lead has loaded, so the panel reset does not wipe it
    const k = 'stint-live-draft:' + person.id;
    let d: { outcome?: string | null; body?: string; duration?: number } | null = null;
    try { d = JSON.parse(sessionStorage.getItem(k) || 'null'); sessionStorage.removeItem(k); } catch { d = null; }
    if (!d) return;
    const outcome = d.outcome && (s.lists.call_outcome || []).includes(d.outcome) ? d.outcome : undefined;
    setAction('call'); setForm({ outcome, body: d.body || '', duration: Number(d.duration || 0) });
    setMsg({ tone: 'good', text: 'Filled in from Live help. Check the outcome and notes, then press Save call.' });
  }, [p, person.id, isLead, canCall, s.lists.call_outcome]);

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
    // In-CRM messaging (when set up): open the Chat tab on that channel instead of an outside app
    if ((how === 'wa' || how === 'mail') && msgReady?.[how === 'wa' ? 'whatsapp' : 'email']) { setChatChannel(how === 'wa' ? 'whatsapp' : 'email'); openCard('chat'); return; }
    const v = await revealOnce(kind, person.id, field);
    if (!v) { setMsg({ tone: 'bad', text: 'Could not show this detail. ' + (lockReason || '') }); return; }
    const digits = v.replace(/\D/g, '').slice(-10);
    if (how === 'tel') window.location.href = 'tel:+91' + digits;
    else if (how === 'wa') window.open('https://wa.me/91' + digits, '_blank', 'noopener');
    else if (how === 'mail') window.location.href = 'mailto:' + v;
    else { navigator.clipboard?.writeText('+91 ' + digits); toast('Number copied'); }
  };
  const btn = 'flex min-h-[44px] flex-col items-center justify-center rounded-[10px] bg-surface text-[11px] font-semibold text-text2 hover:text-accentText disabled:opacity-40';
  const overdue = tasks.filter((t) => new Date(t.due_at).getTime() < Date.now() - 86400000).length;

  const done = (text: string) => { setMsg({ tone: 'good', text }); setAction(null); setForm({}); load(); onChanged(); };
  const fail = (e: { code?: string; message?: string }) => setMsg({ tone: 'bad', text: friendlyError(e) });

  const saveNote = async () => {
    if (!String(form.body || '').trim()) { setMsg({ tone: 'bad', text: 'Write the note first.' }); return; }
    setBusy(true);
    const optimistic = { kind: form.kind || 'Note', body: String(form.body).trim(), by_name: s.staff.full_name, at: new Date().toISOString(), _pending: true };
    setTimeline((t) => [optimistic, ...t]); openCard('log');
    const { error } = await supabase().from('note').insert({ [idCol]: person.id, kind: form.kind || 'Note', body: String(form.body).trim(), by_id: s.staff.id, mentioned: form.mentioned || [] });
    setBusy(false);
    if (error) { setTimeline((t) => t.filter((x) => x !== optimistic)); return fail(error); } done('Note saved on the timeline.');
  };
  const saveCall = async () => {
    if (!form.outcome) { setMsg({ tone: 'bad', text: 'Pick the outcome.' }); return; }
    // moving a lead to Not interested needs a reason (stage rule), so it is asked here, before anything is saved
    const lostNeeded = isLead && CALL_TO_STAGE[form.outcome] === 'Not interested' && CALL_TO_STAGE[form.outcome] !== p.stage && canWritePerson;
    if (lostNeeded && !form.lost_reason) { setMsg({ tone: 'bad', text: 'Pick why they are not interested.' }); return; }
    setBusy(true);
    const db = supabase();
    const { error } = await db.from('call_log').insert({ lead_id: person.id, caller_id: s.staff.id, outcome: form.outcome, notes: form.body || null, duration_sec: Number(form.duration || 0) });
    if (error) { setBusy(false); return fail(error); }
    let extra = '';
    const next = CALL_TO_STAGE[form.outcome];
    if (next && next !== p.stage && canWritePerson) {
      const up = await db.from('lead').update({ stage: next, ...(next === 'Not interested' ? { lost_reason: form.lost_reason } : {}) }).eq('id', person.id);
      if (!up.error) extra = ` Stage moved to ${next}.`;
      else { setBusy(false); setMsg({ tone: 'bad', text: 'Call logged, but the stage did not move: ' + explainStageError(up.error, next, s.staff.role).text }); load(); onChanged(); return; }
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
  const moved = (stage: string, message?: string) => { if (message) done(message); else { setMsg(null); load(); onChanged(); } };
  const finishTask = async (t: Row) => {
    const { error } = await supabase().from('follow_up').update({ status: 'Done' }).eq('id', t.id);
    if (error) return fail(error);
    setMsg(null); load(); onChanged();
    toast('Done: ' + t.title, { undo: async () => { await supabase().from('follow_up').update({ status: 'Open' }).eq('id', t.id); load(); onChanged(); } });
  };

  const allowed = (st: Step) => (st.inline === 'call' ? canCall : st.inline === 'convert' ? canWritePerson && isLead : s.can(st.page, 'w'));
  const runStep = (st: Step) => {
    if (st.inline === 'call') { setAction('call'); setForm({}); setMsg(null); return; }
    if (st.inline === 'convert') { setStageAsk('Converted'); return; }
    if (st.href) router.push(st.href(person));
  };
  const nextSteps = stepsForStage(p.stage).filter(allowed);
  const pick = (a: 'note' | 'call' | 'task' | 'record') => { setAction(a); setForm(a === 'note' ? { kind: 'Note' } : {}); setMsg(null); };
  const mode = action;
  const save = () => (mode === 'note' ? saveNote() : mode === 'call' ? saveCall() : mode === 'task' ? saveTask() : undefined);
  const pillBtn = 'btn inline-flex h-8 items-center gap-1.5 rounded-lg border border-line2 bg-surface px-2.5 text-[12.5px] font-medium text-text2 hover:bg-surface2 hover:text-text disabled:opacity-40';
  const iconBtn = 'btn flex h-8 w-8 items-center justify-center rounded-lg text-text2 hover:bg-surface2 hover:text-text disabled:opacity-40';
  // sidebar-style row button: 32px tall (44px hit area from .btn), quiet tint on hover
  const rowBtn = 'btn inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-text2 hover:bg-surface2 hover:text-text disabled:opacity-40';
  const stages: string[] = s.lists[isLead ? 'lead_stage' : 'candidate_stage'] || [];
  const stageAt = stages.indexOf(p.stage);
  const lastLog = timeline.reduce<Row | null>((a, t) => (!a || +new Date(t.at) > +new Date(a.at) ? t : a), null);
  const nextTask = tasks[0];
  const card = { open: (id: string) => openCards.includes(id), onToggle: toggleCard };

  return (
    <aside aria-label="Quick panel" style={{ '--pw': width + 'px' } as React.CSSProperties} className="anim-slide fixed inset-x-0 bottom-0 z-40 flex h-[85dvh] w-full shrink-0 flex-col overflow-hidden rounded-t-2xl border-t border-line bg-bg shadow-2xl md:relative md:z-auto md:h-auto md:max-h-none md:w-[var(--pw)] md:self-stretch md:rounded-none md:border-l md:border-t-0 md:shadow-none">
      <div role="separator" aria-orientation="vertical" aria-label="Drag to resize the panel" onPointerDown={startResize} onDoubleClick={() => { setWidth(372); try { localStorage.setItem('stint-panel-w', '372'); } catch {} }}
        className="absolute inset-y-0 left-0 z-20 hidden w-1.5 cursor-col-resize transition-colors duration-150 hover:bg-accent/40 md:block" />
      <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-line2 md:hidden" aria-hidden />

      {/* 1. who this is, and the quick ways to reach them (always visible) */}
      <header className="shrink-0 px-3 pt-3">
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
          <div className="flex items-center gap-2.5">
            <span title={`Showing what ${s.staff.role} can see`}><Avatar name={p.full_name || '?'} id={person.id} /></span>
            <div className="min-w-0 flex-1">
              <div data-testid="qp-name" className="truncate text-[14.5px] font-semibold leading-tight">{p.full_name}</div>
              <div className="line-clamp-2 text-[12px] leading-snug text-muted" title={`${s.staff.role} view`}>{isLead ? 'Lead' : 'Candidate'} · {p.program?.name || 'No course'}{p.batch?.code ? ' · ' + p.batch.code : ''} · {p.owner?.full_name || 'No owner'}</div>
            </div>
            <div className="-mr-1 flex shrink-0 items-center gap-0.5">
              {onNavigate && list.length > 1 && <>
                {at >= 0 && <span className="num px-0.5 text-[11.5px] text-muted">{at + 1}/{list.length}</span>}
                <button type="button" aria-label="Previous person (K)" title="Previous (K)" disabled={!prev} onClick={() => prev && onNavigate(prev)} className={iconBtn}><ChevronUp size={16} strokeWidth={1.8} /></button>
                <button type="button" aria-label="Next person (J)" title="Next (J)" disabled={!next} onClick={() => next && onNavigate(next)} className={iconBtn}><ChevronDown size={16} strokeWidth={1.8} /></button>
              </>}
              <Link href={fullHref} title={person.kind === 'candidate' ? 'Open full profile' : 'Open the full lead form'} aria-label={person.kind === 'candidate' ? 'Open full profile' : 'Open the full lead form'} className={iconBtn}><Maximize2 size={15} strokeWidth={1.8} /></Link>
              <button type="button" aria-label="Hide panel (Esc)" title="Hide panel (Esc). Show it again from the top of the list." onClick={onClose} className={iconBtn}><PanelRightClose size={16} strokeWidth={1.8} /></button>
            </div>
          </div>
          {(contact.mobile || contact.email) && (
            <div className="-mx-1 flex flex-wrap items-center gap-1">
              {contact.mobile && <button type="button" aria-label="Call" disabled={!!lockReason} title={lockReason || 'Call'} onClick={() => openContact('mobile', 'tel')} className={pillBtn}><Phone size={14} strokeWidth={1.8} aria-hidden />Call</button>}
              {contact.mobile && <button type="button" aria-label="WhatsApp" disabled={!!lockReason} title={lockReason || 'WhatsApp'} onClick={() => openContact('mobile', 'wa')} className={pillBtn}><MessageCircle size={14} strokeWidth={1.8} aria-hidden />WhatsApp</button>}
              {contact.email && <button type="button" aria-label="Email" disabled={!!lockReason} title={lockReason || 'Email'} onClick={() => openContact('email', 'mail')} className={pillBtn}><Mail size={14} strokeWidth={1.8} aria-hidden />Email</button>}
              {contact.mobile && isAdmin && <button type="button" aria-label="Copy" disabled={!!lockReason} title={lockReason || 'Copy number'} onClick={() => openContact('mobile', 'copy')} className={cx(pillBtn, 'w-8 justify-center px-0')}><Copy size={14} strokeWidth={1.8} aria-hidden /></button>}
            </div>
          )}
          {/* score and best time to call; reloads after a new call or note */}
          {isLead && <LeadSignalLine key={person.id + ':' + (lastLog?.at || '')} leadId={person.id} />}
          {lockReason && <div role="note" className="rounded-[10px] bg-warnBg px-3 py-1.5 text-[12px] font-medium text-warnText">{lockReason.startsWith('Details locked') ? lockReason : 'Details locked: ' + lockReason} — ask Admin</div>}
          <Viewers kind={person.kind} id={person.id} />
        </div>
      </header>

      {/* 2. one card per topic: one line each, open in place. Only this part scrolls. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3 pt-2" data-testid="panel-scroll">
        <div className="flex min-h-[32px] items-center justify-between px-1">
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">About {(p.full_name || '').split(' ')[0]}</span>
          {openCards.length > 0 && <button type="button" onClick={() => saveOpen(() => [])} className="btn h-8 rounded-md px-2 text-[12px] font-medium text-accentText hover:bg-accentSoft">Close all</button>}
        </div>

        <RailCard id="stage" label="Stage" testId="card-stage" {...card} open={card.open('stage')}
          summary={<>
            {stages.length > 1 && stages.length <= 12 && stageAt >= 0 && <span aria-hidden className="flex shrink-0 gap-[3px]">{stages.map((st, i) => <i key={st} className={cx('block h-1.5 w-1.5 rounded-full', i < stageAt ? 'bg-accent' : i === stageAt ? 'bg-coral' : 'bg-line2')} />)}</span>}
            <span className="t font-medium text-text">{p.stage || 'No stage'}</span>
          </>}>
          <div className="flex flex-col gap-2.5">
            <StageControl compact kind={kind} id={person.id} stage={p.stage} changedAt={p.stage_changed_at} onMoved={moved} request={stageAsk} onRequestSeen={() => setStageAsk(null)} />
            {nextSteps.length > 0 && <NextSteps inline stage={p.stage} steps={nextSteps} onRun={runStep} />}
          </div>
        </RailCard>

        <RailCard id="follow" label="Next follow-ups" testId="card-follow" {...card} open={card.open('follow')}
          summary={nextTask ? <>
            <span className="t">{fmtDateTime(nextTask.due_at)}</span>
            <span className={cx('num inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold', overdue ? 'bg-coral text-white' : 'bg-surface2 text-text2')} title={overdue ? `${overdue} late` : `${tasks.length} open`}>{overdue ? `${overdue} late` : tasks.length}</span>
          </> : <span className="t text-muted">None open</span>}>
          {tasks.length === 0 && <div className="text-[13px] text-muted">No open follow-ups.</div>}
          {tasks.length > 0 && (
            <div className="flex flex-col divide-y divide-line border-y border-line">
              {tasks.map((t) => (
                <div key={t.id} className="flex flex-col gap-0.5 py-2 text-[13px]">
                  <div className="font-medium">{t.title}</div>
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <span className={cx('text-[12px]', new Date(t.due_at).getTime() < Date.now() - 86400000 ? 'font-medium text-badText' : 'text-muted')}>{[t.owner_role, fmtDateTime(t.due_at)].filter(Boolean).join(' · ')}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    {(() => { const st = stepForFollowUp(t.title, person.kind); return st && allowed(st) ? (
                      <button type="button" className="btn flex h-8 items-center gap-1 rounded-lg bg-accent px-2.5 text-xs font-semibold text-white" onClick={() => runStep(st)}><StepIcon k={st.key} size={13} />{st.label}</button>) : null; })()}
                    {!t.owner_id || mayActFor(t.owner_id, s.staff, s.refs.staff || [])
                      ? <button type="button" className="btn h-8 rounded-lg px-2.5 text-xs font-medium text-text2 hover:bg-surface2 hover:text-text" onClick={() => finishTask(t)}>Done</button>
                      : <span className="text-right text-[11.5px] leading-tight text-muted">Only {(s.refs.staff || []).find((x) => x.id === t.owner_id)?.label.split(' ')[0] || 'the owner'} can close</span>}
                  </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button type="button" onClick={() => pick('task')} className={cx(rowBtn, 'mt-1 self-start')}><CalendarPlus size={14} strokeWidth={1.8} aria-hidden />New follow-up</button>
        </RailCard>

        {isLead && <BrochureCard leadId={person.id} programId={p.program_id ?? null} {...card} open={card.open('brochure')} />}

        {!isLead && <>
          <FeesCard candidateId={person.id} {...card} open={card.open('fees')} reloadKey={tick} />
          <AttendanceCard candidateId={person.id} {...card} open={card.open('attend')} reloadKey={tick} />
          <MocksResumeCard candidateId={person.id} {...card} open={card.open('mocks')} reloadKey={tick} />
          <DocumentsCard candidateId={person.id} {...card} open={card.open('docs')} reloadKey={tick} />
        </>}

        <RailCard id="log" label="Calls and notes" testId="card-log" {...card} open={card.open('log')}
          summary={lastLog ? <span className="t">Last: {String(lastLog.kind || 'Note').toLowerCase()}, {ago(lastLog.at)}</span> : <span className="t text-muted">Nothing yet</span>}>
          <div className="flex flex-col gap-1">
            <div className="border-b border-line pb-1"><Threads kind={isLead ? 'lead' : 'candidate'} id={person.id} compact /></div>
            {timeline.length === 0 && <div className="text-[13px] text-muted">Nothing logged yet. Use the box below.</div>}
            <ul className="flex flex-col divide-y divide-line">
              {[...timeline].sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 5).map((t, i) => (
                <li key={i} className={cx('py-1.5 text-[13px] transition-opacity duration-200', t._pending && 'opacity-60')}>
                  <div className="flex justify-between gap-2 text-[11.5px] text-muted"><span className="font-semibold text-text2">{t.kind}</span><span>{t._pending ? 'Saving…' : `${t.by_name || ''} · ${fmtDateTime(t.at)}`}</span></div>
                  <div className="line-clamp-3 whitespace-pre-wrap">{String(t.body || '')}</div>
                </li>
              ))}
            </ul>
            {timeline.length > 5 && <button type="button" onClick={() => openCard('activity')} className={cx(rowBtn, 'self-start')}>See everything in Activity</button>}
          </div>
        </RailCard>

        <RailCard id="activity" label="Activity" testId="card-activity" {...card} open={card.open('activity')}
          summary={<span className="t num">{timeline.length ? `${timeline.length} event${timeline.length > 1 ? 's' : ''}` : 'Nothing yet'}</span>}>
          <Timeline items={timeline} />
        </RailCard>

        <RailCard id="chat" label="Messages" testId="card-chat" {...card} open={card.open('chat')}
          summary={<span className="t text-muted">{msgReady?.whatsapp && msgReady?.email ? 'WhatsApp and email' : msgReady?.whatsapp ? 'WhatsApp' : msgReady?.email ? 'Email' : 'Team messages'}</span>}>
          <div className="flex min-h-[320px] flex-col [&>[data-testid=chat]]:max-h-none [&>[data-testid=chat]]:flex-1"><ChatThread kind={isLead ? 'lead' : 'candidate'} id={person.id} channel={chatChannel} /></div>
        </RailCard>

        <RailCard id="details" label="Details" testId="card-details" {...card} open={card.open('details')}
          summary={<span className="t text-muted">{isLead ? (p.source?.name || 'Enquiry') : (p.code || 'Profile')}</span>}>
          <div className="flex flex-col gap-3">
            {(contact.mobile || contact.email) && (
              <div className="flex flex-col">
                {contact.mobile && <div className="flex min-h-[32px] items-center justify-between gap-2 text-[13px]"><span className="text-[12.5px] text-muted">Mobile</span><Reveal kind={kind} id={person.id} field="mobile" label="mobile" masked={contact.mobile} /></div>}
                {contact.email && <div className="flex min-h-[32px] items-center justify-between gap-2 text-[13px]"><span className="text-[12.5px] text-muted">Email</span><Reveal kind={kind} id={person.id} field="email" label="email" masked={contact.email} /></div>}
              </div>
            )}
            {isLead ? (
              <DetailGroup flat title="Enquiry" rows={[['City', p.city], ['Source', p.source?.name], ['Preferred mode', p.preferred_mode], ['Currently', p.currently], ['Notes', p.notes]]} />
            ) : (
              <>
                <DetailGroup flat title="Candidate" rows={[['ID', p.code], ['Program', p.program?.name], ['Batch', p.batch?.code], ['Joined', p.joined_on ? fmtDate(p.joined_on) : '']]} />
                <PrivateDetails flat id={person.id} priv={priv} />
                <Link href={'/candidate/' + person.id} className={cx(rowBtn, 'self-start')}><Maximize2 size={14} strokeWidth={1.8} aria-hidden />Open full profile</Link>
                {(s.can('candidate', 'w') || s.can('enrolform', 'w')) && (
                  <Button size="sm" variant="outline" className="self-start" disabled={busy} onClick={async () => {
                    setBusy(true);
                    const res = await fetch('/api/portal/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidate_id: person.id }) });
                    const out = await res.json(); setBusy(false);
                    if (res.ok) setInvite({ email: out.email, password: out.password, url: window.location.origin + '/login', reset: !!out.reset });
                    else setMsg({ tone: 'bad', text: plainMessage(out.error, 'Could not invite.') });
                  }} title="Creates the student's login, or gives them a new temporary password if they already have one">Invite or reset portal login</Button>
                )}
              </>
            )}
          </div>
        </RailCard>
      </div>

      {/* 6. composer, always at the bottom */}
      <div className="max-h-[60%] shrink-0 overflow-y-auto border-t border-line bg-surface px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5" data-testid="composer"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !busy) { e.preventDefault(); save(); } }}>
        {msg && <div className="mb-2"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
        {invite && <InviteCard invite={invite} name={p?.full_name || ''} onClose={() => setInvite(null)} />}

        <div className={cx('flex items-center gap-2', mode && 'mb-2')}>
          <div className="flex flex-1 gap-0.5">
            {([['note', 'Note', 'Add note'], ...(canCall ? [['call', 'Call', 'Log call']] : []), ['task', 'Follow-up', 'Add follow-up']] as ['note' | 'call' | 'task', string, string][]).map(([k, label, aria]) => (
              <button key={k} type="button" aria-label={aria} aria-pressed={mode === k} onClick={() => pick(k)}
                className={cx('btn h-8 rounded-lg px-2.5 text-[13px] font-medium', mode === k ? 'bg-accentSoft font-semibold text-accentText' : 'text-text2 hover:bg-surface2 hover:text-text')}>{label}</button>
            ))}
          </div>
          {mode && <button type="button" aria-label="Close the box" title="Close (keeps nothing)" onClick={() => { setAction(null); setForm({}); }} className={iconBtn}><X size={16} strokeWidth={1.8} /></button>}
          {canCall && <Link href={'/live/' + person.id} aria-label="Live help during a call" title="Live help: tips while you talk (phone on speaker)" className={iconBtn}><Sparkles size={16} strokeWidth={1.8} /></Link>}
          {canRecord && <button type="button" aria-label="Record" title="Record a talk" aria-pressed={mode === 'record'} onClick={() => pick('record')} className={cx(iconBtn, mode === 'record' && 'bg-accentSoft text-accentText')}><Mic size={16} strokeWidth={1.8} /></button>}
        </div>
        {mode === 'record' && <Recorder person={person} onSaved={(t) => { setMsg({ tone: 'good', text: t }); setAction(null); }} />}
        {mode === 'note' && (
          <div className="flex flex-col gap-2 rounded-xl border border-line2 bg-surface2 p-1.5 transition-[border-color,box-shadow] duration-150 focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgb(68_116_185/0.15)] [&_textarea]:border-0 [&_textarea]:bg-transparent [&_textarea]:shadow-none [&_textarea]:outline-none">
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
          <div className="flex flex-col gap-2 rounded-xl border border-line2 bg-surface2 p-1.5">
            <div className="flex flex-wrap gap-1.5">
              {(s.lists.call_outcome || []).map((o) => (
                <button key={o} type="button" aria-pressed={form.outcome === o} onClick={() => setForm({ ...form, outcome: o })} className={cx('btn h-8 rounded-full border px-3 text-xs font-medium transition-colors duration-150', form.outcome === o ? 'border-accent bg-accentSoft text-accentText' : 'border-line2 bg-surface')}>{o}</button>
              ))}
            </div>
            {isLead && CALL_TO_STAGE[form.outcome] === 'Not interested' && p.stage !== 'Not interested' && (
              <label className="flex flex-col gap-1 px-1 text-xs font-medium text-text2">
                <span>Why not interested <span className="text-badText" aria-hidden>*</span></span>
                <select aria-required className="h-11 rounded-lg border border-line2 bg-surface px-2 text-[13px] md:h-9" value={form.lost_reason || ''} onChange={(e) => setForm({ ...form, lost_reason: e.target.value })}>
                  <option value="">Pick a reason</option>
                  {(s.lists.lost_reason || []).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
            )}
            <textarea aria-label="Call notes" placeholder="Notes (optional)" className="min-h-[56px] border-0 bg-transparent px-2 py-1.5 text-sm shadow-none outline-none" value={form.body || ''} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            <div className="flex items-center gap-2">
              <VoiceInput context="call" onText={(t, r) => setForm((f) => ({ ...f, body: appendText(f.body || '', t), outcome: f.outcome || ((s.lists.call_outcome || []).includes(r.outcome || '') ? r.outcome : f.outcome) }))} />
              <input aria-label="Minutes" type="number" min={0} inputMode="numeric" placeholder="Min" className="h-9 w-16 rounded-lg border-transparent bg-surface px-2 text-[13px]" value={form.duration ? Math.round(Number(form.duration) / 60) || '' : ''} onChange={(e) => setForm({ ...form, duration: Number(e.target.value || 0) * 60 })} />
              <Button variant="primary" size="sm" className="ml-auto" disabled={busy} onClick={saveCall}>Save call</Button>
            </div>
          </div>
        )}
        {mode === 'task' && (
          <div className="flex flex-col gap-2 rounded-xl border border-line2 bg-surface2 p-1.5">
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
