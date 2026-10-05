'use client';
import { useState } from 'react';
import { Download, Paperclip, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { DropZone } from './DropZone';
import { Button, IconButton } from './ui';

const BUCKET = 'candidate-files';
const fileName = (path: string) => path.split('/').pop()!.replace(/^[0-9a-f-]{36}-/, '');

/** Attach one file to a candidate record. Stored privately; downloads use a link that works for one minute. */
export function FileField({ page, candidateId, value, onChange, disabled }: { page: string; candidateId: string | null; value: unknown; onChange: (v: string | null) => void; disabled?: boolean }) {
  const path = typeof value === 'string' && value ? value : null;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const upload = async (f: File) => {
    if (!candidateId) return;
    if (f.size > 20 * 1024 * 1024) { setErr('That file is over 20 MB.'); return; }
    setBusy(true); setErr(null);
    const safe = f.name.replace(/[^\w.\- ]+/g, '_');
    const target = `${candidateId}/${page}/${crypto.randomUUID()}-${safe}`;
    const { error } = await supabase().storage.from(BUCKET).upload(target, f, { contentType: f.type || undefined });
    setBusy(false);
    if (error) { setErr(/row-level|security|403|Unauthorized/i.test(error.message) ? 'Your role can’t attach files here.' : error.message); return; }
    onChange(target);
  };

  const download = async () => {
    if (!path) return;
    const { data, error } = await supabase().storage.from(BUCKET).createSignedUrl(path, 60, { download: fileName(path) });
    if (error || !data) { setErr('Could not open the file. ' + (error?.message || '')); return; }
    window.location.href = data.signedUrl;
  };

  return (
    <div className="flex flex-col gap-1 font-normal">
      {path ? (
        <div className="flex min-h-10 items-center gap-2 rounded-[10px] bg-surface2 py-1 pl-3 pr-1 text-[13.5px] text-text">
          <Paperclip size={14} className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate">{fileName(path)}</span>
          <Button variant="quiet" size="sm" onClick={download} leftIcon={<Download size={14} />}>Download</Button>
          {!disabled && <IconButton aria-label="Remove file" size="icon-sm" onClick={() => onChange(null)} icon={<X size={14} />} />}
        </div>
      ) : disabled ? (
        <div className="flex min-h-10 items-center rounded-[10px] bg-surface2 px-3 text-[13.5px] text-muted">No file</div>
      ) : !candidateId ? (
        <div className="flex min-h-10 items-center rounded-[10px] border border-dashed border-line2 px-3 text-[13.5px] text-muted">Pick the candidate first</div>
      ) : (
        <DropZone accept=".pdf,.doc,.docx,image/*" hint="PDF, Word or photo · up to 20 MB" busy={busy} onFile={upload} />
      )}
      {err && <div role="alert" className="text-[13px] font-medium text-badText">{err}</div>}
    </div>
  );
}
