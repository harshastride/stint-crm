'use client';
import { cx } from './ui';

// A date-and-time box with one-tap choices staff use most ("Tomorrow 10 am", "In 3 days"…). Value is an ISO string or null.
const at = (days: number, hour: number, minute = 0) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, minute, 0, 0); return d; };
const nextWeekday = (wd: number, hour: number) => { const d = new Date(); const add = ((wd - d.getDay() + 7) % 7) || 7; return at(add, hour); };
function picks(): [string, Date][] {
  const now = new Date();
  const laterToday = now.getHours() < 17 ? at(0, Math.max(now.getHours() + 2, 11)) : null;
  return [
    ...(laterToday ? [['Later today', laterToday] as [string, Date]] : []),
    ['Tomorrow 10 am', at(1, 10)], ['Tomorrow 4 pm', at(1, 16)], ['In 3 days', at(3, 10)], ['Next Monday', nextWeekday(1, 10)], ['In a week', at(7, 10)],
  ];
}
const toLocal = (iso: string) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

export function QuickDate({ value, onChange, disabled, label, dateOnly = false }: { value: string | null; onChange: (iso: string | null) => void; disabled?: boolean; label: string; dateOnly?: boolean }) {
  const cur = value ? new Date(value) : null;
  const same = (d: Date) => !!cur && Math.abs(+cur - +d) < 60000 * (dateOnly ? 1440 : 1);
  const options = dateOnly ? ([['Today', at(0, 0)], ['Tomorrow', at(1, 0)], ['In a week', at(7, 0)], ['In a month', at(30, 0)]] as [string, Date][]) : picks();
  return (
    <div className="flex flex-col gap-1.5">
      {!disabled && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={label + ' quick choices'}>
          {options.map(([l, d]) => (
            <button key={l} type="button" aria-pressed={same(d)} onClick={() => onChange(dateOnly ? d.toLocaleDateString('en-CA') : d.toISOString())}
              className={cx('min-h-[34px] rounded-full border px-3 text-[12.5px] font-medium', same(d) ? 'border-accent bg-accentSoft text-accentText' : 'border-line2 bg-surface text-text2 hover:text-text')}>{l}</button>
          ))}
        </div>
      )}
      <input aria-label={label} disabled={disabled} type={dateOnly ? 'date' : 'datetime-local'} className="h-[42px] w-full px-3 text-sm"
        value={value ? (dateOnly ? String(value).slice(0, 10) : toLocal(value)) : ''}
        onChange={(e) => onChange(e.target.value ? (dateOnly ? e.target.value : new Date(e.target.value).toISOString()) : null)} />
      {cur && !dateOnly && <span className="text-[11.5px] text-muted">{cur.toLocaleString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>}
    </div>
  );
}
