import { fail, safeEqual } from '@/lib/server/guard';
import { NextResponse } from 'next/server';
import { service } from '@/lib/server/recordings';

// Called nightly by the database (pg_cron): removes audio older than audio_retention_days. Transcript and summary stay.
export async function POST(request: Request) {
  const db = service();
  const { data: cfg } = await db.from('integration_config').select('value').eq('key', 'cron_secret').single();
  const got = request.headers.get('x-cron-secret') || '';
  if (!safeEqual(got, cfg?.value)) return NextResponse.json({ error: 'Not allowed.' }, { status: 401 });
  const { data: old, error } = await db.rpc('recordings_to_expire');
  if (error) return fail('recordings/cleanup', error);
  let removed = 0;
  for (const r of (old || []) as { id: string; audio_path: string }[]) {
    const del = await db.storage.from('recordings').remove([r.audio_path]);
    if (!del.error) { await db.from('recording').update({ audio_path: null, audio_deleted_at: new Date().toISOString() }).eq('id', r.id); removed++; }
  }
  return NextResponse.json({ ok: true, removed });
}
