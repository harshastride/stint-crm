'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { cx } from '../ui';

// A number picked by dragging, with a marker where approval starts (e.g. discounts above 10% need the Sales head).
export function Slider({ label, value, max, limitSetting, onChange, disabled, hint }: { label: string; value: number; max: number; limitSetting?: string; onChange: (v: number) => void; disabled?: boolean; hint?: (v: number) => string }) {
  const [limit, setLimit] = useState<number | null>(null);
  useEffect(() => {
    if (!limitSetting) return;
    supabase().from('setting').select('value').eq('key', limitSetting).maybeSingle().then(({ data }: { data: { value: string } | null }) => setLimit(data ? Number(data.value) : null));
  }, [limitSetting]);
  const over = limit != null && value > limit;
  const pct = (100 * value) / max;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <input type="range" min={0} max={max} step={1} value={value} disabled={disabled} aria-label={label} onChange={(e) => onChange(Number(e.target.value))}
            className="stint-range h-11 w-full cursor-pointer appearance-none bg-transparent"
            style={{ '--fill': pct + '%', '--bar': over ? '#FF6B35' : '#4474B9' } as React.CSSProperties} />
          {limit != null && limit < max && <span aria-hidden title={'Approval needed above ' + limit + '%'} className="pointer-events-none absolute top-[12px] h-5 w-0.5 rounded bg-[#FF6B35]" style={{ left: `calc(${(100 * limit) / max}% - 1px)` }} />}
        </div>
        <span className={cx('num w-16 rounded-lg border px-2 py-1.5 text-center text-[15px] font-semibold', over ? 'border-coral text-[#C2410C]' : 'border-line2')}>{value}%</span>
      </div>
      <div className="flex justify-between text-[11.5px] text-muted"><span>0%</span>{limit != null && <span className={over ? 'font-semibold text-[#C2410C]' : ''}>{over ? `Above ${limit}%: needs Sales head approval` : `Up to ${limit}% without approval`}</span>}<span>{max}%</span></div>
      {hint && <div className="text-[13px] font-medium text-text">{hint(value)}</div>}
    </div>
  );
}
