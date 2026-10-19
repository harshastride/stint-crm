// Ask the CRM (migration 094): the AI only fills a report request; run_report() runs it as the caller.
// Checks: page and default grants, the gate on run_report, row security for an Ask-only role, and the Admin-only log.
export default async function ({ check, admin, tele, sales, trainer, fin, service }) {
  const run = (c, d) => c.rpc('run_report', { p_def: d });
  const leadsByStage = { source: 'leads', group_by: [{ field: 'stage' }], measures: [{ agg: 'count' }], limit: 5000 };
  const total = (r) => (r.data?.rows || []).reduce((a, x) => a + Number(x.count || 0), 0);

  const { data: page } = await service.from('page').select('grp, sort').eq('id', 'ask').maybeSingle();
  const { data: reports } = await service.from('page').select('id, sort').eq('grp', 'Reports').neq('id', 'ask');
  check('ask: page exists first under Reports', page?.grp === 'Reports' && (reports || []).every((p) => p.sort > page.sort), JSON.stringify({ page, reports }));
  const { data: grants } = await service.from('role_page_access').select('role').eq('page_id', 'ask');
  const gr = (grants || []).map((g) => g.role);
  check('ask: Finance and Sales get Ask the CRM by default', gr.includes('Finance') && gr.includes('Sales'), gr.join(','));
  check('ask: Telecaller and Trainer do not get it by default', !gr.includes('Telecaller') && !gr.includes('Trainer'), gr.join(','));

  // Trainer: no Ask, no Report builder, no Leads page → nothing
  const t0 = await run(trainer, leadsByStage);
  check('ask: Trainer cannot run a leads report', !!t0.error && !t0.data, JSON.stringify(t0.data));

  // Sales (has Ask + Leads): works
  const s0 = await run(sales, leadsByStage);
  check('ask: Sales can run a leads report', !s0.error && Array.isArray(s0.data?.rows), s0.error?.message);

  // Finance (has Ask, no Leads): leads source refused, payments fine
  const f0 = await run(fin, leadsByStage);
  check('ask: Finance cannot run a leads report (no Leads page)', !!f0.error, JSON.stringify(f0.data));

  // Telecaller without Ask or the builder: refused
  const tl0 = await run(tele, leadsByStage);
  check('ask: Telecaller without Ask cannot run reports', !!tl0.error, JSON.stringify(tl0.data));

  // Give Ask (only) to Telecaller and Trainer for a moment
  await service.from('role_page_access').insert([{ role: 'Telecaller', page_id: 'ask', mode: 'r' }, { role: 'Trainer', page_id: 'ask', mode: 'r' }]);
  const logIns = await service.from('ask_log').insert({ staff_id: null, question: 'test-part 70 question', spec: { source: 'leads' }, ok: true }).select('id').single();
  try {
    const t1 = await run(trainer, leadsByStage);
    check('ask: Trainer with Ask still cannot run leads (no Leads page)', !!t1.error, JSON.stringify(t1.data));
    const { data: tsrc } = await trainer.from('report_source').select('key');
    check('ask: Trainer with Ask does not see the leads source in the catalogue', !(tsrc || []).some((x) => x.key === 'leads'), JSON.stringify(tsrc));

    const { data: srcs } = await tele.from('report_source').select('key');
    const keys = (srcs || []).map((x) => x.key);
    check('ask: Telecaller with Ask sees the leads source but not fee payments', keys.includes('leads') && !keys.includes('payments'), keys.join(','));
    const tl1 = await run(tele, leadsByStage);
    const { count: visible } = await tele.from('lead_list').select('id', { count: 'exact', head: true });
    const { count: all } = await service.from('lead').select('id', { count: 'exact', head: true });
    check('ask: Telecaller with Ask counts only the leads they can see', !tl1.error && total(tl1) === visible && total(tl1) <= (all ?? 0),
      JSON.stringify({ err: tl1.error?.message, counted: total(tl1), visible, all }));
    const tp = await run(tele, { source: 'payments', group_by: [{ field: 'status' }] });
    check('ask: Telecaller with Ask still cannot run fees (no Payments page)', !!tp.error, JSON.stringify(tp.data));
    for (const col of ['mobile', 'email']) {
      const r = await run(tele, { source: 'leads', columns: [col] });
      check(`ask: lead ${col} is not selectable through Ask`, !!r.error);
    }

    // The question log: Admin only, written only by the server
    check('ask: question log row written by the server', !logIns.error, logIns.error?.message);
    const { data: tl } = await tele.from('ask_log').select('id');
    check('ask: Telecaller cannot read the question log', (tl || []).length === 0, String((tl || []).length));
    const { data: sl } = await sales.from('ask_log').select('id');
    check('ask: Sales cannot read the question log', (sl || []).length === 0, String((sl || []).length));
    const { data: al } = await admin.from('ask_log').select('id').eq('id', logIns.data?.id ?? -1);
    check('ask: Admin can read the question log', (al || []).length === 1, String((al || []).length));
    const w = await sales.from('ask_log').insert({ question: 'x', ok: true });
    check('ask: staff cannot write the question log', !!w.error);
  } finally {
    await service.from('role_page_access').delete().eq('page_id', 'ask').in('role', ['Telecaller', 'Trainer']);
    if (logIns.data?.id) await service.from('ask_log').delete().eq('id', logIns.data.id);
  }
}
