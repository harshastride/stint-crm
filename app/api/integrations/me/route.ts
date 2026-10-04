import { NextResponse } from 'next/server';
import { withKey } from '@/lib/server/integration';

// Connection check for the Stint CRM block, plus the dropdown values it shows.
export async function GET(request: Request) {
  const a = await withKey(request); if ('error' in a) return a.error;
  const [{ data: stages }, { data: cstages }, { data: staff }, { data: name }] = await Promise.all([
    a.db.from('dropdown_value').select('value').eq('list_id', 'lead_stage').eq('active', true).order('sort'),
    a.db.from('dropdown_value').select('value').eq('list_id', 'candidate_stage').eq('active', true).order('sort'),
    a.db.from('staff').select('full_name, email, role').eq('status', 'Active').order('full_name'),
    a.db.from('setting').select('value').eq('key', 'app_name').maybeSingle(),
  ]);
  return NextResponse.json({ ok: true, crm: name?.value || 'Stint CRM', lead_stages: (stages || []).map((s) => s.value), candidate_stages: (cstages || []).map((s) => s.value), staff: staff || [] });
}
