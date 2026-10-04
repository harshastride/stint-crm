'use client';
import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { fmtDateTime } from '../ui';

const EVENT_NAME: Record<string, string> = {
  'lead.created': 'New lead', 'lead.assigned': 'Lead assigned', 'counselling.booked': 'Counselling booked', 'quote.sent': 'Fee quote sent',
  'lead.converted': 'Lead converted', 'payment.recorded': 'Payment recorded', 'attendance.absent': 'Student absent', 'mock.booked': 'Mock booked',
  'mock.result': 'Mock result', 'resume.rejected': 'Resume rejected', 'vendor_request.created': 'Vendor request', 'placement.recorded': 'Placement recorded',
};

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
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Build automations in Activepieces</h2>
          <p className="mt-1 text-[13px] text-text2">In a flow pick <b>Stint CRM</b>: a trigger such as “New lead” or “Payment recorded”, then actions like WhatsApp, email, or “Create follow-up” back in the CRM. Publish and it runs.</p>
        </div>
        {info.url && (
          <a href={info.url} target="_blank" rel="noreferrer" className="flex min-h-[44px] items-center gap-2 rounded-[10px] bg-accent px-4 text-sm font-semibold text-white">
            Open automation builder <ExternalLink size={14} />
          </a>
        )}
      </div>
      <div className="mt-3 text-xs font-medium text-text2">Live flows listening to the CRM</div>
      {info.listening.length ? (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {info.listening.map((l, i) => <li key={i} title={'Since ' + fmtDateTime(l.since)} className="rounded-full bg-goodBg px-2.5 py-1 text-xs font-semibold text-goodText">{EVENT_NAME[l.event] || l.event}</li>)}
        </ul>
      ) : <p className="mt-1 text-[13px] text-muted">None yet. Turn on a flow with a Stint CRM trigger and it shows here.</p>}
      {isAdmin && (
        <label className="mt-3 flex flex-col gap-1 text-xs font-medium text-text2">Builder address (admin)
          <div className="flex gap-2">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://automations.stintacademy.com" className="h-11 min-w-0 flex-1 px-3 text-sm" />
            <button type="button" onClick={save} className="h-11 rounded-[10px] border border-line2 bg-surface px-3 text-sm font-medium">Save</button>
          </div>
        </label>
      )}
    </section>
  );
}
