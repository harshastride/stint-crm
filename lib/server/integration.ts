import 'server-only';
import { isUuid, safeEqual } from './guard';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Shared by the /api/integrations/* routes used by Activepieces (and the Stint CRM block).
// Every call needs header  x-api-key: <incoming API key from Admin settings → Automation log>.
export async function withKey(request: Request): Promise<{ db: SupabaseClient } | { error: NextResponse }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 }) };
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const key = request.headers.get('x-api-key') || '';
  const { data: cfg } = await db.from('integration_config').select('value').eq('key', 'incoming_api_key').single();
  if (!safeEqual(key, cfg?.value))
    return { error: NextResponse.json({ error: 'Wrong or missing API key.' }, { status: 401 }) };
  return { db };
}

export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
export const mobile10 = (v: unknown) => String(v ?? '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');

/** Find who a call is about: lead_id, candidate_id, or a mobile (lead first, then candidate). */
export async function findPerson(db: SupabaseClient, b: Record<string, unknown>): Promise<{ lead_id?: string; candidate_id?: string } | null> {
  if (b.lead_id && !isUuid(b.lead_id)) return null;
  if (b.candidate_id && !isUuid(b.candidate_id)) return null;
  if (b.lead_id) { const { data } = await db.from('lead').select('id').eq('id', String(b.lead_id)).maybeSingle(); return data ? { lead_id: data.id } : null; }
  if (b.candidate_id) { const { data } = await db.from('candidate').select('id').eq('id', String(b.candidate_id)).maybeSingle(); return data ? { candidate_id: data.id } : null; }
  const m = mobile10(b.mobile);
  if (m.length !== 10) return null;
  const lead = (await db.from('lead').select('id').eq('mobile', m).maybeSingle()).data;
  if (lead) return { lead_id: lead.id };
  const cand = (await db.from('candidate_private').select('candidate_id').eq('contact->>mobile', m).maybeSingle()).data;
  return cand ? { candidate_id: cand.candidate_id } : null;
}

export const EVENTS = ['lead.created', 'lead.assigned', 'counselling.booked', 'quote.sent', 'lead.converted', 'payment.recorded',
  'attendance.absent', 'mock.booked', 'mock.result', 'resume.rejected', 'vendor_request.created', 'placement.recorded'] as const;
