'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      const down = /fetch/i.test(error.message) || (error.status ?? 0) >= 500;
      setError(error.message === 'Invalid login credentials' ? 'That email and password don’t match.' : down ? 'Can’t reach the database. In the project folder run “supabase start”, then try again.' : error.message);
      setBusy(false); return;
    }
    window.location.href = '/';
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <form onSubmit={submit} className="w-full max-w-[380px] rounded-2xl border border-line bg-surface p-7">
        <div className="flex items-center gap-2.5">
          <span className="inline-block h-4 w-4 rotate-45 rounded-[3px] bg-accent" aria-hidden />
          <span className="text-base font-semibold">Stint CRM</span>
        </div>
        <h1 className="mt-6 text-[26px] font-semibold leading-tight">Sign in</h1>
        <p className="mt-1 text-text2">Use the email your admin invited.</p>
        <label className="mt-6 flex flex-col gap-1 text-xs font-medium text-text2">
          Email
          <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 px-3 text-sm" />
        </label>
        <label className="mt-3 flex flex-col gap-1 text-xs font-medium text-text2">
          Password
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 px-3 text-sm" />
        </label>
        {error && <div role="alert" className="mt-3 rounded-[10px] bg-badBg px-3 py-2.5 text-[13px] font-medium text-badText">{error}</div>}
        <button type="submit" disabled={busy} className="mt-5 h-11 w-full rounded-[10px] bg-accent text-sm font-semibold text-white">{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
