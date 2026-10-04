'use client';
import { X } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

export function Button({ variant = 'ghost', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'cta' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-accent text-white border-transparent font-semibold',
    cta: 'bg-coral text-[#0F2545] border-transparent font-semibold',
    ghost: 'bg-surface text-text border-line2 font-medium',
    danger: 'bg-surface text-badText border-line2 font-medium',
  }[variant];
  return <button type="button" {...p} className={cx('min-h-[44px] rounded-[10px] border px-4 text-sm', styles, className)} />;
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
          <div className="text-xs font-medium text-muted">{kind}</div>
          <h2 className="mt-1 text-[22px] font-semibold leading-tight">{title}</h2>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-line2 bg-surface"><X size={18} /></button>
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
