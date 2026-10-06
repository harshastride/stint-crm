import { isUuid, safeFilename } from '@/lib/server/guard';
import { NextResponse } from 'next/server';
import { asCaller } from '@/lib/server/recordings';
import { verifyUrl, institute, receiptPdf } from '@/lib/server/pdf';

// Payment receipt as PDF, only for payments marked Received, for anyone who can see the payment.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found.' }, { status: 400 });
  const db = await asCaller();
  const { data: p } = await db.from('fee_payment').select('*, candidate:candidate_id(id, full_name, code, program:program_id(name))').eq('id', id).maybeSingle();
  if (!p) return NextResponse.json({ error: 'Payment not found, or your role can’t see it.' }, { status: 404 });
  if (p.status !== 'Received') return NextResponse.json({ error: 'A receipt is only for a payment marked Received.' }, { status: 400 });
  const { data: plan } = await db.from('fee_plan_summary').select('total, balance').eq('candidate_id', p.candidate_id).maybeSingle();
  const { data: signature } = await db.from('candidate_signature').select('png, signed_at').eq('candidate_id', p.candidate_id).maybeSingle();
  const { data: settings } = await db.from('setting').select('key, value');
  const get = async (k: string) => (settings || []).find((x: { key: string }) => x.key === k)?.value || '';
  const { bytes, filename } = await receiptPdf({ ...p, amount: Number(p.amount), candidate: { full_name: p.candidate?.full_name || '', code: p.candidate?.code, program: p.candidate?.program?.name },
    total: plan ? Number(plan.total) : null, balance: plan ? Number(plan.balance) : null, signature, verify: verifyUrl(p.verification_code, req.url) }, await institute(get), await get('receipt_note'));
  return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${safeFilename(filename)}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' } });
}
