'use client';
import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui';

// Demo logins from scripts/seed-demo.mjs. Shown only in development, never in a production build.
const DEMO_PASSWORD = 'stint-demo-1234';
const DEMO_USERS = [
  ['harsha', 'Admin'], ['anita', 'Front desk'], ['divya', 'Marketing'], ['teja', 'Telecaller'], ['manish', 'Sales'],
  ['praveen', 'HR / Counsellor'], ['kiran', 'Trainer'], ['hemanth', 'SME'], ['lakshmi', 'Placement'], ['suresh', 'Finance'], ['priya', 'Student (portal)'],
] as const;
const IS_DEV = process.env.NODE_ENV === 'development';
const EMAIL_KEY = 'stint-last-email';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);

  const [idleOut, setIdleOut] = useState(false);
  useEffect(() => {
    setIdleOut(new URLSearchParams(window.location.search).get('reason') === 'idle');
    try { const saved = localStorage.getItem(EMAIL_KEY); if (saved) setEmail(saved); } catch {}
  }, []);

  const signIn = async (mail: string, pass: string) => {
    setBusy(true); setError(null);
    // sign-in goes through /api/auth/sign-in, which counts wrong passwords and locks an email for 15 minutes after 5
    let body: { access_token?: string; refresh_token?: string; error?: string; minutes?: number } = {};
    try {
      const res = await fetch('/api/auth/sign-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: mail.trim(), password: pass }) });
      body = await res.json().catch(() => ({ error: 'down' }));
    } catch { body = { error: 'down' }; }
    const set = body.access_token && body.refresh_token ? await supabase().auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token }) : null;
    if (!set || set.error) {
      const e = body.error;
      setError(e === 'locked' ? `Too many wrong tries. Sign-in for this email is paused for ${body.minutes ?? 15} minute${body.minutes === 1 ? '' : 's'}. Try again later or ask your admin.`
        : e === 'invalid' ? 'That email and password don’t match.'
        : e === 'busy' ? 'Too many sign-in attempts from here. Wait a few minutes and try again.'
        : e === 'down' || !e ? 'Can’t reach the database. In the project folder run “supabase start”, then try again.' : e);
      setBusy(false); return;
    }
    try { localStorage.setItem(EMAIL_KEY, mail.trim()); } catch {}
    window.location.href = '/';
  };

  const submit = (e: React.FormEvent) => { e.preventDefault(); signIn(email, password); };

  return (
    <main className="grid min-h-screen bg-bg lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-ink p-12 text-[#E6EBF5] lg:flex lg:flex-col" aria-hidden>
        <span className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-[rgba(68,116,185,.25)] blur-2xl" />
        <span className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-[rgba(255,107,53,.15)] blur-3xl" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/stint-logo-dark.svg" alt="Stint" className="relative h-[38px] w-fit" />
        <div className="relative mt-auto">
          <h2 className="text-[34px] font-semibold leading-tight text-white">Every student,<br />from first call to first job.</h2>
          <p className="mt-3 max-w-md text-[15px] text-[#9AA8C4]">Leads, enrolments, training, mocks, placements and fees for Stint Academy, in one place.</p>
          <ul className="mt-8 flex flex-col gap-3 text-[14px]">
            {[['Calls and follow-ups', 'Nobody waits for a callback.'], ['Training to placement', 'See where every student is.'], ['Fees and receipts', 'Branded PDFs in one click.']].map(([t, d]) => (
              <li key={t} className="flex items-start gap-3"><span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-coral text-[11px] font-bold text-ink">✓</span><span><b className="text-white">{t}</b> <span className="text-[#9AA8C4]">· {d}</span></span></li>
            ))}
          </ul>
          <div className="mt-10 flex gap-1.5">{Array.from({ length: 9 }, (_, i) => <span key={i} className={'h-1.5 flex-1 rounded-full ' + (i < 6 ? 'bg-accent' : i === 6 ? 'bg-coral' : 'bg-white/15')} />)}</div>
          <p className="mt-2 text-[11.5px] text-[#9AA8C4]">Lead → Calls → Counselling → Enrolled → Training → Mocks → Resume → Placement → Alumni</p>
        </div>
      </aside>
      <div className="flex items-center justify-center p-4 sm:p-8">
        <form onSubmit={submit} className="w-full max-w-[400px] rounded-2xl bg-surface p-7 shadow-[0_8px_30px_rgba(16,24,40,.08)] sm:p-8">
          <div className="flex items-end gap-2 lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/stint-logo.svg" alt="Stint" width={104} height={34} className="logo-light h-[34px] w-auto" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/stint-logo-dark.svg" alt="" width={104} height={34} className="logo-dark h-[34px] w-auto" />
            <span className="mb-[12px] rounded-md bg-accentSoft px-1.5 py-0.5 text-[10px] font-semibold text-accentText">CRM</span>
          </div>
          <h1 className="mt-6 text-[26px] font-semibold leading-tight tracking-tight lg:mt-0">Welcome back</h1>
          <p className="mt-1 text-text2">Sign in with the email your admin invited. Students use the same page.</p>
          <label className="mt-6 flex flex-col gap-1 text-xs font-medium text-text2">
            Email
            <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 px-3 text-sm" />
          </label>
          <label className="mt-3 flex flex-col gap-1 text-xs font-medium text-text2">
            Password
            <span className="relative">
              <input type={show ? 'text' : 'password'} required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 w-full px-3 pr-12 text-sm" />
              <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide what I typed' : 'Show what I typed'} aria-pressed={show} className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:text-text">
                {show ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </span>
          </label>
          {idleOut && !error && <div role="status" className="mt-3 rounded-[10px] bg-accentSoft px-3 py-2.5 text-[13px] font-medium text-accentText">Signed out after 30 minutes without activity. Sign in again to carry on.</div>}
          {error && <div role="alert" className="mt-3 rounded-[10px] bg-badBg px-3 py-2.5 text-[13px] font-medium text-badText">{error}</div>}
          <Button type="submit" variant="primary" size="lg" fullWidth loading={busy} className="mt-6">{busy ? 'Signing in…' : 'Sign in'}</Button>
          <p className="mt-4 text-center text-[12.5px] text-muted">Forgot your password? Ask your admin to reset it.</p>
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
      </div>
    </main>
  );
}
