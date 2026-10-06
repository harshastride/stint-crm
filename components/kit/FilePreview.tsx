'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileText, Loader2, Maximize2, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react';
import dynamic from 'next/dynamic';
import { Button, IconButton } from '../ui';

// pdf.js touches browser-only APIs, so the PDF part loads only in the browser.
const PdfPages = dynamic(() => import('./PdfPages'), { ssr: false, loading: () => <Spinner /> });

export type PreviewKind = 'pdf' | 'image' | 'other';
export type PreviewRequest = {
  title: string;
  fileName?: string;
  kind?: PreviewKind;
  /** A ready URL (e.g. a short-lived signed storage link). */
  src?: string;
  /** Or a function that resolves one (called when the window opens). */
  getUrl?: () => Promise<string>;
};

const Ctx = createContext<{ open: (r: PreviewRequest) => void } | null>(null);

/** Open files in a window on top of the page. Falls back to a new tab only if no provider is mounted. */
export function useFilePreview() {
  const c = useContext(Ctx);
  return c || { open: async (r: PreviewRequest) => { const u = r.src || (r.getUrl ? await r.getUrl() : ''); if (u) window.location.href = u; } };
}

export const kindOf = (name: string): PreviewKind => (/\.pdf($|\?)/i.test(name) ? 'pdf' : /\.(png|jpe?g|gif|webp)($|\?)/i.test(name) ? 'image' : 'other');
export const storageName = (path: string) => path.split('/').pop()!.replace(/^[0-9a-f-]{36}-/, '');

