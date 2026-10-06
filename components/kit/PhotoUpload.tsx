'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageUp, RotateCw, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, IconButton } from '../ui';
import { Avatar, photosChanged } from './Avatar';

const MAX_IN = 10 * 1024 * 1024;
const OUT = 512;
const VIEW = 280;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';

type Kind = 'staff' | 'candidate';
type Img = { bmp: ImageBitmap; w: number; h: number };

/** Draw the cropped photo into a square canvas of `size` px. x/y are pan offsets in viewport px. */
function draw(ctx: CanvasRenderingContext2D, size: number, img: Img, zoom: number, rot: number, x: number, y: number) {
  const k = size / VIEW;
  const sideways = rot % 180 !== 0;
  const base = VIEW / Math.min(sideways ? img.h : img.w, sideways ? img.w : img.h);
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2 + x * k, size / 2 + y * k);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.scale(base * zoom * k, base * zoom * k);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img.bmp, -img.w / 2, -img.h / 2);
  ctx.restore();
}

function limits(img: Img, zoom: number, rot: number) {
  const sideways = rot % 180 !== 0;
  const ew = sideways ? img.h : img.w, eh = sideways ? img.w : img.h;
  const s = (VIEW / Math.min(ew, eh)) * zoom;
  return { mx: Math.max(0, (ew * s - VIEW) / 2), my: Math.max(0, (eh * s - VIEW) / 2) };
}
const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));

/**
 * Change or remove a profile photo. Click the face to open.
 * The photo is re-drawn on a canvas, so location and camera details in the original file are never uploaded.
 */
export function PhotoUpload({ kind, id, name, photo, canEdit, onChange, size = 'xl', label }: {
  kind: Kind; id: string; name: string; photo: string | null | undefined; canEdit: boolean; onChange?: (path: string | null) => void;
  size?: 'lg' | 'xl'; label?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!canEdit) return <Avatar name={name} id={id} photo={photo ?? null} size={size} />;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={label || (photo ? 'Change photo of ' + name : 'Add photo of ' + name)} data-testid="photo-open"
        className="group relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2">
        <Avatar name={name} id={id} photo={photo ?? null} size={size} />
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden><ImageUp size={18} /></span>
      </button>
      {open && <PhotoDialog kind={kind} id={id} name={name} photo={photo ?? null} onClose={() => setOpen(false)} onChange={(p) => { onChange?.(p); photosChanged(); }} />}
    </>
  );
}

