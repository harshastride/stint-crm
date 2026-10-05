'use client';
import { useCallback, useEffect, useState } from 'react';
import { Eye, Pencil } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { PageHeader } from '../kit/PageHeader';
import { Table, THead, TBody, Th, Td, Tr } from '../kit/Table';
import { Button, Notice, cx, fmtDateTime } from '../ui';
import { friendlyError } from '../Fields';

const WHEN: Record<string, string> = {
  fee_due: 'Fee due', follow_up_due: 'Follow-up due', class_tomorrow: 'Class coming up', mock_tomorrow: 'Mock interview coming up',
  document_missing: 'Documents missing after joining', lead_no_contact: 'New lead not called',
};
const OFFSET_LABEL: Record<string, string> = {
  fee_due: 'days before due date', follow_up_due: 'days before due', class_tomorrow: 'days before class', mock_tomorrow: 'days before mock',
  document_missing: 'days after joining', lead_no_contact: 'days after lead added',
};
const TIMES = Array.from({ length: 27 }, (_, i) => { const m = 8 * 60 + i * 30; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); });
const sel = 'h-11 rounded-[10px] border border-line bg-surface px-3 text-[14px]';

/** Admin: automatic reminders. Rules queue messages; the message sender delivers them. */
export function Reminders() {
  const s = useSession();
  const canEdit = s.can('reminders', 'w');
  const [rules, setRules] = useState<Row[] | null>(null);
  const [log, setLog] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [preview, setPreview] = useState<{ rule: Row; rows: Row[] } | null>(null);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const db = supabase();
    const [r, l] = await Promise.all([
      db.from('reminder_rule').select('*').order('name'),
      db.from('reminder_log').select('id,person_name,day,created_at,rule:reminder_rule(name,channel)').order('created_at', { ascending: false }).limit(50),
    ]);
    if (r.error) setMsg({ tone: 'bad', text: friendlyError(r.error) });
    setRules(r.data || []); setLog(l.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const [turnOn, setTurnOn] = useState<{ rule: Row; count: number } | null>(null);
  const toggle = async (r: Row, confirmed = false) => {
    if (!r.active && !confirmed) {
      // Turning on sends real messages: show who would get it first.
      const { data, error } = await supabase().rpc('preview_reminders', { p_rule: r.id });
      if (error) { setMsg({ tone: 'bad', text: friendlyError(error) }); return; }
      setTurnOn({ rule: r, count: (data || []).filter((x: Row) => !x.opted_out && !x.already_sent).length });
      return;
    }
    setTurnOn(null);
    const { error } = await supabase().from('reminder_rule').update({ active: !r.active }).eq('id', r.id);
    if (error) setMsg({ tone: 'bad', text: friendlyError(error) }); else { setMsg({ tone: 'good', text: `“${r.name}” is ${r.active ? 'off. Nothing more will be sent' : 'on'}.` }); load(); }
  };
  const who = (r: Row) => (r.audience === 'student' ? 'students' : 'staff');
  const save = async () => {
    if (!edit) return;
    setBusy(true);
    const { error } = await supabase().from('reminder_rule').update({
      offset_days: Number(edit.offset_days), send_time: edit.send_time, channel: edit.channel, template_name: edit.template_name || null, body_template: edit.body_template,
    }).eq('id', edit.id);
    setBusy(false);
    if (error) { setMsg({ tone: 'bad', text: friendlyError(error) }); return; }
    setEdit(null); setMsg({ tone: 'good', text: 'Saved.' }); load();
  };
  const runPreview = async (rule: Row) => {
    const { data, error } = await supabase().rpc('preview_reminders', { p_rule: rule.id });
    if (error) { setMsg({ tone: 'bad', text: friendlyError(error) }); return; }
    setPreview({ rule, rows: data || [] });
  };

  return (
    <main className="flex flex-1 flex-col gap-6 overflow-y-auto p-4 md:p-6">
      <PageHeader title="Reminders" description={'Controls the automatic WhatsApp and email reminders. Turning one on messages real students or staff every day at its time. Nothing is sent between 9pm and 8am, and nobody gets the same reminder twice in a day.' + (canEdit ? '' : ' View only.')} />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {turnOn && (
        <div role="alertdialog" aria-label="Confirm turning on" data-testid="reminder-confirm" className="flex flex-wrap items-center gap-3 rounded-[14px] bg-warnBg p-4 text-[13.5px] text-warnText">
          <span className="min-w-0 flex-1">Turn on <b>{turnOn.rule.name}</b>? Based on today’s data this will message <b>{turnOn.count} {who(turnOn.rule)}</b> by {turnOn.rule.channel === 'whatsapp' ? 'WhatsApp' : 'email'} at {String(turnOn.rule.send_time).slice(0, 5)}{turnOn.count === 0 ? ' (nobody matches today; it starts as soon as someone does)' : ''}, and keeps doing so every day until you turn it off.</span>
          <Button variant="outline" onClick={() => setTurnOn(null)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => toggle(turnOn.rule, true)}>Turn on</Button>
        </div>
      )}

      <section className="rounded-[14px] bg-surface shadow-[var(--shadow-1)]" data-testid="reminder-rules">
        {rules === null ? <div className="p-6 text-muted">Loading…</div> : (
          <Table label="Reminder rules">
            <THead><Th>On</Th><Th>Reminder</Th><Th>When</Th><Th>Send at</Th><Th>Channel</Th><Th>To</Th><Th /></THead>
            <TBody>
              {rules.map((r) => (
                <Tr key={r.id} data-rule={r.name}>
                  <Td>
                    <button type="button" role="switch" aria-checked={!!r.active} aria-label={`${r.name} on or off`} disabled={!canEdit} onClick={() => toggle(r)}
                      className="flex h-11 w-14 items-center disabled:opacity-50">
                      <span className={cx('relative h-6 w-11 rounded-full transition-colors duration-150', r.active ? 'bg-accent' : 'bg-line')}>
                        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-150', r.active ? 'translate-x-[22px]' : 'translate-x-0.5')} />
                      </span>
                    </button>
                  </Td>
                  <Td><div className="font-semibold">{r.name}</div><div className="text-[12.5px] text-text2">{WHEN[r.trigger]}</div></Td>
                  <Td>{r.offset_days} {OFFSET_LABEL[r.trigger]}</Td>
                  <Td>{String(r.send_time).slice(0, 5)}</Td>
                  <Td className="capitalize">{r.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}</Td>
                  <Td>{r.audience === 'student' ? 'Student' : 'Staff owner'}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" leftIcon={<Eye size={15} />} onClick={() => runPreview(r)}>Preview today</Button>
                      {canEdit && <Button size="sm" variant="ghost" leftIcon={<Pencil size={15} />} onClick={() => setEdit({ ...r, send_time: String(r.send_time).slice(0, 5) })}>Edit</Button>}
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      {edit && (
        <section className="flex flex-col gap-3 rounded-[14px] bg-surface p-4 shadow-[var(--shadow-1)]" aria-label="Edit reminder">
          <h2 className="text-[15px] font-semibold">Edit: {edit.name}</h2>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-[13px]">{OFFSET_LABEL[edit.trigger]}
              <select className={sel} value={edit.offset_days} onChange={(e) => setEdit({ ...edit, offset_days: e.target.value })}>
                {Array.from({ length: 15 }, (_, i) => <option key={i} value={i}>{i}</option>)}
              </select></label>
            <label className="flex flex-col gap-1 text-[13px]">Send at (India time)
              <select className={sel} value={edit.send_time} onChange={(e) => setEdit({ ...edit, send_time: e.target.value })}>
                {TIMES.includes(edit.send_time) ? null : <option value={edit.send_time}>{edit.send_time}</option>}
                {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select></label>
            <label className="flex flex-col gap-1 text-[13px]">Channel
              <select className={sel} value={edit.channel} onChange={(e) => setEdit({ ...edit, channel: e.target.value })}>
                <option value="whatsapp">WhatsApp</option><option value="email">Email</option>
              </select></label>
            <label className="flex flex-col gap-1 text-[13px]">WhatsApp template name (optional)
              <input className={sel} value={edit.template_name || ''} onChange={(e) => setEdit({ ...edit, template_name: e.target.value })} /></label>
          </div>
          <label className="flex flex-col gap-1 text-[13px]">Message
            <textarea className="min-h-[88px] rounded-[10px] border border-line bg-surface p-3 text-[14px]" value={edit.body_template} onChange={(e) => setEdit({ ...edit, body_template: e.target.value })} /></label>
          <p className="text-[12.5px] text-text2">You can use {'{{first_name}}'}, {'{{name}}'}, {'{{amount}}'}, {'{{due_date}}'}, {'{{time}}'}.</p>
          <div className="flex gap-2"><Button variant="primary" loading={busy} onClick={save}>Save</Button><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button></div>
        </section>
      )}

      {preview && (
        <section className="rounded-[14px] bg-surface p-4 shadow-[var(--shadow-1)]" data-testid="reminder-preview">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="flex-1 text-[15px] font-semibold">Who would get “{preview.rule.name}” today ({preview.rows.length}) — nothing is sent</h2>
            <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>Close</Button>
          </div>
          {preview.rows.length === 0 ? <p className="text-text2">Nobody matches today.</p> : (
            <ul className="flex flex-col gap-2">
              {preview.rows.map((p, i) => (
                <li key={i} className="rounded-[10px] bg-surface2 p-3 text-[13.5px]">
                  <div className="font-semibold">{p.person_name}{p.opted_out && <span className="ml-2 text-[12px] font-normal text-text2">(opted out, skipped)</span>}{p.already_sent && <span className="ml-2 text-[12px] font-normal text-text2">(already sent today)</span>}</div>
                  <div className="text-text2">{p.body}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="rounded-[14px] bg-surface shadow-[var(--shadow-1)]" data-testid="reminder-log">
        <h2 className="p-4 pb-2 text-[15px] font-semibold">Recent sends</h2>
        {log.length === 0 ? <p className="p-4 pt-0 text-text2">No reminders sent yet.</p> : (
          <Table label="Recent reminder sends">
            <THead><Th>When</Th><Th>Reminder</Th><Th>To</Th></THead>
            <TBody>{log.map((l) => <Tr key={l.id}><Td>{fmtDateTime(l.created_at)}</Td><Td>{l.rule?.name}</Td><Td>{l.person_name}</Td></Tr>)}</TBody>
          </Table>
        )}
      </section>
    </main>
  );
}
