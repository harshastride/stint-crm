import { initials } from '../ui';

// One round initials face. The colour is picked from the name, so the same person always gets the same colour.
export const AVATAR_COLORS = ['#4474B9', '#FF6B35', '#16A34A', '#7C3AED', '#DB2777', '#0891B2', '#CA8A04', '#475569'];
export function avatarColor(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
export type AvatarSize = 'sm' | 'md';
export const avatarBox: Record<AvatarSize, string> = { sm: 'h-6 w-6 text-[10px]', md: 'h-8 w-8 text-[11.5px]' };

export function Avatar({ name, id, size = 'md', ring = false, className = '' }: { name: string; id?: string; size?: AvatarSize; ring?: boolean; className?: string }) {
  return (
    <span aria-hidden className={'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ' + avatarBox[size] + (ring ? ' border-2 border-surface' : '') + ' ' + className}
      style={{ background: avatarColor(id || name || '?') }}>{initials(name || '?')}</span>
  );
}

/** Small face + name, used in table cells. */
export function PersonChip({ name, role }: { name?: string | null; role?: string }) {
  if (!name) return <span className="text-muted">—</span>;
  return <span className="inline-flex items-center gap-2" title={role ? name + ' · ' + role : name}><Avatar name={name} size="sm" /><span className="truncate">{name}</span></span>;
}
