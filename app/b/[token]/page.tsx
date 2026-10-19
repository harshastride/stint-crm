import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { FileX2 } from 'lucide-react';
import { limited } from '@/lib/server/guard';
import { sendForPage } from '@/lib/server/brochure';
import { BrochureViewer } from './BrochureViewer';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Course brochure · Stint Academy', robots: { index: false, follow: false } };

/** Public page for a brochure link sent to one lead. No login. Shows the personal first page and the PDF;
 *  never staff names or anyone's contact details. Views are recorded by the viewer (see /api/brochures/track). */
export default async function BrochurePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || 'local';
  const busy = limited('brochure-page:' + ip, 30);
  const send = busy ? null : await sendForPage(token);

  if (!send) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg p-4">
        <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 text-center shadow-sm">
          <img src="/brand/stint-logo.svg" alt="Stint Academy" className="mx-auto h-8 w-auto" />
          <FileX2 size={32} aria-hidden className="mx-auto mt-6 text-muted" />
          <h1 className="mt-3 text-lg font-semibold">{busy ? 'Please try again in a minute' : 'This link isn’t available any more'}</h1>
          <p className="mt-1 text-sm text-text2">{busy ? 'Too many visits from this connection.' : 'Please ask Stint Academy to send you a new one.'}</p>
        </div>
      </main>
    );
  }
  return <BrochureViewer token={token} title={send.title} intro={send.intro} pdf={send.pdf} whatsapp={send.whatsapp} institute={send.institute} />;
}
