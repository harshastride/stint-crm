'use client';
import { Star } from 'lucide-react';
import { cx, fmtDate } from '../ui';

type Review = { id?: string; rating?: number | null; verdict?: string | null; comments?: string | null; created_at?: string; sme?: { full_name?: string } | null };

// Average SME rating out of 5, how ratings spread, mock pass/fail and the latest comments.
export function RatingSummary({ reviews, mocks = [] }: { reviews: Review[]; mocks?: { status?: string }[] }) {
  const rated = reviews.filter((r) => typeof r.rating === 'number' && r.rating! > 0);
  const avg = rated.length ? rated.reduce((a, r) => a + (r.rating || 0), 0) / rated.length : 0;
  const passed = mocks.filter((m) => m.status === 'Passed').length, failed = mocks.filter((m) => m.status === 'Failed').length;
  const latest = [...reviews].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).filter((r) => r.comments).slice(0, 3);
  return (
    <section className="border-t border-line pt-4 first:border-0 first:pt-0" aria-label="Rating summary">
      <h2 className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Mock and SME rating</h2>
      <div className="flex flex-wrap items-center gap-5">
        <div>
          <div className="num text-[32px] font-semibold leading-none">{avg ? avg.toFixed(1) : '—'}<span className="text-[14px] text-muted"> / 5</span></div>
          <div className="mt-1 flex" aria-label={`${avg.toFixed(1)} out of 5 stars`}>
            {[1, 2, 3, 4, 5].map((i) => <Star key={i} size={16} className={i <= Math.round(avg) ? 'fill-[#F59E0B] text-[#F59E0B]' : 'text-line'} />)}
          </div>
          <div className="mt-1 text-[12px] text-text2">{rated.length} review{rated.length === 1 ? '' : 's'}</div>
        </div>
        <div className="min-w-[160px] flex-1 space-y-1">
          {[5, 4, 3, 2, 1].map((n) => {
            const k = rated.filter((r) => r.rating === n).length, pct = rated.length ? Math.round((100 * k) / rated.length) : 0;
            return (
              <div key={n} className="flex items-center gap-2 text-[12px]">
                <span className="w-3 text-text2">{n}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface2"><div className="h-full rounded-full bg-[#F59E0B]" style={{ width: pct + '%' }} /></div>
                <span className="num w-5 text-right text-muted">{k}</span>
              </div>
            );
          })}
        </div>
        {(passed > 0 || failed > 0) && (
          <div className="flex gap-2 text-[12.5px]">
            <span className={cx('rounded-full px-2.5 py-1 font-semibold', passed > 0 ? 'bg-goodBg text-goodText' : 'bg-surface2 text-muted')}>{passed} passed</span>
            <span className={cx('rounded-full px-2.5 py-1 font-semibold', failed > 0 ? 'bg-[rgba(220,38,38,0.12)] text-[#DC2626]' : 'bg-surface2 text-muted')}>{failed} failed</span>
          </div>
        )}
      </div>
      {latest.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-line pt-3">
          {latest.map((r, i) => (
            <li key={r.id || i} className="text-[13px]">
              <p className="text-text">“{r.comments}”</p>
              <p className="mt-0.5 text-[12px] text-muted">{[r.sme?.full_name, r.rating ? r.rating + '/5' : '', r.verdict, fmtDate(r.created_at)].filter(Boolean).join(' · ')}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
