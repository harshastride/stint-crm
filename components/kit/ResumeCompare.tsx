'use client';
import { useEffect, useRef, useState } from 'react';
import { Columns2, Download, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Pill, fmtDate } from '../ui';

export type ResumeVersion = { id: string; version: string; status: string; reason?: string | null; reviewer?: string | null; created_at: string; file_path: string | null };
type Version = ResumeVersion;

const BUCKET = 'candidate-files';
const fileName = (path: string) => path.split('/').pop()!.replace(/^[0-9a-f-]{36}-/, '');
const kind = (path: string) => (/\.pdf$/i.test(path) ? 'pdf' : /\.(png|jpe?g|gif|webp)$/i.test(path) ? 'img' : 'other');

/** Shows one version's file (PDF, photo, or a download link) with its review details. */
function Pane({ versions, value, onPick, label }: { versions: Version[]; value: string; onPick: (id: string) => void; label: string }) {
  const v = versions.find((x) => x.id === value);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null); setErr(null);
    if (!v?.file_path) return;
    let live = true;
    supabase().storage.from(BUCKET).createSignedUrl(v.file_path, 300).then(({ data, error }) => {
      if (!live) return;
      if (error || !data) setErr('Could not open this file.'); else setUrl(data.signedUrl);
    });
    return () => { live = false; };
  }, [v?.file_path]);

  return (
    <section aria-label={label} className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      <label className="flex flex-col gap-1 text-xs font-medium text-text2">{label}
        <select value={value} onChange={(e) => onPick(e.target.value)} className="min-h-[44px] rounded-[10px] border border-line2 bg-surface px-3 text-sm text-text">
          {versions.map((x) => <option key={x.id} value={x.id}>{x.version} · {fmtDate(x.created_at)}</option>)}
        </select>
      </label>
      <div className="relative min-h-[50vh] flex-1 overflow-hidden rounded-xl border border-line bg-surface2 md:min-h-0">
        {!v?.file_path ? <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-muted">No file attached to this version</div>
          : err ? <div role="alert" className="p-4 text-sm text-badText">{err}</div>
          : !url ? <div className="p-4 text-sm text-muted">Opening…</div>
          : kind(v.file_path) === 'pdf' ? <iframe title={`${label}: ${fileName(v.file_path)}`} src={url} className="absolute inset-0 h-full w-full" />
          : kind(v.file_path) === 'img' ? <img src={url} alt={`${label}: ${fileName(v.file_path)}`} className="absolute inset-0 h-full w-full object-contain" />
          : <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 p-4 text-sm text-text2">
              <span>This file type can’t be shown here.</span>
              <a href={url} className="flex min-h-[44px] items-center gap-1 rounded-lg border border-line2 bg-surface px-3 font-medium text-text"><Download size={14} /> Download {fileName(v.file_path)}</a>
            </div>}
      </div>
      {v && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
          <dt className="text-muted">Status</dt><dd><Pill>{v.status}</Pill></dd>
          <dt className="text-muted">Reviewer</dt><dd className="text-text">{v.reviewer || '—'}</dd>
          <dt className="text-muted">Reason</dt><dd className="text-text">{v.reason || '—'}</dd>
        </dl>
      )}
    </section>
  );
}

/** Button + full-screen overlay to see two resume versions of the same candidate side by side. Shows only when there are 2+ versions. */
export function ResumeCompareView({ versions, currentId, label = 'Compare with another version' }: { versions: ResumeVersion[]; currentId?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  const show = () => {
    const first = currentId && versions.some((v) => v.id === currentId) ? currentId : versions[0].id;
    setA(first); setB(versions.find((v) => v.id !== first)!.id); setOpen(true);
  };
  const close = () => { setOpen(false); opener.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    const el = box.current;
    el?.querySelector<HTMLElement>('button, select')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>('button, select, a[href], iframe, [tabindex]:not([tabindex="-1"])')];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = prev; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (versions.length < 2) return null;
  return (
    <>
      <button ref={opener} type="button" onClick={show} className="flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] border border-line2 bg-surface px-3 text-sm font-medium text-text hover:bg-surface2">
        <Columns2 size={15} /> {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex bg-[rgba(0,0,0,0.5)] p-2 md:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div ref={box} role="dialog" aria-modal="true" aria-label="Compare resume versions" className="anim-fade flex w-full flex-col gap-3 overflow-auto rounded-2xl border border-line bg-surface p-4 shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-text">Compare resume versions</h2>
              <button type="button" aria-label="Close" onClick={close} className="flex h-11 w-11 items-center justify-center rounded-lg text-text2 hover:bg-surface2"><X size={18} /></button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
              <Pane label="Left version" versions={versions} value={a} onPick={setA} />
              <Pane label="Right version" versions={versions} value={b} onPick={setB} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Staff wrapper: loads one candidate's resume versions and shows the compare button. */
export function ResumeCompare({ candidateId, currentId }: { candidateId: string; currentId?: string }) {
  const [versions, setVersions] = useState<ResumeVersion[]>([]);
  useEffect(() => {
    let live = true;
    supabase().from('resume_version').select('id, version, file_path, status, reason, created_at, reviewer:reviewer_id(full_name)')
      .eq('candidate_id', candidateId).order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!live) return;
        type R = Omit<ResumeVersion, 'reviewer'> & { reviewer?: { full_name: string } | null };
        setVersions(((data as unknown as R[]) || []).map((r) => ({ ...r, reviewer: r.reviewer?.full_name || null })));
      });
    return () => { live = false; };
  }, [candidateId]);
  return <ResumeCompareView versions={versions} currentId={currentId} />;
}
