'use client';
import { SessionProvider } from '@/lib/session';
import { Shell } from '@/components/Shell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
