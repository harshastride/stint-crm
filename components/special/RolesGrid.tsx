'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { Notice, cx } from '../ui';
import { PageHeader } from '../ListPage';

const GROUPS: [string, string][] = [['contact', 'Contact and address'], ['family', 'Family'], ['identity', 'Identity (PAN, Aadhaar, passport)'], ['bank', 'Bank']];
const PAGE_NEXT: Record<string, string | null> = { '': 'r', r: 'w', w: null };
const FIELD_NEXT: Record<string, string> = { h: 'm', m: 'f', f: 'h' };
const PAGE_LABEL: Record<string, string> = { '': '—', r: 'View', w: 'Edit' };
const FIELD_LABEL: Record<string, string> = { h: 'Hidden', m: 'Masked', f: 'Full' };
type RoleRules = { owns: string[]; picks_up: string[]; sees_candidate_stages: string[]; sees_lead_stages: string[] };
const tone = (level: number) => (level === 2 ? 'bg-accent text-white border-accent' : level === 1 ? 'bg-accentSoft text-accentText border-accent' : 'bg-surface text-muted border-line2');

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
    const [a, f, r] = await Promise.all([db.from('role_page_access').select('*'), db.from('role_field_access').select('*'), db.from('app_role').select('name, owns, picks_up, sees_candidate_stages, sees_lead_stages')]);
    setRules(Object.fromEntries((r.data || []).map((x: Row) => [x.name, x as RoleRules])));
    setPageAccess(Object.fromEntries((a.data || []).map((r: Row) => [r.role + '|' + r.page_id, r.mode])));
    setFieldAccess(Object.fromEntries((f.data || []).map((r: Row) => [r.role + '|' + r.field_group, r.mode])));
  }, []);
  useEffect(() => { load(); }, [load]);

  const tapPage = async (role: string, page: string, title: string) => {
    if (!canWrite) return;
    const key = role + '|' + page, next = PAGE_NEXT[pageAccess[key] || ''];
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

  const saveRule = async (role: string, key: keyof RoleRules, value: string[], text: string) => {
    if (!canWrite) return;
    const { error } = await supabase().from('app_role').update({ [key]: value }).eq('name', role);
    if (error) { setMsg({ tone: 'bad', text: error.message }); return; }
    setRules((m) => ({ ...m, [role]: { ...m[role], [key]: value } }));
    setMsg({ tone: 'good', text: role + ': ' + text + '. It applies straight away.' });
  };
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const leadStages = s.lists.lead_stage || [], candStages = s.lists.candidate_stage || [];
  const chip = (on: boolean) => cx('min-h-[30px] rounded-full border px-2.5 text-xs font-semibold', on ? 'border-accent bg-accentSoft text-accentText' : 'border-line2 bg-surface text-muted');
  const StageChips = ({ role, k, all, what }: { role: string; k: 'sees_candidate_stages' | 'sees_lead_stages' | 'picks_up'; all: string[]; what: string }) => {
    const cur = rules[role]?.[k] || [];
    const isPick = k === 'picks_up';
    return (
      <div className="flex flex-wrap gap-1">
        {!isPick && <button type="button" disabled={!canWrite} onClick={() => saveRule(role, k, [], 'sees ' + what + ' in every stage')} className={chip(cur.length === 0)}>All</button>}
        {all.map((st) => (
          <button key={st} type="button" disabled={!canWrite} aria-pressed={cur.includes(st)}
            onClick={() => { const next = toggle(cur, st); saveRule(role, k, next, isPick ? (next.length ? 'picks up leads at ' + next.join(', ') : 'picks up no leads') : next.length ? 'sees ' + what + ' only in ' + next.join(', ') : 'sees ' + what + ' in every stage'); }}
            className={chip(cur.includes(st))}>{st}</button>
        ))}
        {isPick && cur.length === 0 && <span className="self-center text-xs text-muted">None</span>}
      </div>
    );
  };

  const groups: { name: string; pages: { id: string; title: string }[] }[] = [];
  s.allPages.forEach((p) => { let g = groups.find((x) => x.name === p.grp); if (!g) groups.push((g = { name: p.grp, pages: [] })); g.pages.push(p); });
  const th = 'whitespace-nowrap px-2 py-2.5 text-center text-xs font-semibold text-text2';
  const btn = 'min-h-[32px] w-full min-w-[64px] rounded-lg border text-xs font-semibold';

  return (
    <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
      <PageHeader group="Admin settings" title="Roles & permissions" purpose="Which pages each role can open, which sensitive details it can see, and which records. Tap to change." scope={s.staff.role + (canWrite ? ' · can edit' : ' · view only')} />
      <div className="flex gap-1 border-b border-line pb-2">
        {(['Pages', 'Sensitive details', 'Records'] as const).map((t) => <button key={t} type="button" onClick={() => setTab(t)} className={cx('min-h-[38px] rounded-[10px] px-3.5 text-[13px] font-medium', tab === t ? 'bg-ink text-white' : 'text-text2')}>{t}</button>)}
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {tab === 'Records' ? (
        <div className="flex flex-col gap-3">
          {roles.map((r) => (
            <section key={r} className="rounded-xl border border-line bg-surface p-4">
              <h2 className="text-[15px] font-semibold">{r}</h2>
              <div className="mt-2 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
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
              </div>
            </section>
          ))}
          <p className="text-xs text-muted">“All” means no limit. Juniors and Heads are set per person under Users &amp; staff. Page access still applies: a role needs the page to see the records at all. Admin always sees everything.</p>
        </div>
      ) : (<>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-surface2">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text2">{tab === 'Pages' ? 'Page' : 'Detail group'}</th>
              <th className={th}>Admin</th>
              {roles.map((r) => <th key={r} className={th}>{r}</th>)}
            </tr>
          </thead>
          <tbody>
            {tab === 'Pages' ? groups.map((g) => [
              <tr key={g.name}><td colSpan={roles.length + 2} className="bg-surface2/60 px-4 py-1.5 text-xs font-semibold text-text2">{g.name}</td></tr>,
              ...g.pages.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="whitespace-nowrap px-4 py-1.5 font-medium">{p.title}</td>
                  <td className="px-1 py-1"><div className={cx(btn, tone(2), 'flex items-center justify-center opacity-60')}>Edit</div></td>
                  {roles.map((r) => { const m = pageAccess[r + '|' + p.id] || ''; return (
                    <td key={r} className="px-1 py-1"><button type="button" disabled={!canWrite} aria-label={`${r}, ${p.title}: ${PAGE_LABEL[m]}`} onClick={() => tapPage(r, p.id, p.title)} className={cx(btn, tone(m === 'w' ? 2 : m === 'r' ? 1 : 0))}>{PAGE_LABEL[m]}</button></td>
                  ); })}
                </tr>
              )),
            ]) : GROUPS.map(([g, label]) => (
              <tr key={g} className="border-t border-line">
                <td className="whitespace-nowrap px-4 py-2 font-medium">{label}</td>
                <td className="px-1 py-1"><div className={cx(btn, tone(2), 'flex items-center justify-center opacity-60')}>Full</div></td>
                {roles.map((r) => { const m = fieldAccess[r + '|' + g] || 'h'; return (
                  <td key={r} className="px-1 py-1"><button type="button" disabled={!canWrite} aria-label={`${r}, ${label}: ${FIELD_LABEL[m]}`} onClick={() => tapField(r, g, label)} className={cx(btn, tone(m === 'f' ? 2 : m === 'm' ? 1 : 0))}>{FIELD_LABEL[m]}</button></td>
                ); })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">{tab === 'Pages' ? 'Tap steps through no access → View → Edit. The database enforces this, not just the screen.' : 'Masked shows only the last 4 characters. Hidden shows nothing.'} Admin always has everything.</p>
      </>)}
    </main>
  );
}
