'use client';
import { Inbox, SearchX, Sparkles } from 'lucide-react';

// A friendly empty list: an illustration, one line of what it means, and the next thing to do.
export function EmptyState({ kind = 'empty', title, body, action }: { kind?: 'empty' | 'search' | 'done'; title: string; body?: string; action?: { label: string; onClick: () => void } }) {
  const I = kind === 'search' ? SearchX : kind === 'done' ? Sparkles : Inbox;
  return (
    <div className="anim-fade flex flex-col items-center rounded-xl border border-dashed border-line2 bg-surface px-6 py-10 text-center">
      <span className="relative mb-4 flex h-20 w-20 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-accentSoft" />
        <span className="absolute -right-1 top-2 h-4 w-4 rounded-full bg-[#FFE4D6] dark:bg-[#3A2418]" />
        <span className="absolute bottom-1 left-0 h-2.5 w-2.5 rounded-full bg-[rgba(68,116,185,.3)]" />
        <I size={34} strokeWidth={1.6} className="relative text-accentText" aria-hidden />
      </span>
      <div className="text-[15px] font-semibold">{title}</div>
      {body && <p className="mt-1 max-w-md text-[13.5px] text-text2">{body}</p>}
      {action && <button type="button" onClick={action.onClick} className="mt-4 min-h-[44px] rounded-[10px] bg-accent px-4 text-[13.5px] font-semibold text-white">{action.label}</button>}
    </div>
  );
}
