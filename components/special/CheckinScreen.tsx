'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { supabase } from '@/lib/supabase';
import { Button, Notice } from '../ui';

// Full-screen check-in for today's class. The code (and QR) changes every 30 seconds; the database signs it.
// Students scan it in the portal or type the 6-character code. Count and arrivals refresh every 3 seconds.
type Live = { active: boolean; code: string | null; seconds_left: number; total: number; present: number; arrived: { name: string; at: string }[] };

export function CheckinScreen({ batchId, batchCode, onClose }: { batchId: string; batchCode: string; onClose: () => void }) {
  const [sid, setSid] = useState<string | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [svg, setSvg] = useState('');
  const [err, setErr] = useState('');
  const [left, setLeft] = useState(30);
  const shownCode = useRef('');

  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return; // open exactly one session (React may run effects twice in development)
    opened.current = true;
    supabase().rpc('open_checkin', { p_batch: batchId }).then(({ data, error }) => (error ? setErr(error.message) : setSid(data as string)));
  }, [batchId]);

  const poll = useCallback(async () => {
    if (!sid) return;
    const { data, error } = await supabase().rpc('current_checkin_token', { p_session: sid });
    if (error) { setErr(error.message); return; }
    const d = data as Live;
    setLive(d); setLeft(d.seconds_left);
    if (d.code && d.code !== shownCode.current) {
      shownCode.current = d.code;
      setSvg(await QRCode.toString(`${window.location.origin}/portal?checkin=${d.code}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0B1220', light: '#FFFFFF' } }));
    }
  }, [sid]);
  useEffect(() => { poll(); const t = setInterval(poll, 3000); return () => clearInterval(t); }, [poll]);
  useEffect(() => { const t = setInterval(() => setLeft((v) => (v > 0 ? v - 1 : 0)), 1000); return () => clearInterval(t); }, []);

  const stop = async () => { if (sid) await supabase().rpc('close_checkin', { p_session: sid }); onClose(); };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') stop(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); });

  return (
    <div role="dialog" aria-modal="true" aria-label={`Check-in for ${batchCode}`} className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-bg p-4 md:p-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold">Check in · {batchCode}</h2>
          <p className="text-[13px] text-text2">Students: open the Stint student portal, tap Check in to class, scan this or type the code.</p>
        </div>
        <Button variant="primary" size="lg" onClick={stop}>Stop</Button>
      </div>
      {err && <div className="mt-4"><Notice tone="bad">{err}</Notice></div>}
      {live && !live.active && <div className="mt-4"><Notice tone="warn">This check-in has ended (it was stopped, replaced on another screen, or the day changed). Close and open a new one.</Notice></div>}
      <div className="mt-6 flex flex-1 flex-col items-center gap-6 lg:flex-row lg:items-start lg:justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="aspect-square w-[min(80vw,440px)] rounded-2xl bg-white p-3 shadow-1 [&>svg]:h-full [&>svg]:w-full" aria-label="Check-in QR code" role="img"
            dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="font-mono text-[36px] font-semibold tracking-[0.3em]" data-testid="checkin-code">{live?.code || '······'}</p>
          <div className="h-1.5 w-[min(80vw,440px)] overflow-hidden rounded-full bg-surface2" aria-hidden>
            <div className="h-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${(left / 30) * 100}%` }} />
          </div>
          <p className="text-xs text-muted">New code in {left}s. A code works for up to 60 seconds.</p>
        </div>
        <section aria-label="Arrivals" className="w-full max-w-[360px] rounded-card bg-surface p-card shadow-1">
          <p className="text-[22px] font-semibold" aria-live="polite" data-testid="checkin-count">{live ? `${live.present} of ${live.total} checked in` : 'Starting…'}</p>
          <p className="text-xs text-muted">Counts everyone marked present or late today, including marks made by hand.</p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {(live?.arrived || []).map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-[14px]"><span className="truncate">{a.name}</span>
                <span className="num text-xs text-muted">{new Date(a.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span></li>
            ))}
            {live && !live.arrived.length && <li className="text-[13px] text-text2">No one has scanned yet.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
