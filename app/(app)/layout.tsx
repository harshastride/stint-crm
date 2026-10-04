'use client';
import { SessionProvider } from '@/lib/session';
import { Shell } from '@/components/Shell';
import { ToastProvider } from '@/components/Toasts';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider><Shell>{children}</Shell></ToastProvider>
    </SessionProvider>
  );
}
