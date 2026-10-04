import { NextResponse } from 'next/server';
import { bad, mobile10, withKey } from '@/lib/server/integration';

// Find a lead (or candidate) by mobile: GET ?mobile=98…
export async function GET(request: Request) {
  const a = await withKey(request); if ('error' in a) return a.error;
  const m = mobile10(new URL(request.url).searchParams.get('mobile'));
  if (m.length !== 10) return bad('mobile must be a 10-digit number.');
  const { data: lead } = await a.db.rpc('lead_brief', { lid: (await a.db.from('lead').select('id').eq('mobile', m).maybeSingle()).data?.id ?? null });
  if (lead) return NextResponse.json({ found: true, kind: 'lead', lead });
  const cid = (await a.db.from('candidate_private').select('candidate_id').eq('contact->>mobile', m).maybeSingle()).data?.candidate_id;
  if (cid) { const { data: candidate } = await a.db.rpc('candidate_brief', { cid }); return NextResponse.json({ found: true, kind: 'candidate', candidate }); }
  return NextResponse.json({ found: false });
}
