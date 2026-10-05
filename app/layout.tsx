import './globals.css';
import type { Metadata, Viewport } from 'next';
import { ServiceWorker } from '@/components/kit/ServiceWorker';

export const metadata: Metadata = { title: 'Stint CRM', description: 'Stint Academy training and placement CRM', icons: { icon: '/brand/stint-icon.svg', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'Stint CRM', statusBarStyle: 'default' }, other: { 'mobile-web-app-capable': 'yes' } };
export const viewport: Viewport = { themeColor: '#4474B9' };

// Render per request so Next.js can put the CSP nonce from middleware.ts on its scripts.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body>{children}<ServiceWorker /></body>
    </html>
  );
}
