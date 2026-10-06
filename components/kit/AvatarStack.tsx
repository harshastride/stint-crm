'use client';
import { useState } from 'react';
import { Avatar, avatarBox, type AvatarSize } from './Avatar';

export type StackPerson = { id?: string; name: string; role?: string; photo?: string | null };

// Overlapping faces. Hover or tab onto a face to see the name and role. Extra people (or a plain count) show as "+N".
export function AvatarStack({ people, max = 4, size = 'md', more = 0, moreLabel, label }: {
  people: StackPerson[]; max?: number; size?: AvatarSize; more?: number; moreLabel?: string; label?: string;
}) {
  const [tip, setTip] = useState<number | null>(null);
  const shown = people.slice(0, max);
  const extra = people.length - shown.length + more;
  const extraText = moreLabel || (people.length > max ? people.slice(max).map((p) => p.name).join(', ') + (more ? ' + ' + more + ' more' : '') : more + ' more');
  const tipBox = 'pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-[12px] font-medium text-white shadow-lg';
  return (
    <span className="inline-flex items-center" role="group" aria-label={label || people.map((p) => p.name).join(', ')} data-testid="avatar-stack">
      <span className={'flex ' + (size === 'sm' ? '-space-x-1.5' : '-space-x-2')}>
        {shown.map((p, i) => (
          <span key={(p.id || p.name) + i} tabIndex={0} className="relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onMouseEnter={() => setTip(i)} onMouseLeave={() => setTip(null)} onFocus={() => setTip(i)} onBlur={() => setTip(null)} aria-label={p.name + (p.role ? ', ' + p.role : '')}>
            <Avatar name={p.name} id={p.id} photo={p.photo} size={size} ring />
            {tip === i && <span role="tooltip" className={tipBox}>{p.name}{p.role && <span className="font-normal opacity-75"> · {p.role}</span>}</span>}
          </span>
        ))}
        {extra > 0 && (
          <span tabIndex={0} className="relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={extraText}
            onMouseEnter={() => setTip(-1)} onMouseLeave={() => setTip(null)} onFocus={() => setTip(-1)} onBlur={() => setTip(null)}>
            <span className={'flex items-center justify-center rounded-full border-2 border-surface bg-surface2 font-semibold text-text2 ' + avatarBox[size]}>+{extra}</span>
            {tip === -1 && <span role="tooltip" className={tipBox}>{extraText}</span>}
          </span>
        )}
      </span>
    </span>
  );
}
