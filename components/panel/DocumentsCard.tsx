'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { fmtDate } from '../ui';
import { Chip, CardRow, MiniMeter, RailCard } from './RailCard';

/** Problems first, then received (waiting for a check), then verified. */
const rank = (status: string) => (status === 'Rejected' ? 0 : status === 'Missing' ? 1 : status === 'Received' ? 2 : status === 'Verified' ? 4 : 3);

function StatusChip({ status }: { status: string }) {
  if (status === 'Verified') return <Chip tone="good">Verified</Chip>;
  if (status === 'Received') return <Chip tone="info">Received</Chip>;
  if (status === 'Missing') return <Chip tone="bad">Not in yet</Chip>;
  if (status === 'Rejected') return <Chip tone="bad">Rejected</Chip>;
  return <Chip tone="plain">{status}</Chip>;
}

/** Candidate's own documents (candidate_document only; job papers are a different thing). */
export function DocumentsCard({ candidateId, open, onToggle, reloadKey }: { candidateId: string; open: boolean; onToggle: (id: string) => void; reloadKey?: number }) {
  const s = useSession();
  const canRead = s.can('doc');
  const [docs, setDocs] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!canRead) return;
    let stale = false;
    (async () => {
      const db = supabase();
      let res = await db.from('candidate_document').select('*, verifier:verified_by(full_name)').eq('candidate_id', candidateId);
      // If the staff name cannot be joined for this role, still show the documents.
      if (res.error) res = await db.from('candidate_document').select('*').eq('candidate_id', candidateId);
      if (!stale) setDocs((res.data as Row[] | null) || []);
    })();
    return () => { stale = true; };
  }, [candidateId, reloadKey, canRead]);

  if (!canRead || !docs || docs.length === 0) return null;

  const total = docs.length;
  const inCount = docs.filter((d) => d.status !== 'Missing').length;
  const rejected = docs.filter((d) => d.status === 'Rejected').length;
  const sorted = [...docs].sort((a, b) => rank(String(a.status)) - rank(String(b.status)) || String(a.doc_type).localeCompare(String(b.doc_type)));

  const summary = <>
    <span className="t num">{inCount} of {total} in</span>
    {rejected > 0 ? <Chip tone="bad">{rejected} rejected</Chip> : <MiniMeter value={inCount} max={total} />}
  </>;

  return (
    <RailCard id="docs" label="Documents" testId="card-docs" summary={summary} open={open} onToggle={onToggle}>
      <div>
        {sorted.map((d) => {
          const who = (d.verifier as Row | null | undefined)?.full_name as string | undefined;
          const sub = d.status === 'Verified' && d.verified_at
            ? 'Checked' + (who ? ' by ' + who.split(' ')[0] : '') + ' · ' + fmtDate(d.verified_at)
            : d.status === 'Rejected' && d.reject_reason ? String(d.reject_reason) : undefined;
          return <CardRow key={String(d.id)} title={String(d.doc_type)} sub={sub} right={<StatusChip status={String(d.status)} />} />;
        })}
      </div>
      <Link href={`/candidate/${candidateId}#sec-Documents`} className="mt-2 inline-block text-[12.5px] font-medium text-accentText underline-offset-4 hover:underline">Open documents</Link>
    </RailCard>
  );
}
