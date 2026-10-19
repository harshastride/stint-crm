'use client';
import { useEffect, useRef, useState } from 'react';
import { cx } from '../ui';

// A small live sound meter: proof that the microphone is actually hearing something.
// Bars follow the loudness (0–1); they are information, so they keep moving with reduced motion, just without easing.

const SHAPE = [0.5, 0.75, 1, 0.75, 0.5];

export function SoundBars({ level, className }: { level: number; className?: string }) {
  const quiet = level < 0.04;
  return (
    <span aria-hidden className={cx('inline-flex h-5 items-center gap-[3px]', className)}>
      {SHAPE.map((m, i) => (
        <span key={i}
          className={cx('w-[3px] rounded-full motion-safe:transition-[height] motion-safe:duration-75', quiet ? 'bg-line2' : 'bg-accent')}
          style={{ height: `${Math.round(4 + Math.min(1, level * 1.6) * m * 16)}px` }} />
      ))}
    </span>
  );
}

/** Loudness of a live microphone stream (0–1), about 15 times a second, and when sound was last heard. */
export function useSoundLevel(stream: MediaStream | null) {
  const [level, setLevel] = useState(0);
  const [heardAt, setHeardAt] = useState<number | null>(null);
  const last = useRef(0);
  useEffect(() => {
    if (!stream) { setLevel(0); return; }
    let raf = 0; let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
      const an = ctx.createAnalyser(); an.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const loop = (t: number) => {
        raf = requestAnimationFrame(loop);
        if (t - last.current < 66) return;
        last.current = t;
        an.getByteTimeDomainData(buf);
        let peak = 0; for (const b of buf) peak = Math.max(peak, Math.abs(b - 128));
        const lv = Math.min(1, peak / 64);
        setLevel(lv);
        if (lv > 0.08) setHeardAt(Date.now());
      };
      raf = requestAnimationFrame(loop);
    } catch { /* the meter is optional; listening still works without it */ }
    return () => { cancelAnimationFrame(raf); ctx?.close().catch(() => {}); setLevel(0); };
  }, [stream]);
  return { level, heardAt };
}
