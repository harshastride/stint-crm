import { isUuid, safeFilename } from '@/lib/server/guard';
import { NextResponse } from 'next/server';
import { asCaller, service } from '@/lib/server/recordings';
import { verifyUrl, institute, quotePdf } from '@/lib/server/pdf';

// Fee quote as PDF, for anyone who can see the quote (row security decides).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found.' }, { status: 400 });
  const db = await asCaller();
  const { data: q } = await db.from('fee_quote').select('*, lead:lead_id(id, full_name, mobile_masked, email_masked, city), program:program_id(name), by:created_by(full_name)').eq('id', id).maybeSingle();
  if (!q) return NextResponse.json({ error: 'Quote not found, or your role can’t see it.' }, { status: 404 });
  // Contact details stay masked on the PDF unless the person asking is Admin (row security already checked they can see the quote).
  const { data: admin } = await db.rpc('is_admin');
  let lead = { full_name: q.lead?.full_name, city: q.lead?.city, mobile: q.lead?.mobile_masked, email: q.lead?.email_masked };
  if (admin === true && q.lead?.id) {
    const { data: full } = await service().from('lead').select('mobile, email').eq('id', q.lead.id).maybeSingle();
    if (full) {
      lead = { ...lead, mobile: full.mobile, email: full.email };
      // unmasked contact is logged like a reveal (rule 11)
      const { data: me } = await db.auth.getUser();
      await service().from('data_access_log').insert(['mobile', 'email'].map((field) => ({ staff_id: me.user?.id ?? null, kind: 'lead', entity_id: q.lead.id, field: field + ' (quote PDF)' })));
    }
  }
  const { data: settings } = await db.from('setting').select('key, value');
  const get = async (k: string) => (settings || []).find((x: { key: string }) => x.key === k)?.value || '';
  const { bytes, filename } = await quotePdf({ ...q, lead, list_price: Number(q.list_price), discount_pct: Number(q.discount_pct), amount: Number(q.amount), program: q.program?.name || '', by: q.by?.full_name, verify: verifyUrl(q.verification_code, req.url) }, await institute(get), await get('quote_terms'));
  return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${safeFilename(filename)}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' } });
}