/** Our own routes (/api/...) are fetched with the session cookie and shown from a local blob link. */
async function resolve(r: PreviewRequest): Promise<{ url: string; blob: Blob; type: string }> {
  const raw = r.src || (r.getUrl ? await r.getUrl() : '');
  if (!raw) throw new Error('no url');
  const res = await fetch(raw, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const b = await res.blob();
  return { url: URL.createObjectURL(b), blob: b, type: b.type };
}

export function FilePreviewProvider({ children }: { children: React.ReactNode }) {
  const [req, setReq] = useState<PreviewRequest | null>(null);
  const open = useCallback((r: PreviewRequest) => setReq(r), []);
  const value = useMemo(() => ({ open }), [open]);
  return <Ctx.Provider value={value}>{children}{req && <PreviewDialog req={req} onClose={() => setReq(null)} />}</Ctx.Provider>;
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

function PreviewDialog({ req, onClose }: { req: PreviewRequest; onClose: () => void }) {
  const [file, setFile] = useState<{ url: string; blob: Blob; type: string } | null>(null);
  const [err, setErr] = useState(false);
  const [pages, setPages] = useState(0);
  const [cur, setCur] = useState(1);
  const [zoom, setZoom] = useState<number | null>(null); // null = fit width
  const [rot, setRot] = useState(0);
  const [width, setWidth] = useState(800);
  const box = useRef<HTMLDivElement>(null);
  const dlg = useRef<HTMLDivElement>(null);
  const back = useRef<Element | null>(null);
  const name = req.fileName || req.title;
  const fail = useCallback(() => setErr(true), []);

  useEffect(() => {
    back.current = document.activeElement;
    let live = true, made: string | null = null;
    resolve(req).then((f) => { made = f.url; if (live) setFile(f); else URL.revokeObjectURL(f.url); }).catch(() => live && setErr(true));
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => dlg.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus());
    return () => {
      live = false; if (made) URL.revokeObjectURL(made);
      document.body.style.overflow = prev;
      (back.current as HTMLElement | null)?.focus?.();
    };
  }, [req]);

  const kind: PreviewKind = req.kind || (file?.type.includes('pdf') ? 'pdf' : file?.type.startsWith('image/') ? 'image' : kindOf(name));

  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(200, el.clientWidth - 32)));
    ro.observe(el); return () => ro.disconnect();
  }, [file]);

  // Track the page in view.
  useEffect(() => {
    const el = box.current; if (!el || !pages) return;
    const io = new IntersectionObserver((es) => {
      const v = es.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (v) setCur(Number((v.target as HTMLElement).dataset.pageNumber));
    }, { root: el, threshold: [0.25, 0.5, 0.75] });
    el.querySelectorAll('[data-page-number]').forEach((p) => io.observe(p));
    return () => io.disconnect();
  }, [pages, zoom, rot]);

  const go = (n: number) => { const t = Math.min(Math.max(1, n), pages || 1); setCur(t); box.current?.querySelector(`[data-page-number="${t}"]`)?.scrollIntoView({ block: 'start' }); };
  const scale = zoom ?? 1;
  const zoomIdx = ZOOMS.findIndex((z) => z >= scale);
  const zoomIn = () => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoom === null ? 3 : zoomIdx + 1)]);
  const zoomOut = () => setZoom(ZOOMS[Math.max(0, zoom === null ? 1 : zoomIdx - 1)]);

  const download = () => {
    if (!file) return;
    const a = document.createElement('a'); a.href = file.url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key === 'Tab') { // keep focus inside
      const f = Array.from(dlg.current!.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],[tabindex="0"]'));
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    if ((e.target as HTMLElement).tagName === 'SELECT') return;
    if (kind === 'pdf' && e.key === 'ArrowRight') { e.preventDefault(); go(cur + 1); }
    else if (kind === 'pdf' && e.key === 'ArrowLeft') { e.preventDefault(); go(cur - 1); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
    else if (e.key === '-') { e.preventDefault(); zoomOut(); }
  };

  const showPdf = kind === 'pdf' && file && !err;
  return (
    <div className="fixed inset-0 z-[80] flex items-stretch justify-center bg-black/55 sm:items-center sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dlg} role="dialog" aria-modal="true" aria-labelledby="fp-title" onKeyDown={onKey}
        className="flex h-full w-full flex-col overflow-hidden bg-surface shadow-2xl sm:h-[92vh] sm:max-w-[980px] sm:rounded-2xl">
        <header className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5 sm:px-3">
          <FileText size={16} aria-hidden className="ml-1 shrink-0 text-muted" />
          <h2 id="fp-title" className="min-w-0 flex-1 truncate px-1 text-[14.5px] font-semibold text-text" title={name}>{req.title}</h2>
          {(showPdf || (kind === 'image' && file)) && (
            <div className="order-last flex w-full flex-wrap items-center justify-center gap-1 border-t border-line pt-1.5 sm:order-none sm:w-auto sm:justify-start sm:border-0 sm:pt-0">
              {showPdf && <>
                <IconButton aria-label="Previous page" size="icon-sm" disabled={cur <= 1} onClick={() => go(cur - 1)} icon={<ChevronLeft size={16} />} />
                <span className="min-w-[92px] text-center text-[13px] tabular-nums text-text2" aria-live="polite">Page {cur} of {pages || '…'}</span>
                <IconButton aria-label="Next page" size="icon-sm" disabled={cur >= pages} onClick={() => go(cur + 1)} icon={<ChevronRight size={16} />} />
              </>}
              <span className="mx-1 h-5 w-px bg-line" aria-hidden />
              <IconButton aria-label="Zoom out" size="icon-sm" onClick={zoomOut} icon={<ZoomOut size={16} />} />
              <span className="w-[46px] text-center text-[12.5px] tabular-nums text-text2">{zoom === null ? 'Fit' : Math.round(zoom * 100) + '%'}</span>
              <IconButton aria-label="Zoom in" size="icon-sm" onClick={zoomIn} icon={<ZoomIn size={16} />} />
              <IconButton aria-label="Fit width" size="icon-sm" active={zoom === null} onClick={() => setZoom(null)} icon={<Maximize2 size={15} />} />
              <IconButton aria-label="Rotate" size="icon-sm" onClick={() => setRot((r) => (r + 90) % 360)} icon={<RotateCw size={15} />} />
            </div>
          )}
          <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden />
          <Button variant="outline" size="sm" onClick={download} disabled={!file} leftIcon={<Download size={14} />}>Download</Button>
          <IconButton data-autofocus aria-label="Close (Esc)" onClick={onClose} icon={<X size={18} />} />
        </header>
        <div ref={box} tabIndex={0} aria-label="File contents" className="relative min-h-0 flex-1 overflow-auto bg-surface2 p-4 outline-none">
          {err ? <Fallback name={name} onDownload={file ? download : undefined} text="Couldn’t show this file." />
            : !file ? <Spinner />
            : kind === 'image' ? (
              <img src={file.url} alt={name} style={{ transform: `rotate(${rot}deg)`, width: zoom === null ? '100%' : `${zoom * 100}%`, maxWidth: zoom === null ? '100%' : 'none' }}
                className="mx-auto block h-auto rounded-md object-contain" />
            ) : kind === 'pdf' ? (
              <PdfPages blob={file.blob} pages={pages} onPages={setPages} onError={fail} width={zoom === null ? width : undefined} scale={zoom ?? undefined} rotate={rot} root={box} />
            ) : <Fallback name={name} onDownload={download} text="This file type can’t be shown here." />}
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return <div className="flex h-full min-h-[200px] items-center justify-center gap-2 text-sm text-muted" role="status"><Loader2 size={18} className="btn-spin" /> Opening…</div>;
}

function Fallback({ name, text, onDownload }: { name: string; text: string; onDownload?: () => void }) {
  return (
    <div role="alert" className="mx-auto mt-10 flex max-w-sm flex-col items-center gap-3 rounded-2xl bg-surface p-6 text-center">
      <FileText size={28} className="text-muted" aria-hidden />
      <div className="break-all text-[14px] font-semibold text-text">{name}</div>
      <p className="text-[13px] text-text2">{text}{onDownload ? ' Download instead.' : ''}</p>
      {onDownload && <Button variant="primary" onClick={onDownload} leftIcon={<Download size={15} />}>Download</Button>}
    </div>
  );
}