export function PhotoDialog({ kind, id, name, photo, onClose, onChange }: {
  kind: Kind; id: string; name: string; photo: string | null; onClose: () => void; onChange: (path: string | null) => void;
}) {
  const [img, setImg] = useState<Img | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState<'' | 'save' | 'remove' | 'open'>('');
  const [err, setErr] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('keydown', esc); prev?.focus(); };
  }, [onClose]);

  // keep the photo covering the circle whatever the zoom / rotation
  const setView = useCallback((z: number, r: number, x: number, y: number) => {
    if (!img) return;
    const zz = Math.max(1, Math.min(4, z));
    const { mx, my } = limits(img, zz, r);
    setZoom(zz); setRot(r); setPos({ x: clamp(x, mx), y: clamp(y, my) });
  }, [img]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = VIEW * dpr; c.height = VIEW * dpr;
    draw(c.getContext('2d')!, VIEW * dpr, img, zoom, rot, pos.x, pos.y);
  }, [img, zoom, rot, pos]);

  const pick = async (f: File | undefined) => {
    setErr('');
    if (!f) return;
    if (f.size > MAX_IN) { setErr('This photo is bigger than 10 MB. Pick a smaller one.'); return; }
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(f.type) && !/\.(heic|heif)$/i.test(f.name)) { setErr('Pick a JPG, PNG or WebP photo.'); return; }
    setBusy('open');
    try {
      const bmp = await createImageBitmap(f); // follows the camera's rotation tag
      setImg({ bmp, w: bmp.width, h: bmp.height }); setZoom(1); setRot(0); setPos({ x: 0, y: 0 });
    } catch {
      setErr(/heic|heif/i.test(f.type + f.name) ? 'This browser cannot open HEIC photos. Save it as JPG and try again.' : 'This photo could not be opened. Try another one.');
    } finally { setBusy(''); }
  };

  const save = async () => {
    if (!img) return;
    setBusy('save'); setErr('');
    try {
      const c = document.createElement('canvas');
      c.width = OUT; c.height = OUT;
      draw(c.getContext('2d')!, OUT, img, zoom, rot, pos.x, pos.y);
      let blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.86));
      if (!blob || blob.type !== 'image/webp') blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.88));
      if (!blob) throw new Error('Could not prepare the photo.');
      const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
      const path = `${kind}/${id}/${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}.${ext}`;
      const db = supabase();
      const up = await db.storage.from('photos').upload(path, blob, { contentType: blob.type, upsert: false });
      if (up.error) throw up.error;
      const set = await db.rpc('set_photo', { p_kind: kind, p_id: id, p_path: path });
      if (set.error) { await db.storage.from('photos').remove([path]); throw set.error; }
      if (photo) await db.storage.from('photos').remove([photo]);
      onChange(path); onClose();
    } catch (e) { setErr((e as Error).message || 'Could not save the photo.'); setBusy(''); }
  };

  const remove = async () => {
    setBusy('remove'); setErr('');
    const db = supabase();
    const set = await db.rpc('set_photo', { p_kind: kind, p_id: id, p_path: null });
    if (set.error) { setErr(set.error.message); setBusy(''); return; }
    if (photo) await db.storage.from('photos').remove([photo]);
    onChange(null); onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 30 : 8;
    const map: Record<string, () => void> = {
      ArrowLeft: () => setView(zoom, rot, pos.x - step, pos.y), ArrowRight: () => setView(zoom, rot, pos.x + step, pos.y),
      ArrowUp: () => setView(zoom, rot, pos.x, pos.y - step), ArrowDown: () => setView(zoom, rot, pos.x, pos.y + step),
      '+': () => setView(zoom + 0.1, rot, pos.x, pos.y), '=': () => setView(zoom + 0.1, rot, pos.x, pos.y), '-': () => setView(zoom - 0.1, rot, pos.x, pos.y),
      r: () => setView(zoom, (rot + 90) % 360, pos.x, pos.y),
    };
    const f = map[e.key];
    if (f) { e.preventDefault(); f(); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-label={'Photo of ' + name} data-testid="photo-dialog"
        className="anim-rise w-full max-w-[400px] rounded-t-2xl border border-line bg-surface p-4 shadow-2xl sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Photo of {name}</h2>
          <IconButton aria-label="Close" icon={<X size={18} />} onClick={onClose} />
        </div>

        {!img ? (
          <div className="flex flex-col items-center gap-3 py-2">
            <Avatar name={name} id={id} photo={photo} size="xl" />
            <p className="text-center text-[13px] text-text2">Pick a clear, front-facing photo. You can crop it next.<br /><span className="text-muted">JPG, PNG or WebP, up to 10 MB.</span></p>
            <input ref={file} type="file" accept={ACCEPT} className="sr-only" data-testid="photo-file" aria-label="Choose photo" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
            <Button variant="primary" fullWidth leftIcon={<ImageUp size={16} />} loading={busy === 'open'} onClick={() => file.current?.click()}>{photo ? 'Choose a new photo' : 'Choose a photo'}</Button>
            {photo && <Button variant="ghost" fullWidth leftIcon={<Trash2 size={16} />} loading={busy === 'remove'} onClick={remove} data-testid="photo-remove">Remove photo</Button>}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div tabIndex={0} role="application" aria-label="Crop area. Drag or use arrow keys to move, plus and minus to zoom, R to rotate."
              onKeyDown={onKey}
              onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y }; }}
              onPointerMove={(e) => { const d = drag.current; if (d) setView(zoom, rot, d.x + e.clientX - d.px, d.y + e.clientY - d.py); }}
              onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
              onWheel={(e) => setView(zoom - e.deltaY * 0.002, rot, pos.x, pos.y)}
              className="relative cursor-grab touch-none select-none overflow-hidden rounded-xl bg-surface2 outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
              style={{ width: VIEW, height: VIEW }}>
              <canvas ref={canvas} style={{ width: VIEW, height: VIEW }} />
              <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full" style={{ boxShadow: '0 0 0 400px rgba(0,0,0,0.5)' }} />
              <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/80" />
            </div>
            <div className="flex w-full items-center gap-2">
              <IconButton aria-label="Zoom out" icon={<ZoomOut size={17} />} onClick={() => setView(zoom - 0.2, rot, pos.x, pos.y)} />
              <input type="range" min={1} max={4} step={0.01} value={zoom} aria-label="Zoom" onChange={(e) => setView(Number(e.target.value), rot, pos.x, pos.y)} className="h-11 flex-1 accent-[var(--accent,#4474B9)]" />
              <IconButton aria-label="Zoom in" icon={<ZoomIn size={17} />} onClick={() => setView(zoom + 0.2, rot, pos.x, pos.y)} />
              <IconButton aria-label="Rotate" icon={<RotateCw size={17} />} onClick={() => setView(zoom, (rot + 90) % 360, pos.x, pos.y)} />
            </div>
            <div className="flex w-full gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => { setImg(null); setErr(''); }}>Pick another</Button>
              <Button variant="primary" className="flex-1" loading={busy === 'save'} onClick={save} data-testid="photo-save">Save photo</Button>
            </div>
          </div>
        )}
        {err && <p role="alert" className="mt-3 rounded-lg bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B91C1C] dark:bg-[#3B1414] dark:text-[#FCA5A5]">{err}</p>}
      </div>
    </div>
  );
}

/** Student portal: the signed-in student's own photo, with change / remove. */
export function PortalPhoto({ id, name }: { id: string; name: string }) {
  const [photo, setPhoto] = useState<string | null | undefined>(undefined);
  useEffect(() => { void supabase().rpc('portal_photo').then(({ data }: { data: string | null }) => setPhoto(data ?? null)); }, []);
  if (photo === undefined) return <Avatar name={name} id={id} photo={null} size="xl" />;
  return <PhotoUpload kind="candidate" id={id} name={name} photo={photo} canEdit onChange={setPhoto} label={photo ? 'Change my photo' : 'Add my photo'} />;
}
