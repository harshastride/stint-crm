'use client';
import { cx } from '../ui';

// A labelled progress bar: "₹40,000 of ₹60,000 paid", "3 of 5 documents".
export function Meter({ label, value, max, text, tone = 'accent', className }: { label: string; value: number; max: number; text?: string; tone?: 'accent' | 'good' | 'bad'; className?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((100 * value) / max))) : 0;
  const bar = tone === 'bad' ? 'bg-[#DC2626]' : tone === 'good' || pct === 100 ? 'bg-[#16A34A]' : 'bg-accent';
  return (
    <div className={className}>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
        <span className="font-medium text-text2">{label}</span>
        <span className="num text-text">{text ?? `${value} of ${max}`}<span className="ml-1.5 text-muted">{pct}%</span></span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface2" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={cx('h-full rounded-full transition-[width] duration-500', bar)} style={{ width: pct + '%' }} />
      </div>
    </div>
  );
}
