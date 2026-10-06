'use client';
import { Loader2, X } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

/* Buttons follow the sidebar's design language. Map + usage: docs/design/buttons.md */
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'quiet' | 'danger' | 'link' | 'cta';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon-sm' | 'icon' | 'icon-lg';
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant; size?: ButtonSize; leftIcon?: ReactNode; rightIcon?: ReactNode;
  loading?: boolean; fullWidth?: boolean; active?: boolean;
};

const VARIANT: Record<Exclude<ButtonVariant, 'ghost'>, string> = {
  primary: 'bg-accent text-white border-transparent font-semibold hover:brightness-110',
  cta: 'bg-coral text-[#0F2545] border-transparent font-semibold hover:brightness-105',
  secondary: 'bg-accentSoft text-accentText border-transparent font-semibold hover:brightness-[.97]',
  outline: 'bg-surface text-text border-line2 font-medium hover:bg-surface2',
  quiet: 'bg-transparent text-text2 border-transparent font-medium hover:bg-surface2 hover:text-text',
  danger: 'bg-surface text-badText border-line2 font-medium hover:bg-badBg hover:border-transparent',
  link: 'bg-transparent text-accentText border-transparent font-medium underline-offset-4 hover:underline !px-1',
};
const ACTIVE = '!bg-accentSoft !text-accentText !border-transparent font-semibold';
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3 text-[13px] rounded-lg',
  md: 'h-10 gap-2 px-4 text-[13.5px] rounded-[10px]',
  lg: 'h-11 gap-2 px-5 text-sm rounded-[10px]',
  'icon-sm': 'h-8 w-8 rounded-lg',
  icon: 'h-10 w-10 rounded-[10px]',
  'icon-lg': 'h-11 w-11 rounded-[10px]',
};

export function Button({ variant = 'ghost', size = 'md', leftIcon, rightIcon, loading, fullWidth, active, className, children, disabled, ...p }: ButtonProps) {
  const v = variant === 'ghost' ? 'outline' : variant; // legacy: 'ghost' was always a bordered button
  return (
    <button type="button" {...p} disabled={disabled || loading} aria-busy={loading || undefined} aria-pressed={active === undefined ? p['aria-pressed'] : active} data-loading={loading || undefined}
      className={cx('btn inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap border', SIZE[size], VARIANT[v], active && ACTIVE, fullWidth && 'w-full', className)}>
      {loading && <span className="absolute inset-0 flex items-center justify-center" aria-hidden><Loader2 size={16} className="btn-spin" /></span>}
      <span className={cx('inline-flex items-center justify-center gap-[inherit]', loading && 'opacity-0')}>
        {leftIcon && <span className="flex shrink-0" aria-hidden>{leftIcon}</span>}{children}{rightIcon && <span className="flex shrink-0" aria-hidden>{rightIcon}</span>}
      </span>
    </button>
  );
}

/** Icon-only button. aria-label is required and doubles as the tooltip. */
export function IconButton({ 'aria-label': label, icon, variant = 'quiet', size = 'icon', className, ...p }: Omit<ButtonProps, 'children' | 'leftIcon' | 'rightIcon' | 'size'> & { 'aria-label': string; icon: ReactNode; size?: 'icon-sm' | 'icon' | 'icon-lg' }) {
  return (
    <span className="btn-tipwrap relative inline-flex">
      <Button {...p} aria-label={label} variant={variant} size={size} className={className}>{icon}</Button>
      <span role="tooltip" className="btn-tip rounded-md bg-ink px-2 py-1 text-[11.5px] font-medium text-white shadow-lg">{label}</span>
    </span>
  );
}

/** Segmented control: joined borders, one pressed item (pass `active` on the chosen Button). */
export function ButtonGroup({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cx('inline-flex items-center rounded-[10px] border border-line2 bg-surface p-0.5 [&_.btn]:rounded-lg [&_.btn]:border-transparent [&_.btn]:h-9', className)}>{children}</div>
  );
}

/** Action bar. Desktop: secondary on the left, primary rightmost. Phone: primary is full-width and sticky at the bottom. */
export function Toolbar({ start, children, primary, sticky = true, className }: { start?: ReactNode; children?: ReactNode; primary?: ReactNode; sticky?: boolean; className?: string }) {
  return (
    <div className={cx('flex flex-wrap items-center gap-2', className)}>
      {start && <div className="flex min-w-0 items-center gap-2">{start}</div>}
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}
        {primary && <div className={cx('max-md:w-full md:contents', sticky && 'max-md:sticky max-md:bottom-0 max-md:z-20 max-md:-mx-3 max-md:border-t max-md:border-line max-md:bg-surface max-md:px-3 max-md:pb-[max(12px,env(safe-area-inset-bottom))] max-md:pt-3 max-md:[&_.btn]:w-full')}>{primary}</div>}
      </div>
    </div>
  );
}

const BAD = /overdue|missing|missed|no-show|rejected|failed|not interested|expired|at risk|high|paused|needs help|rebook|dropped|not set up|disabled|unmatched|not applied|not ready/i;
const GOOD = /live|approved|passed|verified|won|accepted|received|placed|ready|done|joined|converted|client|interested|completed|connected|active|on track|confirmed|resolved|uan active/i;
const WARN = /pending|due|booked|invited|callback|negotiating|waiting|requested|awaited|medium|in progress|planned|upcoming|joining soon/i;

export function Pill({ children }: { children: ReactNode }) {
  const t = String(children ?? '');
  if (!t || t === '—') return <span className="text-muted">—</span>;
  const tone = BAD.test(t) ? 'bg-badBg text-badText' : GOOD.test(t) ? 'bg-goodBg text-goodText' : WARN.test(t) ? 'bg-warnBg text-warnText' : 'bg-surface2 text-text2';
  return <span className={cx('inline-block whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-semibold', tone)}>{t}</span>;
}

export function SidePanel({ kind, title, onClose, children }: { kind: string; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <aside aria-label={kind} className="anim-slide fixed inset-x-0 bottom-0 z-40 max-h-[85dvh] w-full rounded-t-2xl border-t border-line shadow-2xl md:static md:z-auto md:max-h-none md:rounded-none md:border-t-0 md:border-l md:shadow-none flex shrink-0 flex-col gap-4 overflow-y-auto bg-surface p-4 md:w-[420px] md:p-[22px]">
      <div className="mx-auto -mb-2 h-1.5 w-10 rounded-full bg-line2 md:hidden" aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <div>
          {/* the record type only when the title doesn't already say it ("Fee quote" above "New quote" was repeated) */}
          {!title.toLowerCase().includes(kind.toLowerCase().split(' ').pop() || kind.toLowerCase()) && <div className="text-xs font-medium text-muted">{kind}</div>}
          <h2 className="mt-0.5 text-lg font-semibold leading-tight">{title}</h2>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-[10px] text-text2 hover:bg-surface2"><X size={18} /></button>
      </div>
      {children}
    </aside>
  );
}

export function Notice({ tone = 'good', children }: { tone?: 'good' | 'bad' | 'warn'; children: ReactNode }) {
  const c = tone === 'good' ? 'bg-goodBg text-goodText' : tone === 'bad' ? 'bg-badBg text-badText' : 'bg-warnBg text-warnText';
  return <div role="status" className={cx('anim-fade rounded-[10px] px-3 py-2.5 text-[13px] font-medium leading-snug', c)}>{children}</div>;
}

export const money = (n: unknown) => (n == null || n === '' ? '—' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 }));
export const fmtDate = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (v: unknown) => (v ? new Date(String(v)).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
export const fmtDuration = (s: unknown) => { const n = Number(s || 0); return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0'); };
export const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
