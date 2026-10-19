// Owner decisions (migration 098): Sales can log calls; the files bucket refuses types other than PDF, Word and photos.
export default async function ({ check, sales, hr, service }) {
  const lead = (await sales.from('lead_list').select('id').limit(1).maybeSingle()).data;
  if (lead) {
    const ins = await sales.from('call_log').insert({ lead_id: lead.id, outcome: 'No answer', duration_sec: 0, notes: 'owner-decision test' }).select('id').single();
    check('Sales can log a call on a lead they can see', !ins.error, ins.error?.message);
    if (ins.data) await service.from('call_log').delete().eq('id', ins.data.id);
  } else check('Sales has a lead to test call logging with', false, 'no lead visible to Sales');

  const cand = (await service.from('candidate').select('id').limit(1).single()).data;
  const base = `${cand.id}/doc/${Date.now()}-type-check`;
  const txt = await hr.storage.from('candidate-files').upload(base + '.txt', new Blob(['x'], { type: 'text/plain' }), { contentType: 'text/plain' });
  check('The server refuses a text file in resumes and documents', !!txt.error);
  const exe = await hr.storage.from('candidate-files').upload(base + '.pdf', new Blob(['x'], { type: 'application/x-msdownload' }), { contentType: 'application/x-msdownload' });
  check('The server refuses a program file even when named .pdf', !!exe.error);
  const pdf = await hr.storage.from('candidate-files').upload(base + '-ok.pdf', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), { contentType: 'application/pdf' });
  check('The server accepts a PDF', !pdf.error, pdf.error?.message);
  await service.storage.from('candidate-files').remove([base + '.txt', base + '.pdf', base + '-ok.pdf']);
}
