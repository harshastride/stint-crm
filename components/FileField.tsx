'use client';
import { friendlyError } from '@/components/Fields';
import { useEffect, useRef, useState } from 'react';
import { Download, Eye } from 'lucide-react';
import { useFilePreview } from './kit/FilePreview';
import { Dropzone, fileKind, withType, type DropzoneUpload } from './kit/Dropzone';
import { supabase } from '@/lib/supabase';
import { Button, IconButton } from './ui';

const BUCKET = 'candidate-files';
// Must match the bucket: 20 MB (migration 010). The bucket has no type list, so the type check is here only.
const MAX_MB = 20;
const ACCEPT = '.pdf,.doc,.docx,image/*';
const TYPES = 'PDF, Word or photo';
// Small preview of a stored file is fetched only up to this size; bigger ones show an icon.
const THUMB_MAX = 8 * 1024 * 1024;
const fileName = (path: string) => path.split('/').pop()!.replace(/^[0-9a-f-]{36}-/, '');

class UploadError extends Error { constructor(message: string, public status = 0, public aborted = false) { super(message); } }

/** Same request the storage client makes (multipart, no overwrite), sent with XHR so we can show progress. */
async function send(path: string, file: File, onProgress: (pct: number) => void, hold: (abort: () => void) => void): Promise<void> {
  const f = withType(file);
  const db = supabase();
  const { data } = await db.auth.getSession();
  const token = data.session?.access_token;
  if (!token || typeof XMLHttpRequest === 'undefined') { // fall back to the plain client upload (no progress)
    const { error } = await db.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined });
    if (error) throw new UploadError(error.message);
    return;
  }
  const body = new FormData();
  body.append('cacheControl', '3600');
  body.append('', f);
  await new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', `${window.location.origin}/supabase/storage/v1/object/${BUCKET}/${path}`);
    x.setRequestHeader('apikey', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    x.setRequestHeader('authorization', 'Bearer ' + token);
    x.setRequestHeader('x-upsert', 'false');
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) return resolve();
      let msg = '';
      try { const j = JSON.parse(x.responseText); msg = String(j.message || j.error || ''); } catch { /* not JSON */ }
      reject(new UploadError(msg, x.status));
    };
    x.onerror = () => reject(new UploadError('Failed to fetch'));
    x.onabort = () => reject(new UploadError('', 0, true));
    hold(() => x.abort());
    x.send(body);
  });
}

function uploadMessage(e: UploadError) {
  if (e.status === 413 || /maximum allowed size|too large/i.test(e.message)) return `That file is over ${MAX_MB} MB. Save a smaller copy and try again.`;
  if (e.status === 403 || /row-level|security|Unauthorized/i.test(e.message)) return 'Your role can’t attach files here.';
  return friendlyError({ message: e.message }, 'files here', 'Could not attach the file. Please try again.');
}

/** Attach one file to a candidate record. Stored privately; downloads use a link that works for one minute. */
export function FileField({ page, candidateId, value, onChange, disabled }: { page: string; candidateId: string | null; value: unknown; onChange: (v: string | null) => void; disabled?: boolean }) {
  const path = typeof value === 'string' && value ? value : null;
  const [up, setUp] = useState<DropzoneUpload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // The file picked in this session, kept so its preview needs no download.
  const [local, setLocal] = useState<{ path: string; file: File } | null>(null);
  const [stored, setStored] = useState<{ path: string; thumb: Blob | 'loading' | null; size?: number } | null>(null);
  const abort = useRef<(() => void) | null>(null);
  const preview = useFilePreview();

  // Stop an upload still running if the panel closes.
  useEffect(() => () => abort.current?.(), []);

  // Small preview of a file already on the record (PDF and photos only).
  useEffect(() => {
    if (!path || local?.path === path || !['pdf', 'image'].includes(fileKind(path))) return;
    const ctl = new AbortController();
    setStored({ path, thumb: 'loading' });
    (async () => {
      const { data } = await supabase().storage.from(BUCKET).createSignedUrl(path, 60);
      if (!data?.signedUrl || ctl.signal.aborted) return;
      const res = await fetch(data.signedUrl, { signal: ctl.signal, credentials: 'same-origin' });
      const size = Number(res.headers.get('content-length')) || undefined;
      if (!res.ok || (size && size > THUMB_MAX)) { ctl.abort(); setStored({ path, thumb: null, size }); return; }
      const blob = await res.blob();
      if (!ctl.signal.aborted) setStored({ path, thumb: blob, size: blob.size });
    })().catch(() => { if (!ctl.signal.aborted) setStored({ path, thumb: null }); });
    return () => ctl.abort();
  }, [path, local?.path]);

  const upload = async (f: File) => {
    if (!candidateId) return;
    setErr(null);
    const safe = f.name.replace(/[^\w.\- ]+/g, '_');
    const target = `${candidateId}/${page}/${crypto.randomUUID()}-${safe}`;
    setUp({ name: f.name, size: f.size, progress: 0, onCancel: () => abort.current?.() });
    try {
      await send(target, f, (pct) => setUp((u) => (u ? { ...u, progress: pct } : u)), (a) => { abort.current = a; });
      setLocal({ path: target, file: f });
      onChange(target);
    } catch (e) {
      const ue = e instanceof UploadError ? e : new UploadError((e as Error)?.message || '');
      if (!ue.aborted) { console.error('file upload failed', ue.status, ue.message); setErr(uploadMessage(ue)); }
    } finally { abort.current = null; setUp(null); }
  };

  const download = async () => {
    if (!path) return;
    const { data, error } = await supabase().storage.from(BUCKET).createSignedUrl(path, 60, { download: fileName(path) });
    if (error || !data) { setErr('Could not open the file. Please try again.'); return; }
    window.location.href = data.signedUrl;
  };

  const signed = async () => {
    const { data, error } = await supabase().storage.from(BUCKET).createSignedUrl(path!, 60);
    if (error || !data) throw new Error('sign');
    return data.signedUrl;
  };
  const show = () => { if (path) preview.open({ title: fileName(path), fileName: fileName(path), getUrl: signed }); };

  if (!path && !up && disabled) return <div className="flex min-h-10 items-center rounded-[10px] bg-surface2 px-3 text-[13.5px] font-normal text-muted">No file</div>;
  if (!path && !up && !candidateId) return <div className="flex min-h-10 items-center rounded-[10px] border border-dashed border-line2 px-3 text-[13.5px] font-normal text-muted">Pick the candidate first</div>;

  const mine = local && local.path === path ? local.file : null;
  const thumb = mine ?? (stored?.path === path ? stored.thumb : null);
  return (
    <div className="font-normal">
      <Dropzone accept={ACCEPT} maxMb={MAX_MB} typesLabel={TYPES} disabled={disabled || !candidateId}
        onFile={upload} upload={up} error={err}
        file={path ? { name: fileName(path), size: mine?.size ?? (stored?.path === path ? stored.size : undefined), thumb, note: mine ? 'Attached. Press Save to keep it.' : undefined } : null}
        onRemove={() => { setErr(null); onChange(null); }}
        actions={path && <>
          <Button variant="primary" size="sm" onClick={show} leftIcon={<Eye size={14} />}>Preview</Button>
          <IconButton aria-label="Download" size="icon-sm" onClick={download} icon={<Download size={14} />} />
        </>} />
    </div>
  );
}
