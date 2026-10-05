'use client';
import { useRef, useState } from 'react';
import { ChevronRight, FileText, Folder } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Pill, cx } from '../ui';

export type TreeFile = { id: string; name: string; path: string | null; status?: string | null; note?: string };
export type TreeFolder = { id: string; name: string; files: TreeFile[] };

const BUCKET = 'candidate-files';

/** Folders of candidate files. Arrow keys move, Right/Left open/close, Enter opens a file in a new tab (one-minute link). */
export function FileTree({ folders, label = 'Files' }: { folders: TreeFolder[]; label?: string }) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(folders.map((f) => [f.id, true])));
  const [focus, setFocus] = useState(folders[0]?.id || '');
  const [err, setErr] = useState<string | null>(null);
  const tree = useRef<HTMLUListElement>(null);

  const openFile = async (f: TreeFile) => {
    if (!f.path) return;
    setErr(null);
    const w = window.open('', '_blank');
    const { data, error } = await supabase().storage.from(BUCKET).createSignedUrl(f.path, 60);
    if (error || !data) { w?.close(); setErr('Could not open ' + f.name + '.'); return; }
    if (w) w.location.href = data.signedUrl; else window.location.href = data.signedUrl;
  };

  // visible items in order, for arrow keys
  const visible = folders.flatMap((d) => [d.id, ...(open[d.id] ? d.files.map((f) => f.id) : [])]);
  const move = (id: string) => { setFocus(id); tree.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)?.focus(); };

  const onKey = (e: React.KeyboardEvent, id: string, folder?: TreeFolder, file?: TreeFile, parent?: string) => {
    const i = visible.indexOf(id);
    if (e.key === 'ArrowDown' && i < visible.length - 1) move(visible[i + 1]);
    else if (e.key === 'ArrowUp' && i > 0) move(visible[i - 1]);
    else if (e.key === 'Home') move(visible[0]);
    else if (e.key === 'End') move(visible[visible.length - 1]);
    else if (e.key === 'ArrowRight' && folder) { if (!open[folder.id]) setOpen({ ...open, [folder.id]: true }); else if (folder.files[0]) move(folder.files[0].id); }
    else if (e.key === 'ArrowLeft') { if (folder && open[folder.id]) setOpen({ ...open, [folder.id]: false }); else if (parent) move(parent); }
    else if (e.key === 'Enter' || e.key === ' ') { if (folder) setOpen({ ...open, [folder.id]: !open[folder.id] }); else if (file) openFile(file); }
    else return;
    e.preventDefault(); e.stopPropagation();
  };

  return (
    <div className="flex flex-col gap-2">
      <ul ref={tree} role="tree" aria-label={label} className="flex flex-col gap-1">
        {folders.map((d) => (
          <li key={d.id} role="treeitem" aria-expanded={!!open[d.id]} aria-selected={focus === d.id} data-id={d.id} tabIndex={focus === d.id ? 0 : -1}
            onKeyDown={(e) => onKey(e, d.id, d)} onFocus={(e) => { if (e.target === e.currentTarget) setFocus(d.id); }} className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <div onClick={() => { setFocus(d.id); setOpen({ ...open, [d.id]: !open[d.id] }); }} className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-semibold text-text transition-colors duration-150 hover:bg-surface2">
              <ChevronRight size={15} className={cx('shrink-0 text-muted transition-transform', open[d.id] && 'rotate-90')} />
              <Folder size={15} className="shrink-0 text-accentText" />
              <span className="min-w-0 flex-1 truncate" title={d.name}>{d.name}</span>
              <span className="ui-count">{d.files.filter((f) => f.path).length} of {d.files.length}</span>
            </div>
            {open[d.id] && (
              <ul role="group" className="ml-[18px] flex flex-col border-l border-line pl-2">
                {d.files.length === 0 && <li role="none" className="flex min-h-[44px] items-center px-2 text-sm text-muted">Nothing here yet</li>}
                {d.files.map((f) => (
                  <li key={f.id} role="treeitem" aria-selected={focus === f.id} aria-disabled={!f.path} data-id={f.id} tabIndex={focus === f.id ? 0 : -1}
                    onKeyDown={(e) => onKey(e, f.id, undefined, f, d.id)} onFocus={() => setFocus(f.id)} onClick={() => { setFocus(f.id); openFile(f); }}
                    className={cx('flex min-h-[44px] items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent', f.path ? 'cursor-pointer text-text hover:bg-surface2' : 'text-muted')}>
                    <FileText size={14} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate" title={f.name + (f.note ? ' · ' + f.note : '')}>{f.name}{f.note && <span className="ml-2 text-xs text-muted">{f.note}</span>}</span>
                    {f.path || (f.status && f.status !== 'Missing') ? (f.status && <Pill>{f.status}</Pill>) : <span className="text-xs italic">Not uploaded</span>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {err && <div role="alert" className="text-[13px] font-medium text-badText">{err}</div>}
    </div>
  );
}
