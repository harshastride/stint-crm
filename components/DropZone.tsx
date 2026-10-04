'use client';
import { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { cx } from './ui';

/** Drop a file here or tap to choose one. Checks type and size before handing it over. */
export function DropZone({ onFile, accept, hint, busy, disabled, label = 'Drop a file here, or tap to choose', maxMb = 20 }: {
  onFile: (f: File) => void; accept: string; hint?: string; busy?: boolean; disabled?: boolean; label?: string; maxMb?: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const take = (f?: File | null) => {
    setErr(null);
    if (!f) return;
    const ok = accept.split(',').map((a) => a.trim().toLowerCase()).some((a) => a.startsWith('.') ? f.name.toLowerCase().endsWith(a) : a.endsWith('/*') ? f.type.startsWith(a.slice(0, -1)) : f.type === a);
    if (!ok) { setErr('That type of file isn’t accepted here.'); return; }
    if (f.size > maxMb * 1024 * 1024) { setErr(`That file is over ${maxMb} MB.`); return; }
    onFile(f);
  };
  return (
    <div className="flex flex-col gap-1">
      <button type="button" disabled={disabled || busy} onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled && !busy) take(e.dataTransfer.files?.[0]); }}
        className={cx('flex min-h-[92px] w-full flex-col items-center justify-center gap-1.5 rounded-[12px] border-2 border-dashed px-4 py-4 text-center transition-colors disabled:opacity-60',
          over ? 'border-accent bg-accentSoft' : 'border-line2 bg-surface hover:border-accent/60')}>
        <UploadCloud size={22} className={over ? 'text-accentText' : 'text-muted'} aria-hidden />
        <span className="text-[13px] font-semibold text-text">{busy ? 'Uploading…' : over ? 'Drop to upload' : label}</span>
        {hint && <span className="text-[11.5px] text-muted">{hint}</span>}
        {busy && <span className="mt-1 h-1 w-32 overflow-hidden rounded-full bg-surface2"><span className="block h-full w-1/3 animate-[slide_1s_ease-in-out_infinite] rounded-full bg-accent" /></span>}
      </button>
      <input ref={input} type="file" hidden accept={accept} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; take(f); }} />
      {err && <div role="alert" className="text-[13px] font-medium text-badText">{err}</div>}
    </div>
  );
}
