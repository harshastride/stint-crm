'use client';
import { SessionProvider } from '@/lib/session';
import { Shell } from '@/components/Shell';
import { ToastProvider } from '@/components/Toasts';
import { FilePreviewProvider } from '@/components/kit/FilePreview';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider><FilePreviewProvider><Shell>{children}</Shell></FilePreviewProvider></ToastProvider>
    </SessionProvider>
  );
}
