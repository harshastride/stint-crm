'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { initials } from '../ui';

// One round face: the person's photo when they have one, otherwise initials.
// The colour is picked from the name, so the same person always gets the same colour.
export const AVATAR_COLORS = ['#4474B9', '#FF6B35', '#16A34A', '#7C3AED', '#DB2777', '#0891B2', '#CA8A04', '#475569'];
export function avatarColor(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';
export const avatarBox: Record<AvatarSize, string> = { sm: 'h-6 w-6 text-[10px]', md: 'h-8 w-8 text-[11.5px]', lg: 'h-11 w-11 text-sm', xl: 'h-16 w-16 text-xl' };

// ---- photo URLs: signed once per page session, shared by every avatar ----
const urlCache = new Map<string, Promise<string | null>>();
export function photoUrl(path: string): Promise<string | null> {
  let p = urlCache.get(path);
  if (!p) {
    p = supabase().storage.from('photos').createSignedUrl(path, 3600).then(({ data }: { data: { signedUrl: string } | null }) => data?.signedUrl || null, () => null);
    urlCache.set(path, p);
    setTimeout(() => urlCache.delete(path), 55 * 60 * 1000); // re-sign before the link expires
  }
  return p;
}

// Staff photos are looked up by id (or name) so faces in tables and stacks show photos without extra props.
let staffPhotos: Promise<Map<string, string>> | null = null;
const listeners = new Set<() => void>();
function loadStaffPhotos() {
  if (!staffPhotos) {
    staffPhotos = Promise.resolve(supabase().from('staff').select('id,full_name,photo_path').not('photo_path', 'is', null)).then(({ data }: { data: { id: string; full_name: string; photo_path: string }[] | null }) => {
      const m = new Map<string, string>();
      (data || []).forEach((s) => { m.set(s.id, s.photo_path); m.set('name:' + s.full_name, s.photo_path); });
      return m;
    }, () => new Map<string, string>());
  }
  return staffPhotos;
}
/** Call after a photo changes so every avatar on screen picks up the new one. */
export function photosChanged() { staffPhotos = null; listeners.forEach((f) => f()); }

function usePhoto(photo: string | null | undefined, id?: string, name?: string) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { const f = () => setTick((t) => t + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    (async () => {
      let path = photo;
      if (path === undefined && (id || name)) { const m = await loadStaffPhotos(); path = (id && m.get(id)) || (name && m.get('name:' + name)) || null; }
      const u = path ? await photoUrl(path) : null;
      if (live) setUrl(u);
    })();
    return () => { live = false; };
  }, [visible, photo, id, name, tick]);
  return { ref, url, clear: () => setUrl(null) };
}

/** photo: storage path in the 'photos' bucket; null = no photo; leave out to look up staff photos by id/name. */
export function Avatar({ name, id, photo, size = 'md', ring = false, className = '' }: { name: string; id?: string; photo?: string | null; size?: AvatarSize; ring?: boolean; className?: string }) {
  const { ref, url, clear } = usePhoto(photo, id, name);
  return (
    <span ref={ref} aria-hidden className={'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white ' + avatarBox[size] + (ring ? ' border-2 border-surface' : '') + ' ' + className}
      style={{ background: avatarColor(id || name || '?') }}>
      {initials(name || '?')}
      {url && <img src={url} alt="" loading="lazy" decoding="async" onError={clear} className="absolute inset-0 h-full w-full object-cover" data-testid="avatar-photo" />}
    </span>
  );
}

/** Small face + name, used in table cells. */
export function PersonChip({ name, role }: { name?: string | null; role?: string }) {
  if (!name) return <span className="text-muted">—</span>;
  return <span className="inline-flex items-center gap-2" title={role ? name + ' · ' + role : name}><Avatar name={name} size="sm" /><span className="truncate">{name}</span></span>;
}
