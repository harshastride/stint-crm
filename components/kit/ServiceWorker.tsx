'use client';
import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

/** 'prompt' = Android/Chrome can install now, 'ios' = show the Share hint, null = nothing to offer (already installed or unsupported). */
export function useInstall(): { mode: 'prompt' | 'ios' | null; install: () => Promise<void> } {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  if (typeof window === 'undefined') return { mode: null, install: async () => {} };
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const mode = standalone ? null : deferred ? 'prompt' : ios ? 'ios' : null;
  return { mode, install: async () => { if (!deferred) return; await deferred.prompt(); await deferred.userChoice; deferred = null; notify(); } };
}

/** Registers /sw.js (production, or dev with NEXT_PUBLIC_ENABLE_SW=1), keeps the install prompt, and shows an offline banner. */
export function ServiceWorker() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const enabled = process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_ENABLE_SW === '1';
    if (enabled && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    const onPrompt = (e: Event) => { e.preventDefault(); deferred = e as InstallEvent; notify(); };
    const onInstalled = () => { deferred = null; notify(); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener('online', sync); window.addEventListener('offline', sync);
    // While offline, stop save/submit buttons instead of letting them fail silently.
    const block = (e: Event) => {
      if (navigator.onLine) return;
      if (e.type === 'submit') { e.preventDefault(); e.stopPropagation(); return; }
      const b = (e.target as HTMLElement | null)?.closest?.('button');
      if (!b) return;
      const label = (b.getAttribute('aria-label') || b.textContent || '').trim().toLowerCase();
      if (b.getAttribute('type') === 'submit' || /^(save|send|submit|create|add|update|enrol|mark)\b/.test(label)) {
        e.preventDefault(); e.stopPropagation(); b.title = "You're offline";
      }
    };
    document.addEventListener('click', block, true);
    document.addEventListener('submit', block, true);
    return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync); document.removeEventListener('click', block, true); document.removeEventListener('submit', block, true); };
  }, []);

  useEffect(() => { document.documentElement.toggleAttribute('data-offline', offline); }, [offline]);

  if (!offline) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 bg-[#0F2545] px-4 py-2 text-center text-[13px] font-medium text-white">
      <WifiOff size={15} aria-hidden />You&apos;re offline. Saving is paused; your changes aren&apos;t lost. Reconnect to continue.
    </div>
  );
}
