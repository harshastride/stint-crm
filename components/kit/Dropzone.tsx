'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { Camera, FileText, Image as ImageIcon, RefreshCw, Trash2, UploadCloud, X } from 'lucide-react';
import { Button, IconButton, cx } from '../ui';

// pdf.js is browser-only; the first page is drawn with the same viewer the preview window uses.
const PdfPages = dynamic(() => import('./PdfPages'), { ssr: false, loading: () => null });

// Some computers give Word files (and some photos) no type label; the files bucket only accepts known types,
// so before uploading, a missing label is filled in from the file name.
export const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', gif: 'image/gif',
};
export function withType(f: File): File {
  if (f.type) return f;
  const t = MIME_BY_EXT[f.name.split('.').pop()?.toLowerCase() || ''];
  return t ? new File([f], f.name, { type: t, lastModified: f.lastModified }) : f;
}

export type FileKind = 'pdf' | 'image' | 'word' | 'other';
export const fileKind = (name: string, type = ''): FileKind =>
  /pdf/.test(type) || /\.pdf$/i.test(name) ? 'pdf'
  : type.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(name) ? 'image'
  : /word|officedocument\.wordprocessing/.test(type) || /\.docx?$/i.test(name) ? 'word' : 'other';

export const fmtSize = (b: number) => (b >= 1024 * 1024 ? (b / 1024 / 1024).toFixed(1).replace(/\.0$/, '') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

/** Same rule as the input's `accept` list: ".pdf" matches the name, "image/*" the type family, "application/pdf" the exact type. */
export function acceptsFile(f: File, accept: string) {
  const name = f.name.toLowerCase(), type = (f.type || '').toLowerCase();
  return accept.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean)
    .some((a) => (a.startsWith('.') ? name.endsWith(a) : a.endsWith('/*') ? type.startsWith(a.slice(0, -1)) : type === a));
}

/** A plain reason the file can't be used, or null when it is fine. */
export function checkFile(f: File, accept: string, maxMb: number, typesLabel: string): string | null {
  if (!acceptsFile(f, accept)) return `That file can’t be attached here. ${typesLabel} only, up to ${maxMb} MB.`;
  if (f.size === 0) return 'That file is empty. Choose another copy.';
  if (f.size > maxMb * 1024 * 1024) return `That file is ${fmtSize(f.size)}. The limit is ${maxMb} MB. Save a smaller copy and try again.`;
  return null;
}

export type DropzoneFile = {
  name: string;
  size?: number;
  /** File contents for the small preview: a Blob, 'loading' while it is fetched, or null for an icon only. */
  thumb?: Blob | 'loading' | null;
  /** A short line under the name, e.g. "Attached. Save to keep it." */
  note?: ReactNode;
};

export type DropzoneUpload = { name: string; size: number; progress: number | null; onCancel?: () => void };

/**
 * Drag a file in, or click / tap to choose one. Checks type and size first, shows upload progress,
 * and once attached shows a small preview with replace and remove.
 * On phones the drop area becomes a big "Choose file" button, plus "Take a photo" when photos are allowed.
 */
