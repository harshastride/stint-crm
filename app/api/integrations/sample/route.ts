import { NextResponse } from 'next/server';
import { bad, EVENTS, withKey } from '@/lib/server/integration';

// Example data for the flow builder: the latest real events of a kind (newest first).
export async function GET(request: Request) {
  const a = await withKey(request); if ('error' in a) return a.error;
  const event = new URL(request.url).searchParams.get('event') || '';
  if (!(EVENTS as readonly string[]).includes(event)) return bad('Unknown event.');
  const { data } = await a.db.from('integration_event').select('id, payload, created_at').eq('event', event).is('subscription_id', null).order('created_at', { ascending: false }).limit(5);
  return NextResponse.json({ items: (data || []).map((e) => ({ ...(e.payload as object), id: e.id })) });
}
