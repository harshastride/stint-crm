import { isUuid, safeFilename } from '@/lib/server/guard';
import { NextResponse } from 'next/server';
import { asCaller, service } from '@/lib/server/recordings';
import { verifyUrl, institute, receiptPdf } from '@/lib/server/pdf';

// A student's own payment receipt.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found.' }, { status: 400 });
  const { data: cid } = await (await asCaller()).rpc('my_candidate');
  if (!cid) return NextResponse.json({ error: 'Sign in to the student portal.' }, { status: 401 });
  const db = service();
  const { data: p } = await db.from('fee_payment').select('*, candidate:candidate_id(id, full_name, code, program:program_id(name))').eq('id', id).eq('candidate_id', cid).maybeSingle();
  if (!p || p.status !== 'Received') return NextResponse.json({ error: 'Receipt not found.' }, { status: 404 });
  const { data: plan } = await db.from('fee_plan_summary').select('total, balance').eq('candidate_id', cid).maybeSingle();
  const { data: signature } = await db.from('candidate_signature').select('png, signed_at').eq('candidate_id', p.candidate_id).maybeSingle();
  const { data: settings } = await db.from('setting').select('key, value');
  const get = async (k: string) => (settings || []).find((x: { key: string }) => x.key === k)?.value || '';
  const { bytes, filename } = await receiptPdf({ ...p, amount: Number(p.amount), candidate: { full_name: p.candidate?.full_name || '', code: p.candidate?.code, program: p.candidate?.program?.name },
    total: plan ? Number(plan.total) : null, balance: plan ? Number(plan.balance) : null, signature, verify: verifyUrl(p.verification_code, req.url) }, await institute(get), await get('receipt_note'));
  return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${safeFilename(filename)}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' } });
}