export function Dropzone({ accept, maxMb, typesLabel, onFile, file, upload, error, onRemove, actions, disabled, label = 'Drop a file here, or click to choose', camera, id }: {
  accept: string; maxMb: number; typesLabel: string;
  /** Called with a file that passed the checks. */
  onFile: (f: File) => void;
  file?: DropzoneFile | null;
  upload?: DropzoneUpload | null;
  error?: string | null;
  onRemove?: () => void;
  /** Extra buttons on the attached file (e.g. Preview, Download). */
  actions?: ReactNode;
  disabled?: boolean; label?: string;
  /** Offer "Take a photo" on phones. Defaults to on when photos are accepted. */
  camera?: boolean;
  id?: string;
}) {
  const pick = useRef<HTMLInputElement>(null);
  const snap = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const depth = useRef(0);
  const busy = !!upload;
  const allowCamera = camera ?? /image\//.test(accept);
  const hint = `${typesLabel} · up to ${maxMb} MB`;
  const shown = localErr || error;

  useEffect(() => { if (error) setLocalErr(null); }, [error]);

  const take = (list: FileList | null | undefined) => {
    setLocalErr(null);
    if (!list || !list.length) return;
    if (list.length > 1) { setLocalErr('Drop one file at a time.'); return; }
    const f = list[0];
    const why = checkFile(f, accept, maxMb, typesLabel);
    if (why) { setLocalErr(why); return; }
    onFile(f);
  };
  const choose = () => { if (!disabled && !busy) pick.current?.click(); };

  const dropProps = {
    onDragEnter: (e: React.DragEvent) => { if (disabled || busy || !e.dataTransfer.types.includes('Files')) return; e.preventDefault(); depth.current++; setOver(true); },
    onDragOver: (e: React.DragEvent) => { if (disabled || busy || !e.dataTransfer.types.includes('Files')) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; },
    onDragLeave: () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); depth.current = 0; setOver(false); if (!disabled && !busy) take(e.dataTransfer.files); },
  };

  const inputs = (
    <>
      <input ref={pick} id={id} type="file" className="sr-only" tabIndex={-1} aria-hidden accept={accept} disabled={disabled || busy}
        onChange={(e) => { const l = e.target.files; take(l); e.target.value = ''; }} />
      {allowCamera && <input ref={snap} type="file" className="sr-only" tabIndex={-1} aria-hidden accept="image/*" capture="environment" disabled={disabled || busy}
        onChange={(e) => { const l = e.target.files; take(l); e.target.value = ''; }} />}
    </>
  );

  const err = shown && <div role="alert" className="text-[13px] font-medium text-badText">{shown}</div>;

  // 1. Uploading
  if (upload) {
    const pct = upload.progress;
    return (
      <div className="flex flex-col gap-1" data-testid="dropzone">
        <div className="flex items-center gap-3 rounded-card border border-line2 bg-surface2/60 p-3">
          <KindIcon kind={fileKind(upload.name)} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 text-[13.5px]">
              <span className="min-w-0 flex-1 truncate font-medium text-text" title={upload.name}>{upload.name}</span>
              <span className="shrink-0 tabular-nums text-text2" aria-hidden>{pct === null ? '' : pct >= 100 ? 'Finishing…' : pct + '%'}</span>
            </div>
            <div role="progressbar" aria-label={'Uploading ' + upload.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}
              aria-valuetext={pct === null ? 'Uploading' : pct >= 100 ? 'Finishing' : pct + ' percent'} className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-line">
              {pct === null
                ? <span className="block h-full w-1/3 animate-[slide_1s_ease-in-out_infinite] rounded-full bg-accent motion-reduce:w-full motion-reduce:animate-none" />
                : <span className="block h-full rounded-full bg-accent transition-[width] duration-200 motion-reduce:transition-none" style={{ width: Math.min(100, pct) + '%' }} />}
            </div>
            <div className="mt-1 text-[12px] text-muted">Uploading · {fmtSize(upload.size)}</div>
          </div>
          {upload.onCancel && <IconButton aria-label="Stop upload" size="icon-sm" onClick={upload.onCancel} icon={<X size={15} />} />}
        </div>
        {err}
      </div>
    );
  }

  // 2. A file is attached
  if (file) {
    const kind = fileKind(file.name, file.thumb instanceof Blob ? file.thumb.type : '');
    return (
      <div className="flex flex-col gap-1" data-testid="dropzone">
        <div {...dropProps} className={cx('flex flex-wrap items-center gap-3 rounded-card border p-2.5 transition-colors duration-150',
          over ? 'border-dashed border-accent bg-accentSoft' : 'border-line2 bg-surface2/60')}>
          <Thumb kind={kind} thumb={file.thumb ?? null} name={file.name} />
          <div className="min-w-0 flex-1 basis-[140px]">
            <div className="truncate text-[13.5px] font-medium text-text" title={file.name}>{over ? 'Drop to replace' : file.name}</div>
            <div className="text-[12px] text-muted">{[kindLabel(kind), file.size ? fmtSize(file.size) : ''].filter(Boolean).join(' · ')}</div>
            {file.note && <div className="mt-0.5 text-[12px] text-text2">{file.note}</div>}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {actions}
            {!disabled && <Button variant="outline" size="sm" onClick={choose} leftIcon={<RefreshCw size={14} />}>Replace</Button>}
            {!disabled && onRemove && <IconButton aria-label="Remove file" size="icon-sm" onClick={() => { setLocalErr(null); onRemove(); }} icon={<Trash2 size={15} />} />}
          </div>
        </div>
        {inputs}
        {err}
      </div>
    );
  }

  // 3. Empty
  return (
    <div className="flex flex-col gap-1" data-testid="dropzone">
      {/* larger screens: a drop area that is also a button */}
      <button type="button" disabled={disabled} onClick={choose} {...dropProps}
        className={cx('hidden min-h-[96px] w-full flex-col items-center justify-center gap-1.5 rounded-card border border-dashed px-4 py-4 text-center outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60 md:flex',
          over ? 'border-accent bg-accentSoft' : shown ? 'border-badText/60 bg-surface2/60 hover:bg-surface2' : 'border-line2 bg-surface2/60 hover:bg-surface2')}>
        <UploadCloud size={22} className={over ? 'text-accentText' : 'text-muted'} aria-hidden />
        <span className="text-[13px] font-semibold text-text">{over ? 'Drop to upload' : label}</span>
        <span className="text-[11.5px] text-muted">{hint}</span>
      </button>
      {/* phones: big buttons, no dragging needed */}
      <div className="flex flex-col gap-2 md:hidden">
        <Button variant="secondary" size="lg" fullWidth disabled={disabled} onClick={choose} leftIcon={<UploadCloud size={17} />}>Choose file</Button>
        {allowCamera && <Button variant="outline" size="lg" fullWidth disabled={disabled} onClick={() => snap.current?.click()} leftIcon={<Camera size={17} />}>Take a photo</Button>}
        <span className="text-center text-[12px] text-muted">{hint}</span>
      </div>
      {inputs}
      {err}
    </div>
  );
}

