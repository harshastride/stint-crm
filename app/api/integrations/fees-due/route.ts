import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

// For the "Fee due reminder" flow: instalments due in 3 days, due today, or overdue by a multiple of 3 days.
// GET with header  x-api-key: <incoming key>.  Optional ?all=1 returns every unpaid instalment.
const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function GET(request: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const key = request.headers.get('x-api-key') || '';
  const { data: cfg } = await db.from('integration_config').select('value').eq('key', 'incoming_api_key').single();
  if (!cfg?.value || !key || !same(key, cfg.value)) return NextResponse.json({ error: 'Wrong or missing API key.' }, { status: 401 });

  const all = new URL(request.url).searchParams.get('all') === '1';
  const { data, error } = await db.from('fee_payment').select('id, amount, due_on, status, label, candidate:candidate_id(id, code, full_name, candidate_private(contact))')
    .in('status', ['Due', 'Overdue']).not('due_on', 'is', null).order('due_on');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const today = new Date(new Date().toISOString().slice(0, 10));
  const rows = (data || []).map((p) => {
    const c = p.candidate as unknown as { id: string; code: string; full_name: string; candidate_private: { contact: Record<string, string> } | { contact: Record<string, string> }[] | null };
    const priv = Array.isArray(c?.candidate_private) ? c.candidate_private[0] : c?.candidate_private;
    const days = Math.round((new Date(p.due_on as string).getTime() - today.getTime()) / 864e5);
    return { payment_id: p.id, amount: Number(p.amount), due_on: p.due_on, days_left: days, status: p.status, for: p.label,
      candidate_id: c?.id, code: c?.code, name: c?.full_name, mobile: priv?.contact?.mobile || null, email: priv?.contact?.email || null };
  }).filter((r) => all || r.days_left === 3 || r.days_left === 0 || (r.days_left < 0 && r.days_left % 3 === 0));
  return NextResponse.json({ date: today.toISOString().slice(0, 10), count: rows.length, items: rows });
}
