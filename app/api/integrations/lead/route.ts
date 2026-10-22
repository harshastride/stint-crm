import { safeEqual } from '@/lib/server/guard';
import { saveIncomingLead } from '@/lib/server/incoming-lead';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// 3.2 Incoming leads from Activepieces (Meta lead ads, Google lead forms, job portals, website forms).
// POST JSON with header  x-api-key: <incoming key from Admin settings → Activepieces setup>
//   { "full_name": "…", "mobile": "…", "email"?, "city"?, "course"?, "source"?, "campaign"?, "notes"?, "marketing_consent"?,
//     "adset_name"?, "ad_name"?, "custom"?: { "<lead custom field key>": "answer", … } }
// The rules (duplicates, campaigns, course matching, custom answers) live in lib/server/incoming-lead.ts, shared with
// the direct Meta connection.
const svc = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

export async function POST(request: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('integrations/lead: SUPABASE_SERVICE_ROLE_KEY is not set'); return NextResponse.json({ error: 'This isn’t switched on yet. Ask the admin.' }, { status: 500 }); }
  const db = svc();
  const key = request.headers.get('x-api-key') || '';
  const { data: cfg } = await db.from('integration_config').select('value').eq('key', 'incoming_api_key').single();
  if (!cfg?.value || !key || !safeEqual(key, cfg.value)) return NextResponse.json({ error: 'Wrong or missing API key.' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Send JSON.' }, { status: 400 }); }
  const out = await saveIncomingLead(db, body);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: 400 });
  return NextResponse.json(out, { status: out.duplicate ? 200 : 201 });
}
