'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { initials } from '../ui';

// Faces of other staff who have this lead / student open right now, so two people don't call the same person.
const COLORS = ['#4474B9', '#FF6B35', '#16A34A', '#7C3AED', '#DB2777', '#0891B2'];
export function Viewers({ kind, id }: { kind: 'lead' | 'candidate'; id: string }) {
  const s = useSession();
  const [others, setOthers] = useState<{ id: string; name: string; role: string }[]>([]);
  useEffect(() => {
    const db = supabase();
    let alive = true;
    const beat = async () => {
      if (document.hidden) return;
      await db.from('viewing').upsert({ staff_id: s.staff.id, kind, entity_id: id, seen_at: new Date().toISOString() });
      const { data } = await db.from('viewing').select('staff_id, staff:staff_id(full_name, role)').eq('kind', kind).eq('entity_id', id)
        .neq('staff_id', s.staff.id).gt('seen_at', new Date(Date.now() - 60000).toISOString());
      if (alive) setOthers((data || []).map((v: { staff_id: string; staff: { full_name: string; role: string } | null }) => ({ id: v.staff_id, name: v.staff?.full_name || 'Someone', role: v.staff?.role || '' })));
    };
    beat(); const t = setInterval(beat, 20000);
    return () => { alive = false; clearInterval(t); db.from('viewing').delete().eq('staff_id', s.staff.id).eq('kind', kind).eq('entity_id', id).then(() => {}); };
  }, [kind, id, s.staff.id]);
  if (!others.length) return null;
  const names = others.map((o) => o.name.split(' ')[0]);
  return (
    <div className="flex items-center gap-2 rounded-[10px] bg-warnBg px-2.5 py-1.5 text-[12.5px] text-warnText" role="status">
      <span className="flex -space-x-2">
        {others.slice(0, 4).map((o, i) => (
          <span key={o.id} title={o.name + (o.role ? ' · ' + o.role : '')} className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface text-[10.5px] font-semibold text-white" style={{ background: COLORS[i % COLORS.length] }}>{initials(o.name)}</span>
        ))}
        {others.length > 4 && <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-surface2 text-[10.5px] font-semibold text-text2">+{others.length - 4}</span>}
      </span>
      <span><b>{names.length > 2 ? names.slice(0, 2).join(', ') + ' and ' + (names.length - 2) + ' more' : names.join(' and ')}</b> {names.length > 1 ? 'are' : 'is'} also looking at this now</span>
    </div>
  );
}
