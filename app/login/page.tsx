'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// Demo logins from scripts/seed-demo.mjs. Shown only in development, never in a production build.
const DEMO_PASSWORD = 'stint-demo-1234';
const DEMO_USERS = [
  ['harsha', 'Admin'], ['anita', 'Front desk'], ['divya', 'Marketing'], ['teja', 'Telecaller'], ['manish', 'Sales'],
  ['praveen', 'HR / Counsellor'], ['kiran', 'Trainer'], ['hemanth', 'SME'], ['lakshmi', 'Placement'], ['suresh', 'Finance'],
] as const;
const IS_DEV = process.env.NODE_ENV === 'development';
const EMAIL_KEY = 'stint-last-email';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try { const saved = localStorage.getItem(EMAIL_KEY); if (saved) setEmail(saved); } catch {}
  }, []);

  const signIn = async (mail: string, pass: string) => {
    setBusy(true); setError(null);
    const { error } = await supabase().auth.signInWithPassword({ email: mail.trim(), password: pass });

    if (error) {
      const down = /fetch/i.test(error.message) || (error.status ?? 0) >= 500;
      setError(error.message === 'Invalid login credentials' ? 'That email and password don’t match.' : down ? 'Can’t reach the database. In the project folder run “supabase start”, then try again.' : error.message);
      setBusy(false); return;
    }
    try { localStorage.setItem(EMAIL_KEY, mail.trim()); } catch {}
    window.location.href = '/';
  };

  const submit = (e: React.FormEvent) => { e.preventDefault(); signIn(email, password); };

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <form onSubmit={submit} className="w-full max-w-[380px] rounded-2xl border border-line bg-surface p-7">
        <div className="flex items-end gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/stint-logo.svg" alt="Stint" width={150} height={49} className="logo-light h-[49px] w-auto" />
          <img src="/brand/stint-logo-dark.svg" alt="" width={150} height={49} className="logo-dark h-[49px] w-auto" />
          <span className="mb-[18px] rounded-md bg-accentSoft px-1.5 py-0.5 text-[11px] font-semibold text-accentText">CRM</span>
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
        {IS_DEV && (
          <label className="mt-5 flex flex-col gap-1 border-t border-line pt-4 text-xs font-medium text-text2">
            Demo login (development only)
            <select disabled={busy} value="" onChange={(e) => e.target.value && signIn(`${e.target.value}@demo.stint.local`, DEMO_PASSWORD)} className="h-11 px-3 text-sm">
              <option value="">Pick a demo account…</option>
              {DEMO_USERS.map(([u, role]) => <option key={u} value={u}>{u} · {role}</option>)}
            </select>
          </label>
        )}
      </form>
    </main>
  );
}
