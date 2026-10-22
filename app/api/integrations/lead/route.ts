import { fail, safeEqual } from '@/lib/server/guard';
import { likeExact } from '@/lib/pgrst';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// 3.2 Incoming leads from Activepieces (Meta lead ads, Google lead forms, job portals, website forms).
// POST JSON with header  x-api-key: <incoming key from Admin settings → Activepieces setup>
//   { "full_name": "…", "mobile": "…", "email"?, "city"?, "course"?, "source"?, "campaign"?, "notes"?, "marketing_consent"?,
//     "adset_name"?, "ad_name"?, "custom"?: { "<lead custom field key>": "answer", … } }
// Custom answers are kept only for lead custom fields that exist (Admin → Custom fields); for a Choice field, Meta's
// long answer is matched to the option it contains. A campaign name not yet in the CRM is added to Campaigns.
// A mobile already in the CRM is not added twice: the existing lead gets a note and its id is returned.
const svc = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const same = safeEqual;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const norm = (v: string) => v.toLowerCase().replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').trim();
/** The option a long answer contains, longest option first ("Non-IT Professional" before "IT Professional"). */
const matchOption = (answer: string, options: string[]) => {
  const a = norm(answer);
  return [...options].sort((x, y) => y.length - x.length).find((o) => o && a.includes(norm(o))) || null;
};

export async function POST(request: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('integrations/lead: SUPABASE_SERVICE_ROLE_KEY is not set'); return NextResponse.json({ error: 'This isn’t switched on yet. Ask the admin.' }, { status: 500 }); }
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
  let campaign = campaignName ? (await db.from('campaign').select('id').ilike('name', likeExact(campaignName)).limit(1).maybeSingle()).data : null;
  if (campaignName && !campaign) {
    // first lead from a new ad campaign: add it to Campaigns so the ROI report counts it (channel and status from the dropdowns)
    const { data: vals } = await db.from('dropdown_value').select('list_id, value').in('list_id', ['campaign_channel', 'campaign_status']).eq('active', true);
    const first = norm(source?.name || sourceName).split(' ')[0];
    const channel = (vals || []).find((v) => v.list_id === 'campaign_channel' && norm(v.value).includes(first))?.value || null;
    const live = (vals || []).find((v) => v.list_id === 'campaign_status' && v.value === 'Live')?.value;
    campaign = (await db.from('campaign').insert({ name: campaignName.slice(0, 120), channel, ...(live ? { status: live } : {}) }).select('id').single()).data;
  }
  const course = str(body.course || body.program);
  let program = course ? (await db.from('program').select('id').ilike('name', likeExact(course)).maybeSingle()).data : null;
  if (course && !program) {
    // "Python Development" → "Python": the answer is the course name plus only generic words. "Azure Data Engineering"
    // does NOT become "Data Engineering" (Azure is not generic); it is kept as typed so the telecaller sees it.
    const GENERIC = new Set(['development', 'developer', 'course', 'program', 'programme', 'training', 'certification', 'online', 'classroom']);
    const words = (v: string) => norm(v).replace(/[^a-z0-9+#.]+/g, ' ').trim().split(' ').filter(Boolean);
    const said = words(course);
    const { data: all } = await db.from('program').select('id, name').eq('active', true);
    program = (all || []).find((g) => { const n = words(g.name); return n.length > 0 && n.every((w) => said.includes(w)) && said.every((w) => n.includes(w) || GENERIC.has(w)); }) || null;
  }

  // answers to the form's own questions, kept as lead custom fields
  const given: Record<string, unknown> = { ...(body.custom && typeof body.custom === 'object' ? body.custom as Record<string, unknown> : {}) };
  if (str(body.adset_name || body.ad_set)) given.ad_set = body.adset_name || body.ad_set;
  if (str(body.ad_name)) given.ad_name = body.ad_name;
  const custom: Record<string, string> = {}, answers: string[] = [];
  if (Object.keys(given).length) {
    const { data: fields } = await db.from('custom_field').select('key, label, type, options').eq('page_id', 'lead').order('sort');
    for (const f of fields || []) {
      const raw = str(given[f.key]).slice(0, 200);
      if (!raw) continue;
      const val = f.type === 'Choice' ? matchOption(raw, String(f.options || '').split(',').map((o) => o.trim())) || raw : raw;
      custom[f.key] = val;
      answers.push(`${f.label}: ${val}`);
    }
  }
  const consent = body.marketing_consent === true || body.marketing_consent === 'true' || body.marketing_consent === 'yes';
  const tag = `[${source?.name || sourceName}]`;

  const existing = (await db.from('lead').select('id, full_name, stage').eq('mobile', mobile).maybeSingle()).data;
  if (existing) {
    await db.from('note').insert({ lead_id: existing.id, kind: 'Note', body: `${tag} Enquired again${course ? ' for ' + course : ''}${campaignName ? ' (' + campaignName + ')' : ''}${str(body.notes) ? ': ' + str(body.notes) : ''}.${answers.length ? ' ' + answers.join(' · ') : ''}` });
    if (consent) await db.from('lead').update({ marketing_consent: true, consent_at: new Date().toISOString() }).eq('id', existing.id);
    return NextResponse.json({ ok: true, duplicate: true, lead_id: existing.id, stage: existing.stage });
  }

  const { data, error } = await db.from('lead').insert({
    full_name, mobile, email: str(body.email) || null, city: str(body.city) || null,
    program_id: program?.id || null, course_other: !program && course ? course : null,
    source_id: source?.id || null, campaign_id: campaign?.id || null,
    notes: [tag, answers.join(' · '), str(body.notes)].filter(Boolean).join(' '), custom,
    marketing_consent: consent, consent_at: consent ? new Date().toISOString() : null,
  }).select('id, owner:owner_id(full_name)').single();
  if (error) {
    if (error.code === '23505') return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
    return fail('integrations/lead', error, 'Could not save the lead.', 400);
  }
  if (source) await db.from('lead_source').update({ last_lead_at: new Date().toISOString() }).eq('id', source.id);
  const owner = (data as { owner?: { full_name?: string } | null }).owner;
  return NextResponse.json({ ok: true, duplicate: false, lead_id: data.id, assigned_to: owner?.full_name || null }, { status: 201 });
}
