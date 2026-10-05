'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button, Notice } from './ui';

/** Set a new password for the signed-in person. `forced` is the first-login screen after an invite or reset. */
export function ChangePassword({ forced, onDone }: { forced?: boolean; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    if (pw.length < 10) { setMsg('Use at least 10 characters.'); return; }
    if (pw !== again) { setMsg('The two passwords don’t match.'); return; }
    setBusy(true); setMsg(null);
    const db = supabase();
    const { error } = await db.auth.updateUser({ password: pw });
    if (error) { setBusy(false); setMsg(/different from the old/i.test(error.message) ? 'Pick a password different from the temporary one.' : error.message); return; }
    const r = await db.rpc('password_changed');
    setBusy(false);
    if (r.error) { setMsg(r.error.message); return; }
    onDone();
  };

  return (
    <div className="flex flex-col gap-3">
      {forced && <p className="text-text2">You signed in with a temporary password. Choose your own to continue.</p>}
      <label className="flex flex-col gap-1 text-xs font-medium text-text2">New password
        <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className="h-11 px-3 text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-text2">Type it again
        <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} className="h-11 px-3 text-sm" />
      </label>
      {msg && <Notice tone="bad">{msg}</Notice>}
      <Button variant="primary" fullWidth loading={busy} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save new password'}</Button>
    </div>
  );
}
