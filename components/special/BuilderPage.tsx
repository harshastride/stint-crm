'use client';
import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { openBuilder } from './AutomationBuilder';

/** Activepieces inside the CRM. Log in once inside the frame; Activepieces remembers it. */
export function BuilderPage() {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => { supabase().rpc('automation_builder').then(({ data }) => setUrl(data?.url || null)); }, []);

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2">
        <div className="text-[13px] text-text2">
          <span className="font-semibold text-text">Automation builder</span> · In a flow pick <b>Stint CRM</b> for CRM triggers and actions. First time here, sign in to Activepieces inside this page.
        </div>
        {url && <button type="button" onClick={() => openBuilder(url)} className="flex min-h-[40px] items-center gap-1.5 rounded-[10px] border border-line2 bg-surface px-3 text-[13px] font-medium">Open in a new tab <ExternalLink size={13} /></button>}
      </div>
      {url === undefined ? <div className="p-6 text-muted">Loading…</div>
        : url === null ? <div className="p-6 text-text2">No builder address is set. An admin can set it on the Automations page.</div>
        : <iframe title="Activepieces automation builder" src={url} className="min-h-0 w-full flex-1 border-0 bg-white" allow="clipboard-read; clipboard-write" />}
    </main>
  );
}
