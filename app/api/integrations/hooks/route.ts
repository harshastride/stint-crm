import { badTarget, fail, isUuid } from '@/lib/server/guard';
import { NextResponse } from 'next/server';
import { bad, EVENTS, withKey } from '@/lib/server/integration';

// A trigger in an Activepieces flow subscribes to one CRM event (POST) and unsubscribes when the flow is turned off (DELETE).
// The CRM database sends from inside Docker, so a localhost address is rewritten to host.docker.internal on this machine.
export async function POST(request: Request) {
  const a = await withKey(request); if ('error' in a) return a.error;
  const b = await request.json().catch(() => ({}));
  const event = String(b.event || '');
  if (event !== '*' && !(EVENTS as readonly string[]).includes(event)) return bad('Unknown event. Use one of: ' + EVENTS.join(', '));
  let url: URL;
  try { url = new URL(String(b.url || '')); } catch { return bad('url must be a full web address.'); }
  const no = badTarget(url); if (no) return bad(no);
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) url.hostname = 'host.docker.internal';
  const { data, error } = await a.db.from('integration_subscription').insert({ event, target_url: url.toString(), label: b.label ? String(b.label).slice(0, 120) : null }).select('id, secret, event, target_url').single();
  if (error) return fail('hooks', error);
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(request: Request) {
  const a = await withKey(request); if ('error' in a) return a.error;
  const id = new URL(request.url).searchParams.get('id');
  if (!isUuid(id)) return bad('Which subscription? Pass ?id=');
  await a.db.from('integration_subscription').delete().eq('id', id);
  return NextResponse.json({ ok: true });
}
