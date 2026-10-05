'use client';
import { cx } from './ui';

// Indian mobile: fixed +91, 10 digits shown as "98000 00310". Pasting "+91 98000-00310" or "098000 00310" works.
// The value handed back is the bare 10 digits (what the CRM stores).
export const digits10 = (v: string) => v.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '').slice(0, 10);
const pretty = (d: string) => (d.length > 5 ? d.slice(0, 5) + ' ' + d.slice(5) : d);
export const phoneProblem = (d: string) => (!d ? null : d.length < 10 ? `${10 - d.length} more digit${d.length === 9 ? '' : 's'}` : !/^[6-9]/.test(d) ? 'Indian mobiles start with 6, 7, 8 or 9' : null);

export function PhoneInput({ value, onChange, disabled, label = 'Mobile', placeholder = '98000 00310', className }: {
  value: string; onChange: (digits: string) => void; disabled?: boolean; label?: string; placeholder?: string; className?: string;
}) {
  const d = digits10(value || '');
  const problem = phoneProblem(d);
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <div className={cx('flex h-11 items-center overflow-hidden rounded-control border bg-surface', problem && d.length === 10 ? 'border-badText' : 'border-line2', disabled && 'opacity-60')}>
        <span className="flex h-full items-center bg-surface2 px-2.5 text-sm font-medium text-text2" aria-hidden>+91</span>
        <input aria-label={label} type="tel" inputMode="numeric" autoComplete="tel-national" disabled={disabled} placeholder={placeholder}
          value={pretty(d)} onChange={(e) => onChange(digits10(e.target.value))}
          className="num h-full w-full border-0 bg-transparent px-3 text-sm tracking-wide outline-none focus:ring-0" />
        {d.length === 10 && !problem && <span className="pr-3 text-xs font-semibold text-goodText" aria-label="Looks right">✓</span>}
      </div>
      {problem && d.length > 0 && <span className="text-[11.5px] text-muted">{problem}</span>}
    </div>
  );
}
