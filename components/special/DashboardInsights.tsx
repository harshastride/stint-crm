'use client';
import Link from 'next/link';

// "Which channels bring leads that enrol?" Leads created this month by source, and how many of those
// same leads have become candidates. Numbers come from dashboard_metrics (computed in the database).
export type SourceRow = { name: string; leads: number; enrolled: number | null };

export function DashboardInsights({ sources, from, to }: { sources: SourceRow[]; from: string; to: string }) {
  const showEnrolled = sources.some((s) => s.enrolled != null);
  return (
    <section aria-label="Lead sources this month" data-testid="sources" className="rounded-card bg-surface px-4 py-3 shadow-1">
      <h2 className="text-[13px] font-semibold">Lead sources this month</h2>
      <p className="text-[11.5px] text-muted">Since the 1st, India time · top 6</p>
      {sources.length === 0
        ? <p className="mt-3 text-text2">No leads created this month yet.</p>
        : (
          <table className="mt-2 w-full text-[13px]">
            <thead><tr className="text-left text-[11.5px] uppercase tracking-wide text-muted">
              <th className="py-2 font-medium">Source</th><th className="py-2 text-right font-medium">Leads</th>{showEnrolled && <th className="py-2 text-right font-medium">Enrolled</th>}
            </tr></thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.name} className="border-t border-line">
                  <td className="py-0">
                    {s.name === 'No source'
                      ? <span className="flex min-h-[44px] items-center">{s.name}</span>
                      : <Link href={`/p/lead?from=${from}&to=${to}&f.source.name=${encodeURIComponent(s.name)}`} className="flex min-h-[44px] items-center text-accentText hover:underline">{s.name}</Link>}
                  </td>
                  <td className="num text-right font-semibold">{s.leads}</td>
                  {showEnrolled && <td className="num text-right text-text2">{s.enrolled ?? '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </section>
  );
}
