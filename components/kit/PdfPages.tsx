'use client';
import { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';

// The PDF worker is bundled and served from our own origin (CSP worker-src 'self'); never a CDN.
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

type Props = { blob: Blob; pages: number; onPages: (n: number) => void; onError: () => void; width?: number; scale?: number; rotate: number; root: React.RefObject<HTMLDivElement | null> };

export default function PdfPages({ blob, pages, onPages, onError, width, scale, rotate, root }: Props) {
  // Hand pdf.js the Blob (read to bytes on each load), not a blob: link, so CSP connect-src stays 'self'.
  return (
    <Document file={blob} onLoadSuccess={(d) => onPages(d.numPages)} onLoadError={onError} onSourceError={onError} loading={null} className="flex flex-col items-center gap-4">
      {Array.from({ length: pages }, (_, i) => (
        <div key={i} data-page-number={i + 1} className="bg-white shadow-md">
          <LazyPage n={i + 1} width={width} scale={scale} rotate={rotate} root={root} />
        </div>
      ))}
    </Document>
  );
}

/** Renders a page only once it is near the visible area. */
function LazyPage({ n, width, scale, rotate, root }: { n: number; width?: number; scale?: number; rotate: number; root: React.RefObject<HTMLDivElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(n <= 2);
  useEffect(() => {
    if (show || !ref.current) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setShow(true); }, { root: root.current, rootMargin: '600px' });
    io.observe(ref.current); return () => io.disconnect();
  }, [show, root]);
  const w = width ?? 612 * (scale || 1);
  return (
    <div ref={ref} style={show ? undefined : { width: w, height: w * 1.3 }}>
      {show && <Page pageNumber={n} width={width} scale={width ? undefined : scale} rotate={rotate} renderAnnotationLayer={false} renderTextLayer loading={<div style={{ width: w, height: w * 1.3 }} />} />}
    </div>
  );
}

