import { fail } from '@/lib/server/guard';
import { withKey } from '@/lib/server/integration';
import { NextResponse } from 'next/server';

// For the public website (Tech Career Fit landing page): active courses and the batches that have not started yet.
// GET with header  x-api-key: <incoming key from Admin settings → Activepieces setup>
// Schedule only: no trainer, no fees, no people. The website caches the answer for a few minutes.
//   { today, courses: [{ name, weeks }], batches: [{ code, course, starts_on, ends_on, days, from, to, branch, city, mode }] }
export async function GET(request: Request) {
  const a = await withKey(request); if ('error' in a) return a.error;
  const db = a.db;
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);   // India date
  const [p, b] = await Promise.all([
    db.from('program').select('name, duration_weeks').eq('active', true).order('name'),
    db.from('batch').select('code, starts_on, ends_on, class_days, class_start, class_end, status, program:program_id(name, active), branch:branch_id(name, city, mode)')
      .gte('starts_on', today).neq('status', 'Completed').order('starts_on').limit(50),
  ]);
  if (p.error || b.error) return fail('batches', p.error || b.error);
  type One<T> = T | T[] | null;
  const one = <T,>(v: One<T>) => (Array.isArray(v) ? v[0] : v) || null;
  const batches = (b.data || []).flatMap((r) => {
    const prog = one(r.program as One<{ name: string; active: boolean }>), br = one(r.branch as One<{ name: string; city: string | null; mode: string | null }>);
    if (!prog?.active) return [];
    return [{ code: r.code, course: prog.name, starts_on: r.starts_on, ends_on: r.ends_on, days: r.class_days || [],
      from: r.class_start ? String(r.class_start).slice(0, 5) : null, to: r.class_end ? String(r.class_end).slice(0, 5) : null,
      branch: br?.name || null, city: br?.city || null, mode: br?.mode || null }];
  });
  return NextResponse.json({ today, courses: (p.data || []).map((c) => ({ name: c.name, weeks: c.duration_weeks })), batches });
}
