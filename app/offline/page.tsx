import type { Metadata } from 'next';
import { WifiOff } from 'lucide-react';

export const metadata: Metadata = { title: 'Offline · Stint CRM' };
export const dynamic = 'force-static';

/** Shown by the service worker when a page is opened without internet. Holds no personal data. */
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 text-center shadow-sm">
        <WifiOff size={32} className="mx-auto text-accent" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold">You&apos;re offline</h1>
        <p className="mt-1.5 text-sm text-muted">Your changes aren&apos;t lost. Reconnect to continue.</p>
        <a href="/" className="mt-5 inline-flex h-11 items-center justify-center rounded-xl bg-accent px-5 text-sm font-semibold text-white">Try again</a>
      </div>
    </main>
  );
}
