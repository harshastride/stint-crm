'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { CheckCircle2, FileText, Loader2, MessageCircle } from 'lucide-react';

// pdf.js uses browser-only APIs, so the PDF part loads only in the browser.
const PdfPages = dynamic(() => import('@/components/kit/PdfPages'), { ssr: false, loading: () => <Opening /> });

type Intro = { first_name: string; course: string; greeting: string; why: string[]; answers: { q: string; a: string }[]; next_step: string; by: string };
type Props = { token: string; title: string; intro: Intro | null; pdf: string | null; whatsapp: string | null; institute: string };

const BEAT_MS = 15_000;     // heartbeat while the tab is visible
const IDLE_MS = 120_000;    // no scroll, tap or key for 2 minutes = not reading; stop counting

/** The brochure as the lead sees it: their first page, then the PDF. Records time per page while the page is visible. */
export function BrochureViewer({ token, title, intro, pdf, whatsapp, institute }: Props) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [pages, setPages] = useState(0);
  const [failed, setFailed] = useState(!pdf);
  const [width, setWidth] = useState(600);
  const box = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement | null>(null);   // never attached: lazy pages watch the window
  const current = useRef(0);                               // page in view: 0 = the personal first page
  const acc = useRef<Map<number, number>>(new Map());
  const lastActive = useRef(Date.now());

  // ---- the PDF, through the short-lived link the server made ----
  useEffect(() => {
    if (!pdf) return;
    let live = true;
    fetch(pdf).then((r) => (r.ok ? r.blob() : Promise.reject(new Error('file')))).then((b) => { if (live) setBlob(b); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [pdf]);

  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(260, Math.min(900, el.clientWidth))));
    ro.observe(el); return () => ro.disconnect();
  }, []);

  // ---- which page is in view ----
  useEffect(() => {
    const io = new IntersectionObserver((es) => {
      const v = es.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (v) current.current = Number((v.target as HTMLElement).dataset.trackPage ?? (v.target as HTMLElement).dataset.pageNumber ?? 0);
    }, { threshold: [0.2, 0.5, 0.8] });
    document.querySelectorAll('[data-track-page],[data-page-number]').forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [pages]);

  // ---- recording: one call on open, a heartbeat every 15 s, and one on leaving ----
  const take = useCallback(() => {
    const events = [...acc.current.entries()].filter(([, s]) => s > 0).map(([page, seconds]) => ({ page, seconds }));
    acc.current = new Map();
    return events;
  }, []);
  const send = useCallback((events: { page: number; seconds: number }[], beacon = false) => {
    const body = JSON.stringify({ token, events });
    if (beacon && navigator.sendBeacon) { navigator.sendBeacon('/api/brochures/track', new Blob([body], { type: 'application/json' })); return; }
    fetch('/api/brochures/track', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  }, [token]);

  useEffect(() => {
    send([{ page: 0, seconds: 0 }]);
    const active = () => { lastActive.current = Date.now(); };
    const tick = setInterval(() => {
      if (document.visibilityState !== 'visible' || Date.now() - lastActive.current > IDLE_MS) return;
      const p = current.current; acc.current.set(p, (acc.current.get(p) || 0) + 1);
    }, 1000);
    const beat = setInterval(() => { const ev = take(); if (ev.length) send(ev); }, BEAT_MS);
    const leave = () => { const ev = take(); if (ev.length) send(ev, true); };
    const vis = () => { if (document.visibilityState === 'hidden') leave(); else active(); };
    const opts = { passive: true } as const;
    ['scroll', 'pointerdown', 'keydown', 'touchstart', 'wheel'].forEach((e) => window.addEventListener(e, active, opts));
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('pagehide', leave);
    return () => {
      clearInterval(tick); clearInterval(beat);
      ['scroll', 'pointerdown', 'keydown', 'touchstart', 'wheel'].forEach((e) => window.removeEventListener(e, active));
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('pagehide', leave);
    };
  }, [send, take]);

  const name = intro?.first_name?.trim();
  const waText = `Hi, I have a question about the ${title} brochure.`;

  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="sticky top-0 z-10 border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-[760px] items-center justify-between gap-3 px-4">
          <img src="/brand/stint-logo.svg" alt={institute} className="h-7 w-auto" />
          <span className="min-w-0 truncate text-[13px] font-medium text-text2" title={title}>{title}</span>
        </div>
      </header>

      <main ref={box} className="mx-auto flex max-w-[760px] flex-col gap-5 px-4 pb-10 pt-5">
        {/* 1. the page written for this lead */}
        <section data-track-page="0" aria-labelledby="for-you" className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-1)] sm:p-6">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-accentText">{name ? `For ${name}` : 'For you'}</div>
          <h1 id="for-you" className="mt-1 text-[22px] font-semibold leading-tight">{intro?.course && intro.course !== 'our courses' ? intro.course : title}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-text">{intro?.greeting || `Here is the ${title} brochure you asked about.`}</p>

          {!!intro?.why?.length && (
            <div className="mt-5">
              <h2 className="text-[14px] font-semibold">Why this course fits you</h2>
              <ul className="mt-2 flex flex-col gap-2">
                {intro.why.map((w, i) => (
                  <li key={i} className="flex gap-2.5 text-[14.5px] leading-snug"><CheckCircle2 size={18} aria-hidden className="mt-0.5 shrink-0 text-accentText" />{w}</li>
                ))}
              </ul>
            </div>
          )}

          {!!intro?.answers?.length && (
            <div className="mt-5">
              <h2 className="text-[14px] font-semibold">Your questions, answered</h2>
              <dl className="mt-2 divide-y divide-line rounded-xl border border-line">
                {intro.answers.map((a, i) => (
                  <div key={i} className="px-3.5 py-3">
                    <dt className="text-[14px] font-semibold">{a.q}</dt>
                    <dd className="mt-1 text-[14px] leading-relaxed text-text2">{a.a}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {intro?.next_step && <p className="mt-5 rounded-xl bg-accentSoft px-3.5 py-3 text-[14px] font-medium text-accentText">{intro.next_step}</p>}
        </section>

        {/* 2. the brochure itself */}
        <section aria-label="Brochure pages" className="flex flex-col items-center gap-4">
          {failed ? (
            <div role="alert" className="flex w-full flex-col items-center gap-2 rounded-2xl border border-line bg-surface p-6 text-center">
              <FileText size={28} aria-hidden className="text-muted" />
              <div className="text-[14.5px] font-semibold">The brochure pages couldn’t open</div>
              <p className="text-[13.5px] text-text2">Please reload this page. If it still doesn’t open, reply to our message and we’ll send it again.</p>
            </div>
          ) : !blob ? <Opening /> : (
            <div className="w-full [&_.react-pdf__Document]:items-center">
              <PdfPages blob={blob} pages={pages} onPages={setPages} onError={() => setFailed(true)} width={width} rotate={0} root={viewport} />
            </div>
          )}
        </section>

        <footer className="mt-2 flex flex-col items-center gap-3 border-t border-line pt-6 text-center">
          <div className="text-[15px] font-semibold">Questions? Reply on WhatsApp</div>
          {whatsapp && (
            <a href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(waText)}`} target="_blank" rel="noreferrer"
              className="btn inline-flex h-11 items-center gap-2 rounded-[10px] bg-accent px-5 text-[14px] font-semibold text-white">
              <MessageCircle size={18} aria-hidden />Message {institute}
            </a>
          )}
          <p className="text-[12px] text-muted">{institute}</p>
        </footer>
      </main>
    </div>
  );
}

function Opening() {
  return <div role="status" className="flex min-h-[200px] w-full items-center justify-center gap-2 text-sm text-muted"><Loader2 size={18} className="btn-spin" aria-hidden />Opening the brochure…</div>;
}
