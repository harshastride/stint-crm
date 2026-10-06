'use client';

// Monthly target, as one compact row: "Team target · 11 / 60 enrolments · Just on pace · need ~1.9/day · 26 days left",
// a thin progress bar and a small marker where today's expected count sits. Pace compares the value with the
// exact expected count (target × days elapsed ÷ days in month), not a rounded one.
export function TargetRing({ value, target, label = 'enrolments', title = 'My target', now = new Date() }:
  { value: number; target: number; label?: string; title?: string; now?: Date }) {
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const day = now.getDate();
  const expected = (target * day) / days;
  const done = value >= target;
  const pace = done ? 'done' : value >= expected + 1 ? 'ahead' : value >= expected - 1 ? 'on-pace' : 'behind';
  const status = { done: 'Target reached', ahead: 'Ahead of pace', 'on-pace': 'Just on pace', behind: 'Behind pace' }[pace];
  const need = Math.max(0, target - value);
  const left = days - day + 1;
  const perDay = need ? Math.ceil((need / left) * 10) / 10 : 0;
  const frac = target > 0 ? Math.min(1, value / target) : 0;
  const mark = target > 0 ? Math.min(1, expected / target) : 0;
  const tip = `Expected by today: ${expected.toFixed(1)} (${target} × ${day}/${days} days)`;
  const tone = pace === 'behind' ? 'bg-badBg text-badText' : pace === 'on-pace' ? 'bg-surface2 text-text2' : 'bg-goodBg text-goodText';
  const bar = pace === 'behind' ? 'bg-[#FF6B35]' : pace === 'done' ? 'bg-[#16A34A]' : 'bg-accent';

  return (
    <section data-testid="target-ring" data-pace={pace === 'behind' ? 'behind' : done ? 'done' : 'on-track'} aria-label={title}
      className="rounded-card bg-surface px-4 py-2.5 shadow-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
        <span className="font-semibold">{title}</span>
        <span className="text-muted">·</span>
        <span className="num font-semibold">{value} / {target}</span><span className="text-text2">{label}</span>
        <span data-testid="target-status" title={tip} className={'rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold ' + tone}>{status}</span>
        <span data-testid="target-need" className="text-text2">
          {done ? 'Anything more is a bonus.' : `need ~${perDay}/day · ${left} day${left === 1 ? '' : 's'} left`}
        </span>
      </div>
      <div className="relative mt-2 h-1.5 rounded-full bg-surface2" role="img" aria-label={`${value} of ${target} ${label}, ${status.toLowerCase()}. ${tip}`}>
        <div className={'h-full rounded-full ' + bar} style={{ width: `${frac * 100}%` }} />
        {!done && <div title={tip} className="absolute -top-1 h-3.5 w-0.5 rounded bg-text" style={{ left: `calc(${mark * 100}% - 1px)` }} />}
      </div>
    </section>
  );
}