const kindLabel = (k: FileKind) => (k === 'pdf' ? 'PDF' : k === 'image' ? 'Photo' : k === 'word' ? 'Word' : 'File');

function KindIcon({ kind }: { kind: FileKind }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface text-muted" aria-hidden>
      {kind === 'image' ? <ImageIcon size={18} /> : <FileText size={18} />}
    </span>
  );
}

/** Small first look at the file: first page of a PDF, the photo itself, or an icon with the type. */
function Thumb({ kind, thumb, name }: { kind: FileKind; thumb: Blob | 'loading' | null; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const blob = thumb instanceof Blob ? thumb : null;
  useEffect(() => {
    setFailed(false);
    if (!blob || kind !== 'image') { setUrl(null); return; }
    const u = URL.createObjectURL(blob); setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob, kind]);

  const box = 'relative flex h-[68px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-surface';
  if (thumb === 'loading') return <span className={cx(box, 'animate-pulse bg-surface2 motion-reduce:animate-none')} aria-hidden />;
  if (blob && !failed && kind === 'image' && url) return <span className={box} aria-hidden><img src={url} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} /></span>;
  if (blob && !failed && kind === 'pdf') {
    return (
      <div ref={root} className={cx(box, 'pointer-events-none select-none bg-white [&_.react-pdf__Page__textContent]:hidden')} aria-hidden title={name}>
        <PdfPages blob={blob} pages={1} onPages={() => {}} onError={() => setFailed(true)} width={52} rotate={0} root={root} />
      </div>
    );
  }
  return (
    <span className={cx(box, 'flex-col gap-0.5 text-muted')} aria-hidden>
      {kind === 'image' ? <ImageIcon size={18} /> : <FileText size={18} />}
      <span className="text-[9.5px] font-semibold uppercase tracking-wide">{kind === 'other' ? (/\.(\w{1,4})$/.exec(name)?.[1] || 'file') : kindLabel(kind)}</span>
    </span>
  );
}
