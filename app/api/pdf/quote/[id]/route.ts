import { NextResponse } from 'next/server';
import { asCaller } from '@/lib/server/recordings';
import { institute, quotePdf } from '@/lib/server/pdf';

// Fee quote as PDF, for anyone who can see the quote (row security decides).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = await asCaller();
  const { data: q } = await db.from('fee_quote').select('*, lead:lead_id(full_name, mobile, email, city), program:program_id(name), by:created_by(full_name)').eq('id', id).maybeSingle();
  if (!q) return NextResponse.json({ error: 'Quote not found, or your role can’t see it.' }, { status: 404 });
  const { data: settings } = await db.from('setting').select('key, value');
  const get = async (k: string) => (settings || []).find((x: { key: string }) => x.key === k)?.value || '';
  const { bytes, filename } = await quotePdf({ ...q, list_price: Number(q.list_price), discount_pct: Number(q.discount_pct), amount: Number(q.amount), program: q.program?.name || '', by: q.by?.full_name }, await institute(get), await get('quote_terms'));
  return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"` } });
}
