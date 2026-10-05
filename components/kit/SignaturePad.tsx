'use client';
import { useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';
import { Button } from '../ui';

// Sign with a finger or mouse. Gives back a PNG (data URL) or null while empty.
export function SignaturePad({ onChange, height = 160 }: { onChange: (png: string | null) => void; height?: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false), last = useRef<[number, number] | null>(null);
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    const c = cv.current!; const r = window.devicePixelRatio || 1;
    c.width = c.clientWidth * r; c.height = height * r;
    const g = c.getContext('2d')!; g.scale(r, r); g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 2.4; g.strokeStyle = '#1B2A4A';
  }, [height]);
  const at = (e: React.PointerEvent): [number, number] => { const b = cv.current!.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  const down = (e: React.PointerEvent) => { cv.current!.setPointerCapture(e.pointerId); drawing.current = true; last.current = at(e); };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current || !last.current) return;
    const g = cv.current!.getContext('2d')!, p = at(e);
    g.beginPath(); g.moveTo(...last.current); g.lineTo(...p); g.stroke(); last.current = p;
    if (empty) setEmpty(false);
  };
  const up = () => { if (!drawing.current) return; drawing.current = false; last.current = null; if (!empty) onChange(cv.current!.toDataURL('image/png')); };
  const clear = () => { const c = cv.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setEmpty(true); onChange(null); };
  return (
    <div>
      <div className="relative rounded-[10px] border border-dashed border-line2 bg-white">
        <canvas ref={cv} aria-label="Signature box: sign here with your finger or mouse" style={{ height, touchAction: 'none' }} className="block w-full cursor-crosshair rounded-[10px]"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
        {empty && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-[#94A3B8]">Sign here</span>}
        <span className="pointer-events-none absolute bottom-8 left-6 right-6 border-b border-[#CBD5E1]" />
      </div>
      <Button variant="quiet" size="sm" className="mt-2" onClick={clear} disabled={empty} leftIcon={<Eraser size={14} />}>Clear and sign again</Button>
    </div>
  );
}
