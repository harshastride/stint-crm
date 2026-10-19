'use client';
import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { cx } from '../ui';

// "6–8 pm", "11 am–1 pm" (to = end hour, not included). Same wording as the database's hour_range_label.
export function hourRange(from: number, to: number) {
  const h = (n: number) => String(n % 12 === 0 ? 12 : n % 12);
  const pm = (n: number) => n % 24 >= 12;
  return h(from) + (pm(from) === pm(to) && to < 24 ? '' : pm(from) ? ' pm' : ' am') + '–' + h(to) + (pm(to) ? ' pm' : ' am');
}

// Current hour in India (0–23), whatever the device's own time zone is.
export function indiaHour(d = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(d)) % 24;
}

// One line: "Usually answers 6–8 pm" (from this lead's own answered calls) or "Most leads answer 6–8 pm"
// (team pattern, when the lead has fewer than 2 answered calls). Says "good time now" inside the window.
export function BestTime({ label, from, to, className }: { label: string | null | undefined; from?: number | null; to?: number | null; className?: string }) {
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => {   // after mount only, so server and browser render the same text
    setHour(indiaHour());
    const t = setInterval(() => setHour(indiaHour()), 60_000);
    return () => clearInterval(t);
  }, []);
  if (!label) return null;
  const now = hour != null && from != null && to != null && hour >= from && hour < to;
  const team = label.startsWith('Most leads');
  return (
    <span data-testid="best-time" className={cx('inline-flex min-w-0 items-center gap-1.5 text-[12.5px]', now ? 'font-medium text-goodText' : 'text-text2', className)}
      title={team ? 'Not enough answered calls with this lead yet: this is when leads usually pick up (last 60 days, India time)' : 'From this lead’s answered calls, India time'}>
      <Clock size={14} strokeWidth={1.8} aria-hidden className="shrink-0" />
      <span className="truncate">{label}{now && <> · good time now</>}</span>
    </span>
  );
}
