'use client';
import Link from 'next/link';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { Button, Notice } from '../ui';
import { PageHeader } from '../ListPage';
import { PhoneInput, phoneProblem } from '../PhoneInput';

const blank = { full_name: '', mobile: '', email: '', city: '', program_id: '', course_other: '', preferred_mode: '', preferred_start: '', currently: '', source_id: '', referred_by: '', notes: '', consent: false };
const ctl = 'h-11 w-full px-3 text-sm';

export function EnquiryForm() {
  const s = useSession();
  const walkIn = s.refs.lead_source.find((x) => /walk-in/i.test(x.label))?.id || '';
  const [v, setV] = useState<Row>({ ...blank, source_id: walkIn });
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string; id?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canWrite = s.can('enquiry', 'w');
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });

  const save = async () => {
    const mobile = String(v.mobile).replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
    const missing = [];
    if (!String(v.full_name).trim()) missing.push('full name');
    if (mobile.length !== 10 || phoneProblem(mobile)) missing.push('a 10-digit mobile starting with 6–9');
    if (!v.program_id && !String(v.course_other).trim()) missing.push('the course they want');
    if (missing.length) { setMsg({ tone: 'bad', text: 'Still needed: ' + missing.join(', ') + '.' }); return; }
    setBusy(true); setMsg(null);
    const db = supabase();
    const dupe = await db.from('lead').select('id,full_name,stage').eq('mobile', mobile).maybeSingle();
    if (dupe.data) { setBusy(false); setMsg({ tone: 'bad', text: `This mobile is already in the CRM as ${dupe.data.full_name} (${dupe.data.stage}). Nothing new was added.`, id: dupe.data.id }); return; }
    const row = {
      full_name: String(v.full_name).trim(), mobile, email: v.email || null, city: v.city || null, program_id: v.program_id && v.program_id !== '__other' ? v.program_id : null,
      course_other: v.program_id === '__other' ? String(v.course_other).trim() : null, preferred_mode: v.preferred_mode || null, preferred_start: v.preferred_start || null,
      currently: v.currently || null, source_id: v.source_id || null, referred_by: v.referred_by || null, notes: v.notes || null, created_by: s.staff.id,
      marketing_consent: !!v.consent, consent_at: v.consent ? new Date().toISOString() : null,
    };
    const { data, error } = await db.from('lead').insert(row).select('id, owner:owner_id(full_name)').single();
    setBusy(false);
    if (error) { setMsg({ tone: 'bad', text: error.code === '23505' ? 'This mobile is already in the CRM.' : error.message }); return; }
    setMsg({ tone: 'good', text: `${row.full_name} saved as a new lead${data?.owner?.full_name ? ' and assigned to ' + data.owner.full_name : ''}.`, id: data?.id });
    setV({ ...blank, source_id: walkIn });
  };

  const Sel = ({ k, label, list }: { k: string; label: string; list: string }) => (
    <label className="flex flex-col gap-1 text-xs font-medium text-text2">{label}
      <select className={ctl} value={v[k]} onChange={set(k)}><option value="">Select</option>{(s.lists[list] || []).map((o) => <option key={o}>{o}</option>)}</select>
    </label>
  );

  return (
    <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
      <PageHeader group="Front desk" title="New enquiry" purpose="Quick form for a walk-in or phone enquiry. Takes about a minute." scope={s.staff.role + (canWrite ? ' · can edit' : ' · view only')} />
      <div className="flex max-w-[860px] flex-col gap-3">
        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-3 text-base font-semibold">Who is enquiring</h2>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
            <label className="flex flex-col gap-1 text-xs font-medium text-text2">Full name *<input className={ctl} value={v.full_name} onChange={set('full_name')} placeholder="As they say it" /></label>
            <div className="flex flex-col gap-1 text-xs font-medium text-text2">Mobile *<PhoneInput label="Mobile" value={v.mobile} onChange={(m) => setV({ ...v, mobile: m })} /></div>
            <label className="flex flex-col gap-1 text-xs font-medium text-text2">Email<input className={ctl} type="email" value={v.email} onChange={set('email')} placeholder="Optional" /></label>
            <label className="flex flex-col gap-1 text-xs font-medium text-text2">City<input className={ctl} value={v.city} onChange={set('city')} /></label>
          </div>
        </section>
        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-3 text-base font-semibold">What they want</h2>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
            <label className="flex flex-col gap-1 text-xs font-medium text-text2">Course interested *
              <select className={ctl} value={v.program_id} onChange={set('program_id')}>
                <option value="">Select</option>{s.refs.program.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}<option value="__other">Other (not offered yet)</option>
              </select>
            </label>
            {v.program_id === '__other' && <label className="flex flex-col gap-1 text-xs font-medium text-text2">Which course?<input className={ctl} value={v.course_other} onChange={set('course_other')} placeholder="Type the course" /></label>}
            <Sel k="preferred_mode" label="Preferred mode" list="preferred_mode" />
            <Sel k="preferred_start" label="Preferred start" list="preferred_start" />
            <Sel k="currently" label="Currently" list="currently" />
          </div>
        </section>
        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-3 text-base font-semibold">How they found us</h2>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
            <label className="flex flex-col gap-1 text-xs font-medium text-text2">Source
              <select className={ctl} value={v.source_id} onChange={set('source_id')}><option value="">Select</option>{s.refs.lead_source.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-text2">Referred by<input className={ctl} value={v.referred_by} onChange={set('referred_by')} placeholder="Name, if any" /></label>
            <label className="flex flex-col gap-1 text-xs font-medium text-text2">Notes<input className={ctl} value={v.notes} onChange={set('notes')} placeholder="Anything they asked about" /></label>
          </div>
          <label className="mt-3 flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[10px] bg-surface2 px-3 text-sm">
            <input type="checkbox" className="h-5 w-5" checked={!!v.consent} onChange={(e) => setV({ ...v, consent: e.target.checked })} />
            <span>They agree to get course updates and offers on WhatsApp, SMS and email <span className="text-muted">(ask them; leave unticked if not)</span></span>
          </label>
        </section>
        {msg && <Notice tone={msg.tone}>{msg.text} {msg.id && s.can('lead') && <Link className="underline" href={'/p/lead?person=lead:' + msg.id}>Open the lead</Link>}</Notice>}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={busy || !canWrite} onClick={save}>{busy ? 'Saving…' : 'Save enquiry'}</Button>
          <span className="text-[13px] text-text2">Saving checks the mobile for duplicates and assigns the lead by the assignment rule.</span>
        </div>
      </div>
    </main>
  );
}
