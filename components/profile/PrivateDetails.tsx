'use client';
import { Lock } from 'lucide-react';
import type { Row } from '@/lib/pages';
import { Reveal } from '../kit/Reveal';
import { cx } from '../ui';

export const PRIVATE_GROUPS: [string, string][] = [['contact', 'Contact and address'], ['family', 'Family'], ['identity', 'Identity'], ['bank', 'Bank']];
const label = (k: string) => k.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());

/** One titled group of label/value rows. Empty values show a dash so missing data is visible, not hidden. */
export function DetailGroup({ title, tag, rows, className }: { title: string; tag?: 'Full' | 'Masked'; rows: [string, React.ReactNode][]; className?: string }) {
  return (
    <section className={cx('rounded-[10px] border border-line p-3', className)} aria-label={title}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {tag && <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', tag === 'Masked' ? 'bg-warnBg text-warnText' : 'bg-goodBg text-goodText')}>{tag === 'Masked' ? 'Masked for your role' : 'Full'}</span>}
      </div>
      {rows.length === 0 && <div className="text-[12.5px] text-muted">Nothing filled in yet.</div>}
      {rows.map(([l, v]) => (
        <div key={l} className="flex justify-between gap-3 border-t border-line py-1.5 text-[13px] first-of-type:border-0">
          <span className="shrink-0 text-muted">{l}</span>
          <span className="num min-w-0 break-words text-right font-medium">{v == null || v === '' ? <span className="text-muted">—</span> : v}</span>
        </div>
      ))}
    </section>
  );
}

/** Sensitive candidate details from candidate_private_get. Hidden groups are left out; masked contact can be revealed (logged). */
export function PrivateDetails({ id, priv, className }: { id: string; priv: Row | null; className?: string }) {
  if (!priv) return null;
  return (
    <>
      {priv.locked && <div className="flex items-center gap-2 rounded-[10px] bg-warnBg px-3 py-2 text-[12.5px] font-medium text-warnText" role="note"><Lock size={15} aria-hidden />{String(priv.locked)} — ask Admin</div>}
      {PRIVATE_GROUPS.filter(([g]) => priv.modes?.[g] && priv.modes[g] !== 'h').map(([g, title]) => (
        <DetailGroup key={g} className={className} title={title} tag={priv.modes[g] === 'm' ? 'Masked' : 'Full'}
          rows={Object.entries(priv[g] || {}).map(([k, v]) => [label(k), g === 'contact' && priv.modes[g] === 'm' && v
            ? <Reveal key={k} kind="candidate" id={id} field={k} label={k.replace(/_/g, ' ')} masked={String(v)} /> : v == null ? '' : String(v)])} />
      ))}
    </>
  );
}
