'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { Button, Notice } from '../ui';

/** Admin-only card on the Automation log: where events go, the signing secret, and the key for incoming leads. */
export function ActivepiecesSetup() {
  const s = useSession();
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [url, setUrl] = useState('');
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  const load = async () => {
    const { data } = await supabase().from('integration_config').select('key, value');
    const m = Object.fromEntries((data || []).map((r: { key: string; value: string | null }) => [r.key, r.value || '']));
    setCfg(m); setUrl(m.activepieces_webhook_url || '');
  };
  useEffect(() => { if (s.staff.role === 'Admin') load(); }, [s.staff.role]);
  if (s.staff.role !== 'Admin') return null;

  const save = async (key: string, value: string | null) => {
    const { error } = await supabase().from('integration_config').update({ value, updated_at: new Date().toISOString() }).eq('key', key);
    if (error) { setMsg({ tone: 'bad', text: error.message }); return false; }
    await load(); return true;
  };
  const newSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(24))).map((b) => b.toString(16).padStart(2, '0')).join('');
  const incoming = typeof window !== 'undefined' ? window.location.origin + '/api/integrations/lead' : '/api/integrations/lead';
  const row = 'flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted';
  const mono = 'flex h-10 min-w-0 items-center truncate rounded-[10px] bg-surface2 px-3 font-mono text-[12px] text-text';

  return (
    <section className="border-t border-line pt-3">
      <h2 className="text-base font-semibold">Activepieces setup</h2>
      <p className="mt-1 text-[13px] text-text2">Connects the CRM to Activepieces, the tool that sends WhatsApp, email and other automatic actions. Changing the address below changes where every event goes; clearing it pauses all automations (events wait, nothing is lost).</p>
      <p className="mt-1 text-[12.5px] text-muted">Technical: events go to the webhook (a web address Activepieces listens on) every minute, signed with the secret (header <code>X-Stint-Signature: sha256=…</code>). Leads come in through the incoming address with the API key.</p>
      <div className="mt-4 grid gap-x-6 gap-y-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <label className={row}>Activepieces webhook URL (outgoing events)
          <div className="flex gap-2">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://cloud.activepieces.com/api/v1/webhooks/…" className="h-10 min-w-0 flex-1 px-3 text-sm" />
            <Button variant="secondary" onClick={async () => { if (url && !/^https?:\/\//.test(url)) { setMsg({ tone: 'bad', text: 'The URL must start with https://' }); return; } if (await save('activepieces_webhook_url', url.trim() || null)) setMsg({ tone: 'good', text: url.trim() ? 'Webhook saved. Waiting events go out within a minute.' : 'Webhook removed. Events wait until one is set.' }); }}>Save</Button>
          </div>
        </label>
        <div className={row}>Incoming leads address (POST)
          <div className={mono}>{incoming}</div>
        </div>
        <div className={row}>Signing secret
          <div className="flex gap-2"><div className={mono + ' min-w-0 flex-1'}>{show ? cfg.signing_secret : '•'.repeat(24)}</div>
            <Button variant="quiet" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</Button>
            <Button variant="outline" onClick={async () => { if (await save('signing_secret', newSecret())) setMsg({ tone: 'good', text: 'New signing secret made. Update it in Activepieces.' }); }}>New</Button></div>
        </div>
        <div className={row}>Incoming API key (header <code>x-api-key</code>)
          <div className="flex gap-2"><div className={mono + ' min-w-0 flex-1'}>{show ? cfg.incoming_api_key : '•'.repeat(24)}</div>
            <Button variant="outline" onClick={async () => { if (await save('incoming_api_key', newSecret())) setMsg({ tone: 'good', text: 'New API key made. The old one stops working now; update Activepieces.' }); }}>New</Button></div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={async () => { const { error } = await supabase().rpc('send_test_event'); setMsg(error ? { tone: 'bad', text: error.message } : { tone: 'good', text: 'Test event queued. It appears in the log below and goes out within a minute.' }); }}>Send a test event</Button>
        <span className="text-[12px] text-muted">Starter flows to import: <code>docs/activepieces/</code> in the project.</span>
      </div>
      {msg && <div className="mt-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
    </section>
  );
}
