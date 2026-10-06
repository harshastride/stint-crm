'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { Button, fmtDateTime } from '../ui';

const EVENT_NAME: Record<string, string> = {
  'lead.created': 'New lead', 'lead.assigned': 'Lead assigned', 'counselling.booked': 'Counselling booked', 'quote.sent': 'Fee quote sent',
  'lead.converted': 'Lead converted', 'payment.recorded': 'Payment recorded', 'attendance.absent': 'Student absent', 'mock.booked': 'Mock booked',
  'mock.result': 'Mock result', 'resume.rejected': 'Resume rejected', 'vendor_request.created': 'Vendor request', 'placement.recorded': 'Placement recorded',
};

/** Opens Activepieces in its own browser tab, reusing that tab if it is already open, so the CRM tab stays put. */
export function openBuilder(url: string) {
  const w = window.open(url, 'stint-automations');
  if (w) w.focus();
  else window.alert('Your browser blocked the new tab. Allow pop-ups for this site, or open ' + url + ' yourself.');
}

/** Top of the Automations page: open Activepieces, and see which CRM events have a live flow. */
export function AutomationBuilder() {
  const s = useSession();
  const [info, setInfo] = useState<{ url: string; listening: { event: string; label: string | null; since: string }[] } | null>(null);
  const [url, setUrl] = useState('');
  const isAdmin = s.staff.role === 'Admin';
  const load = () => supabase().rpc('automation_builder').then(({ data }) => { setInfo(data); setUrl(data?.url || ''); });
  useEffect(() => { load(); }, []);
  if (!info) return null;
  const save = async () => { await supabase().from('integration_config').update({ value: url.trim() || null }).eq('key', 'builder_url'); load(); };

  return (
    <section className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 max-w-3xl">
          <h2 className="text-[14px] font-semibold">Build in Activepieces</h2>
          <p className="text-[13px] text-text2">Pick a <b>Stint CRM</b> trigger (e.g. “New lead”), add actions, publish. Published flows message real people, so test on a demo lead first.</p>
        </div>
        {info.url && (
          <div className="flex flex-wrap gap-1">
            {s.can('builder') && <Link href="/p/builder" className="btn inline-flex h-8 items-center rounded-lg bg-accentSoft px-3 text-[13px] font-semibold text-accentText hover:brightness-95">Open builder</Link>}
            <Button size="sm" variant="quiet" onClick={() => openBuilder(info.url)} rightIcon={<ExternalLink size={14} />}>New tab</Button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
        <span className="font-medium text-muted">Live flows:</span>
        {info.listening.length ? info.listening.map((l, i) => <span key={i} title={'Since ' + fmtDateTime(l.since)} className="rounded-full bg-goodBg px-2.5 py-0.5 text-xs font-semibold text-goodText">{EVENT_NAME[l.event] || l.event}</span>)
          : <span className="text-text2">none yet. A flow with a Stint CRM trigger shows here once it is on.</span>}
      </div>
      {isAdmin && (
        <details className="text-[12.5px]">
          <summary className="flex min-h-[44px] cursor-pointer items-center font-medium text-muted md:min-h-[32px]">Builder address: {info.url || 'not set'}</summary>
          <div className="flex gap-2 pb-1">
            <input aria-label="Builder address" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://automations.stintacademy.com" className="h-10 min-w-0 flex-1 px-3 text-sm" />
            <Button variant="outline" onClick={save}>Save</Button>
          </div>
        </details>
      )}
    </section>
  );
}
