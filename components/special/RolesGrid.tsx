'use client';
import { useCallback, useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { Button, ButtonGroup, Notice, cx } from '../ui';
import { PageHeader } from '../kit/PageHeader';
import { Table, THead, TBody, Th, Td, Tr } from '../kit/Table';

const GROUPS: [string, string][] = [['contact', 'Contact and address'], ['family', 'Family'], ['identity', 'Identity (PAN, Aadhaar, passport)'], ['bank', 'Bank']];
const PAGE_NEXT: Record<string, string | null> = { '': 'r', r: 'w', w: null };
const FIELD_NEXT: Record<string, string> = { h: 'm', m: 'f', f: 'h' };
const PAGE_LABEL: Record<string, string> = { '': '—', r: 'View', w: 'Edit' };
const FIELD_LABEL: Record<string, string> = { h: 'Hidden', m: 'Masked', f: 'Full' };
type RoleRules = { owns: string[]; picks_up: string[]; sees_candidate_stages: string[]; sees_lead_stages: string[]; contact_lead_stages: string[] | null; contact_candidate_stages: string[] | null };
const tone = (level: number) => (level === 2 ? 'bg-accent text-white' : level === 1 ? 'bg-accentSoft text-accentText' : 'bg-transparent text-muted hover:bg-surface2');

export function RolesGrid() {
  const s = useSession();
  const canWrite = s.can('roles', 'w');
  const [tab, setTab] = useState<'Pages' | 'Sensitive details' | 'Records'>('Pages');
  const [rules, setRules] = useState<Record<string, RoleRules>>({});
  const [pageAccess, setPageAccess] = useState<Record<string, string>>({});
  const [fieldAccess, setFieldAccess] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const roles = s.roles.filter((r) => r !== 'Admin');

  const load = useCallback(async () => {
    const db = supabase();
    const [a, f, r] = await Promise.all([db.from('role_page_access').select('*'), db.from('role_field_access').select('*'), db.from('app_role').select('name, owns, picks_up, sees_candidate_stages, sees_lead_stages, contact_lead_stages, contact_candidate_stages')]);
    setRules(Object.fromEntries((r.data || []).map((x: Row) => [x.name, x as RoleRules])));
    setPageAccess(Object.fromEntries((a.data || []).map((r: Row) => [r.role + '|' + r.page_id, r.mode])));
    setFieldAccess(Object.fromEntries((f.data || []).map((r: Row) => [r.role + '|' + r.field_group, r.mode])));
  }, []);
  useEffect(() => { load(); }, [load]);

  const [pendingRemove, setPendingRemove] = useState<{ role: string; page: string; title: string } | null>(null);
  const [focusRole, setFocusRole] = useState('');
  const [recRole, setRecRole] = useState('');
  const tapPage = async (role: string, page: string, title: string, confirmed = false) => {
    if (!canWrite) return;
    const key = role + '|' + page, next = PAGE_NEXT[pageAccess[key] || ''];
    if (!next && !confirmed) { setPendingRemove({ role, page, title }); return; }
    setPendingRemove(null);
    const db = supabase();
    const { error } = next ? await db.from('role_page_access').upsert({ role, page_id: page, mode: next }) : await db.from('role_page_access').delete().eq('role', role).eq('page_id', page);
    if (error) { setMsg({ tone: 'bad', text: error.message }); return; }
    setPageAccess((m) => { const n = { ...m }; if (next) n[key] = next; else delete n[key]; return n; });
    setMsg({ tone: 'good', text: `${role} · ${title}: ${next ? PAGE_LABEL[next] : 'no access'}. It applies the next time they open the app.` });
  };
  const tapField = async (role: string, g: string, label: string) => {
    if (!canWrite) return;
    const key = role + '|' + g, next = FIELD_NEXT[fieldAccess[key] || 'h'];
    const { error } = await supabase().from('role_field_access').upsert({ role, field_group: g, mode: next });
    if (error) { setMsg({ tone: 'bad', text: error.message }); return; }
    setFieldAccess((m) => ({ ...m, [key]: next }));
    setMsg({ tone: 'good', text: `${role} · ${label}: ${FIELD_LABEL[next]}.` });
  };

  const saveRule = async (role: string, key: keyof RoleRules, value: string[] | null, text: string) => {
    if (!canWrite) return;
    const { error } = await supabase().from('app_role').update({ [key]: value }).eq('name', role);
    if (error) { setMsg({ tone: 'bad', text: error.message }); return; }
    setRules((m) => ({ ...m, [role]: { ...m[role], [key]: value } }));
    setMsg({ tone: 'good', text: role + ': ' + text + '. It applies straight away.' });
  };
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const leadStages = s.lists.lead_stage || [], candStages = s.lists.candidate_stage || [];
  const chip = (on: boolean) => cx('btn relative min-h-[32px] rounded-lg px-2.5 text-[12.5px] transition-colors duration-150 disabled:cursor-default', on ? 'bg-accentSoft font-semibold text-accentText' : 'bg-surface2 font-medium text-text2 hover:text-text');
  const StageChips = ({ role, k, all, what }: { role: string; k: 'sees_candidate_stages' | 'sees_lead_stages' | 'picks_up' | 'contact_lead_stages' | 'contact_candidate_stages'; all: string[]; what: string }) => {
    const cur = rules[role]?.[k] || [];
    const isPick = k === 'picks_up';
    const isContact = k === 'contact_lead_stages' || k === 'contact_candidate_stages';
    if (isContact) return (
      <div className="flex flex-wrap gap-1">
        <button type="button" disabled={!canWrite} aria-pressed={cur.length === 0} onClick={() => saveRule(role, k, null, 'can see ' + what + ' contact details in any stage')} className={chip(cur.length === 0)}>{cur.length === 0 && <Check size={12} aria-hidden className="mr-1 inline" />}Any stage</button>
        {all.map((st) => (
          <button key={st} type="button" disabled={!canWrite} aria-pressed={cur.includes(st)}
            onClick={() => { const next = toggle(cur, st); saveRule(role, k, next.length ? next : null, next.length ? 'can see ' + what + ' contact details only in ' + next.join(', ') : 'can see ' + what + ' contact details in any stage'); }}
            className={chip(cur.includes(st))}>{cur.includes(st) && <Check size={12} aria-hidden className="mr-1 inline" />}{st}</button>
        ))}
      </div>
    );
    return (
      <div className="flex flex-wrap gap-1">
        {!isPick && <button type="button" disabled={!canWrite} onClick={() => saveRule(role, k, [], 'sees ' + what + ' in every stage')} className={chip(cur.length === 0)}>{cur.length === 0 && <Check size={12} aria-hidden className="mr-1 inline" />}All</button>}
        {all.map((st) => (
          <button key={st} type="button" disabled={!canWrite} aria-pressed={cur.includes(st)}
            onClick={() => { const next = toggle(cur, st); saveRule(role, k, next, isPick ? (next.length ? 'picks up leads at ' + next.join(', ') : 'picks up no leads') : next.length ? 'sees ' + what + ' only in ' + next.join(', ') : 'sees ' + what + ' in every stage'); }}
            className={chip(cur.includes(st))}>{cur.includes(st) && <Check size={12} aria-hidden className="mr-1 inline" />}{st}</button>
        ))}
        {isPick && cur.length === 0 && <span className="self-center text-xs text-muted">(none picked)</span>}
      </div>
    );
  };

  const groups: { name: string; pages: { id: string; title: string }[] }[] = [];
  s.allPages.forEach((p) => { let g = groups.find((x) => x.name === p.grp); if (!g) groups.push((g = { name: p.grp, pages: [] })); g.pages.push(p); });
  const th = '!text-center whitespace-nowrap';
  const btn = 'btn relative h-8 w-full min-w-[64px] rounded-lg text-[12.5px] font-semibold transition-colors duration-150 disabled:cursor-default';

  return (
    <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-page-sm md:px-page md:py-4">
      <PageHeader title="Roles & permissions" description="What each role can open and change. Taking access away really blocks it, not just hides it."
        scope={canWrite ? 'Can edit' : 'View only'}
        filters={<ButtonGroup label="Permission type">{(['Pages', 'Sensitive details', 'Records'] as const).map((t) => <Button key={t} size="sm" variant="quiet" active={tab === t} onClick={() => setTab(t)}>{t}</Button>)}</ButtonGroup>} />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {pendingRemove && (
        <div role="alertdialog" aria-label="Confirm removing access" data-testid="roles-confirm" className="flex flex-wrap items-center gap-3 rounded-[14px] bg-warnBg p-4 text-[13.5px] text-warnText">
          <span className="min-w-0 flex-1">Remove <b>{pendingRemove.title}</b> from <b>{pendingRemove.role}</b>? Everyone with this role loses the page the next time they open the app, and anything they do there stops working.</span>
          <Button variant="outline" onClick={() => setPendingRemove(null)}>Cancel</Button>
          <Button variant="primary" onClick={() => tapPage(pendingRemove.role, pendingRemove.page, pendingRemove.title, true)}>Remove access</Button>
        </div>
      )}
      {tab === 'Pages' && (
        <section className="border-t border-line pt-3" aria-label="What a role can do" data-testid="role-summary">
          <label className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">In plain words, what can
            <select aria-label="Role to summarise" className="h-11 rounded-[10px] border border-line2 bg-surface px-3 text-sm" value={focusRole} onChange={(e) => setFocusRole(e.target.value)}>
              <option value="">pick a role</option>{roles.map((r) => <option key={r} value={r}>{r}</option>)}
            </select> do?</label>
          {focusRole && (() => {
            const by = (m: string) => s.allPages.filter((p) => (pageAccess[focusRole + '|' + p.id] || '') === m).map((p) => p.title);
            const sens = GROUPS.map(([g, l]) => `${l}: ${FIELD_LABEL[fieldAccess[focusRole + '|' + g] || 'h'].toLowerCase()}`);
            const line = (head: string, items: string[], tone: string) => (
              <div className="grid gap-1 sm:grid-cols-[160px_1fr]"><div className={cx('text-[12.5px] font-semibold', tone)}>{head} ({items.length})</div><div className="text-[13px] text-text2">{items.length ? items.join(', ') : 'Nothing'}</div></div>
            );
            return (
              <div className="mt-3 flex flex-col gap-2">
                {line('Can change', by('w'), 'text-goodText')}
                {line('Can only look at', by('r'), 'text-accentText')}
                {line('Cannot open', by(''), 'text-badText')}
                {line('Sensitive details', sens, 'text-text')}
              </div>
            );
          })()}
        </section>
      )}
      {tab === 'Records' ? (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-0">
          <nav aria-label="Roles" className="flex gap-1 overflow-x-auto border-line lg:flex-col lg:gap-0.5 lg:overflow-visible lg:border-r lg:pr-3">
            {roles.map((r) => { const on = (recRole || roles[0]) === r; return (
              <button key={r} type="button" aria-pressed={on} onClick={() => setRecRole(r)} className={cx('min-h-[44px] shrink-0 rounded-lg px-2.5 text-left text-[13.5px] transition-colors duration-150', on ? 'bg-accentSoft font-semibold text-accentText' : 'font-medium hover:bg-surface2')}>{r}</button>
            ); })}
          </nav>
          <div className="flex min-w-0 flex-col gap-3 lg:pl-5">
          {roles.filter((r) => (recRole || roles[0]) === r).map((r) => (
            <section key={r}>
              <h2 className="text-[15px] font-semibold">{r}</h2>
              <div className="mt-3 grid gap-x-6 gap-y-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                <div><div className="mb-1 text-xs font-medium text-text2">Sees students in these stages</div><StageChips role={r} k="sees_candidate_stages" all={candStages} what="students" /></div>
                <div><div className="mb-1 text-xs font-medium text-text2">Sees leads in these stages</div><StageChips role={r} k="sees_lead_stages" all={leadStages} what="leads" /></div>
                <div>
                  <div className="mb-1 text-xs font-medium text-text2">A Junior sees only their own</div>
                  <div className="flex flex-wrap gap-3 text-[13px]">
                    {[['lead', 'Leads'], ['candidate', 'Students']].map(([k, l]) => { const on = (rules[r]?.owns || []).includes(k); return (
                      <label key={k} className="flex min-h-[32px] items-center gap-2"><input type="checkbox" className="h-4 w-4" disabled={!canWrite} checked={on}
                        onChange={() => saveRule(r, 'owns', toggle(rules[r]?.owns || [], k), on ? `juniors see all ${l.toLowerCase()}` : `juniors see only their own ${l.toLowerCase()}, heads see the team`)} />{l}</label>
                    ); })}
                  </div>
                </div>
                <div><div className="mb-1 text-xs font-medium text-text2">Picks up other teams’ leads at</div><StageChips role={r} k="picks_up" all={leadStages} what="leads" /></div>
                <div><div className="mb-1 text-xs font-medium text-text2">Can see contact details while the lead is in</div><StageChips role={r} k="contact_lead_stages" all={leadStages} what="lead" /></div>
                <div><div className="mb-1 text-xs font-medium text-text2">Can see contact details while the student is in</div><StageChips role={r} k="contact_candidate_stages" all={candStages} what="student" /></div>
              </div>
            </section>
          ))}
          <p className="text-xs text-muted">“All” and “Any stage” mean no limit. Every time someone shows a phone, email or address it is logged. Juniors and Heads are set per person under Users &amp; staff. Page access still applies: a role needs the page to see the records at all. Admin always sees everything.</p>
          </div>
        </div>
      ) : (<>
      <Table label={tab === 'Pages' ? 'Page access by role' : 'Sensitive details by role'} density="compact">
          <THead>
              <Th className="sticky left-0 z-[2] bg-surface">{tab === 'Pages' ? 'Page' : 'Detail group'}</Th>
              <Th className={th}>Admin</Th>
              {roles.map((r) => <Th key={r} className={th} title={r}>{r}</Th>)}
          </THead>
          <TBody>
            {tab === 'Pages' ? groups.map((g) => [
              <tr key={g.name}><td colSpan={roles.length + 2} className="!h-auto bg-surface2/60 !pt-4 !pb-1.5 text-xs font-medium text-muted">{g.name}</td></tr>,
              ...g.pages.map((p) => (
                <Tr key={p.id}>
                  <Td className="sticky left-0 z-[1] whitespace-nowrap bg-surface font-medium">{p.title}</Td>
                  <td className="!px-1"><div className={cx(btn, tone(2), 'flex items-center justify-center opacity-60')}>Edit</div></td>
                  {roles.map((r) => { const m = pageAccess[r + '|' + p.id] || ''; return (
                    <td key={r} className="!px-1"><button type="button" disabled={!canWrite} aria-label={`${r}, ${p.title}: ${PAGE_LABEL[m]}`} onClick={() => tapPage(r, p.id, p.title)} className={cx(btn, tone(m === 'w' ? 2 : m === 'r' ? 1 : 0))}>{PAGE_LABEL[m]}</button></td>
                  ); })}
                </Tr>
              )),
            ]) : GROUPS.map(([g, label]) => (
              <Tr key={g}>
                <Td className="sticky left-0 z-[1] whitespace-nowrap bg-surface font-medium">{label}</Td>
                <td className="!px-1"><div className={cx(btn, tone(2), 'flex items-center justify-center opacity-60')}>Full</div></td>
                {roles.map((r) => { const m = fieldAccess[r + '|' + g] || 'h'; return (
                  <td key={r} className="!px-1"><button type="button" disabled={!canWrite} aria-label={`${r}, ${label}: ${FIELD_LABEL[m]}`} onClick={() => tapField(r, g, label)} className={cx(btn, tone(m === 'f' ? 2 : m === 'm' ? 1 : 0))}>{FIELD_LABEL[m]}</button></td>
                ); })}
              </Tr>
            ))}
          </TBody>
      </Table>
      <p className="text-xs text-muted">{tab === 'Pages' ? 'Tap steps through no access → View → Edit. The database enforces this, not just the screen.' : 'Masked shows only the last 4 characters. Hidden shows nothing.'} Admin always has everything.</p>
      </>)}
    </main>
  );
}
