import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { CheckCircle2, XCircle } from 'lucide-react';
import { service } from '@/lib/server/recordings';
import { limited } from '@/lib/server/guard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Verify a document · Stint Academy', robots: { index: false, follow: false } };

type Doc = { found: boolean; kind?: 'receipt' | 'quote'; number?: string; issued_on?: string; valid_until?: string | null; amount?: number; status?: string; institute?: string; holder?: string };

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/** Public check for the QR on a fee receipt or quote. No login; shows initials and amounts only, never names, contact or IDs. */
export default async function VerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const h = await headers();
  const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || 'local';
  const busy = limited('verify:' + ip, 20);   // 20 checks a minute per address: guessing codes is pointless
  let doc: Doc = { found: false };
  if (!busy && /^[A-Za-z0-9]{12,32}$/.test(code)) {
    const { data } = await service().rpc('verify_document', { p_code: code });
    if (data) doc = data as Doc;
  }
  const ok = doc.found;
  const what = doc.kind === 'quote' ? 'fee quote' : 'payment receipt';
  const rows: [string, string][] = ok ? [
    [doc.kind === 'quote' ? 'Quote number' : 'Receipt number', doc.number || '—'],
    [doc.kind === 'quote' ? 'Issued on' : 'Paid on', day(doc.issued_on)],
    ['Amount', inr(Number(doc.amount || 0))],
    ...(doc.kind === 'quote' ? [['Valid until', day(doc.valid_until)] as [string, string]] : []),
    ['Status', doc.status || '—'],
    [doc.kind === 'quote' ? 'Prepared for' : 'Student', doc.holder || '—'],
  ] : [];

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <img src="/brand/stint-logo.svg" alt="Stint Academy" className="h-8 w-auto" />
        {ok ? (
          <div data-testid="verify-genuine">
            <div className="mt-5 flex items-center gap-3 rounded-xl bg-goodBg p-4 text-goodText">
              <CheckCircle2 size={36} aria-hidden className="shrink-0" />
              <div>
                <h1 className="text-lg font-semibold">Genuine {doc.institute} {what}</h1>
                <p className="text-sm">This document was issued by {doc.institute}.</p>
              </div>
            </div>
            <dl className="mt-4 divide-y divide-line text-sm">
              {rows.map(([k, v]) => (
                <div key={k} className="flex min-h-11 items-center justify-between gap-4 py-2">
                  <dt className="text-muted">{k}</dt><dd className="text-right font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-muted">Check that the details printed on your copy match these. For privacy we show only initials.</p>
          </div>
        ) : (
          <div data-testid="verify-not-found" className="mt-5 flex items-center gap-3 rounded-xl bg-badBg p-4 text-badText">
            <XCircle size={36} aria-hidden className="shrink-0" />
            <div>
              <h1 className="text-lg font-semibold">We couldn&apos;t find this document</h1>
              <p className="text-sm">{busy ? 'Too many checks from this connection. Try again in a minute.' : 'Please contact Stint Academy to confirm it.'}</p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
