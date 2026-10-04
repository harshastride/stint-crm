import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

// 3.2 Incoming leads from Activepieces (Meta lead ads, Google lead forms, job portals, website forms).
// POST JSON with header  x-api-key: <incoming key from Admin settings → Activepieces setup>
//   { "full_name": "…", "mobile": "…", "email"?, "city"?, "course"?, "source"?, "campaign"?, "notes"?, "marketing_consent"? }
// A mobile already in the CRM is not added twice: the existing lead gets a note and its id is returned.
const svc = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

export async function POST(request: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  const db = svc();
  const key = request.headers.get('x-api-key') || '';
  const { data: cfg } = await db.from('integration_config').select('value').eq('key', 'incoming_api_key').single();
  if (!cfg?.value || !key || !same(key, cfg.value)) return NextResponse.json({ error: 'Wrong or missing API key.' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Send JSON.' }, { status: 400 }); }
  const full_name = str(body.full_name || body.name);
  const mobile = str(body.mobile || body.phone).replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  if (!full_name) return NextResponse.json({ error: 'full_name is required.' }, { status: 400 });
  if (mobile.length !== 10) return NextResponse.json({ error: 'mobile must be a 10-digit Indian number.' }, { status: 400 });

  const sourceName = str(body.source) || 'Website form';
  const { data: sources } = await db.from('lead_source').select('id, name');
  const source = (sources || []).find((s) => s.name.toLowerCase() === sourceName.toLowerCase())
    || (sources || []).find((s) => s.name.toLowerCase().includes(sourceName.toLowerCase().split(' ')[0]));
  const campaignName = str(body.campaign);
  const campaign = campaignName ? (await db.from('campaign').select('id').ilike('name', campaignName).maybeSingle()).data : null;
  const course = str(body.course || body.program);
  const program = course ? (await db.from('program').select('id').ilike('name', course).maybeSingle()).data : null;
  const consent = body.marketing_consent === true || body.marketing_consent === 'true' || body.marketing_consent === 'yes';
  const tag = `[${source?.name || sourceName}]`;

  const existing = (await db.from('lead').select('id, full_name, stage').eq('mobile', mobile).maybeSingle()).data;
  if (existing) {
    await db.from('note').insert({ lead_id: existing.id, kind: 'Note', body: `${tag} Enquired again${course ? ' for ' + course : ''}${str(body.notes) ? ': ' + str(body.notes) : ''}.` });
    if (consent) await db.from('lead').update({ marketing_consent: true, consent_at: new Date().toISOString() }).eq('id', existing.id);
    return NextResponse.json({ ok: true, duplicate: true, lead_id: existing.id, stage: existing.stage });
  }

  const { data, error } = await db.from('lead').insert({
    full_name, mobile, email: str(body.email) || null, city: str(body.city) || null,
    program_id: program?.id || null, course_other: !program && course ? course : null,
    source_id: source?.id || null, campaign_id: campaign?.id || null,
    notes: [tag, str(body.notes)].filter(Boolean).join(' '),
    marketing_consent: consent, consent_at: consent ? new Date().toISOString() : null,
  }).select('id, owner:owner_id(full_name)').single();
  if (error) {
    if (error.code === '23505') return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (source) await db.from('lead_source').update({ last_lead_at: new Date().toISOString() }).eq('id', source.id);
  const owner = (data as { owner?: { full_name?: string } | null }).owner;
  return NextResponse.json({ ok: true, duplicate: false, lead_id: data.id, assigned_to: owner?.full_name || null }, { status: 201 });
}
