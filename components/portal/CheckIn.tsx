'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { QrCode, ScanLine } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Notice } from '@/components/ui';

// Student check-in: scan the QR on the classroom screen (camera, where the browser supports it) or type the
// 6-character code under it. The database checks the code, the student's own batch and today's date.
type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
const codeFrom = (raw: string) => { try { return new URL(raw).searchParams.get('checkin') || ''; } catch { return raw; } };

export function CheckIn() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const canScan = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

  const stop = useCallback(() => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setScanning(false); }, []);
  useEffect(() => stop, [stop]);

  const submit = useCallback(async (raw: string) => {
    const c = codeFrom(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (busyRef.current) return;
    if (c.length !== 6) { setMsg({ tone: 'bad', text: 'The code has 6 letters or numbers. Check the screen and try again.' }); return; }
    busyRef.current = true; setBusy(true); setMsg(null);
    const { data, error } = await supabase().rpc('student_checkin', { p_code: c });
    busyRef.current = false; setBusy(false);
    if (error || data?.status === 'invalid') { setMsg({ tone: 'bad', text: error?.message || data.message }); return; }
    stop(); setCode('');
    setMsg({ tone: 'good', text: data?.status === 'already' ? `You are already marked present today${data?.batch ? ' in ' + data.batch : ''}.` : `Checked in. You are marked present${data?.batch ? ' in ' + data.batch : ''}.` });
  }, [stop]);

  // opened from the QR link (camera app → /portal?checkin=CODE)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('checkin');
    if (q) { setOpen(true); setCode(q); submit(q); window.history.replaceState(null, '', window.location.pathname); }
  }, [submit]);

  const scan = async () => {
    setMsg(null);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setScanning(true);
      const v = video.current!; v.srcObject = stream.current; await v.play();
      const det = new (window as unknown as { BarcodeDetector: new (o: object) => Detector }).BarcodeDetector({ formats: ['qr_code'] });
      const tick = async () => {
        if (!stream.current) return;
        try { const r = await det.detect(v); if (r[0]?.rawValue) { await submit(r[0].rawValue); if (!stream.current) return; } } catch { /* frame not ready */ }
        setTimeout(tick, 400);
      };
      tick();
    } catch { stop(); setMsg({ tone: 'bad', text: 'The camera could not start. Type the code shown under the QR instead.' }); }
  };

  if (!open) return <Button variant="primary" size="lg" leftIcon={<QrCode size={18} />} onClick={() => setOpen(true)}>Check in to class</Button>;
  return (
    <section aria-label="Check in to class" className="flex flex-col gap-3 rounded-2xl bg-surface p-5 shadow-[0_1px_3px_rgba(16,24,40,.06)]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Check in to class</h2>
        <Button variant="quiet" size="sm" onClick={() => { stop(); setOpen(false); setMsg(null); }}>Close</Button>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {canScan && <video ref={video} playsInline muted className={scanning ? 'aspect-square w-full max-w-[320px] rounded-xl bg-black object-cover' : 'hidden'} />}
      {canScan && (scanning
        ? <Button variant="secondary" onClick={stop}>Stop camera</Button>
        : <Button variant="secondary" size="lg" leftIcon={<ScanLine size={18} />} onClick={scan}>Scan the QR</Button>)}
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); submit(code); }}>
        <label className="flex flex-col gap-1 text-[13px] font-medium text-text2">{canScan ? 'Or type the code under the QR' : 'Type the code under the QR'}
          <input aria-label="Check-in code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} autoComplete="off" autoCapitalize="characters" spellCheck={false}
            className="h-12 w-[180px] rounded-[10px] px-3 text-center font-mono text-[20px] tracking-[0.3em]" placeholder="ABC123" />
        </label>
        <Button variant="primary" size="lg" type="submit" loading={busy} disabled={busy}>Check in</Button>
      </form>
    </section>
  );
}
