import { NextResponse } from 'next/server';
import { bad, withKey } from '@/lib/server/integration';

// The Stint CRM block confirms an incoming event by fetching it here (so a forged webhook call can't start a flow).
export async function GET(request: Request) {
  const a = await withKey(request); if ('error' in a) return a.error;
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!/^[0-9a-f-]{36}$/.test(id)) return bad('Pass ?id=<event id>.');
  const { data } = await a.db.from('integration_event').select('id, event, payload, created_at').eq('id', id).maybeSingle();
  if (!data) return bad('No such event.', 404);
  return NextResponse.json({ ...(data.payload as object), id: data.id });
}
