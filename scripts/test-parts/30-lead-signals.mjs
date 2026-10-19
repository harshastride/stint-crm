// Lead signals (migration 090): hot-lead score and best time to call follow the lead's own row rules.
export default async function ({ check, admin, tele, sales, trainer, anon, service }) {
  const teleId = (await tele.auth.getUser()).data.user?.id;
  const salesId = (await sales.auth.getUser()).data.user?.id;
  if (!teleId || !salesId) { check('Signals: demo logins found', false, 'telecaller or sales sign-in missing'); return; }
  const tag = 'Signal Test ' + Date.now();
  // A time on an India date, n days ago, as a UTC timestamp
  const ist = (daysAgo, h, m = 0) => {
    const n = new Date(Date.now() + 5.5 * 3600e3);
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() - daysAgo, h, m) - 5.5 * 3600e3).toISOString();
  };
  const mob = () => '8' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const old = new Date(Date.now() - 10 * 86400e3).toISOString();   // not a fresh enquiry
  const made = await service.from('lead').insert([
    { full_name: tag + ' Keen', mobile: mob(), stage: 'New', owner_id: teleId, created_at: old },
    { full_name: tag + ' Silent', mobile: mob(), stage: 'New', owner_id: teleId, created_at: old },
    { full_name: tag + ' Done', mobile: mob(), stage: 'Converted', owner_id: teleId, created_at: old },
    { full_name: tag + ' Sales only', mobile: mob(), stage: 'Counselling', owner_id: salesId, created_at: old },
  ]).select('id, full_name');
  check('Signals: test leads created', !made.error && made.data?.length === 4, made.error?.message);
  if (made.error || !made.data) return;
  const id = (suffix) => made.data.find((r) => r.full_name === tag + ' ' + suffix).id;
  const keen = id('Keen'), silent = id('Silent'), done = id('Done'), salesOnly = id('Sales only');
  try {
    const calls = await service.from('call_log').insert([
      { lead_id: keen, outcome: 'Connected', called_at: ist(2, 18, 30) },
      { lead_id: keen, outcome: 'Connected', called_at: ist(1, 19, 10) },
      { lead_id: keen, outcome: 'Interested', called_at: ist(3, 18, 15) },
      { lead_id: silent, outcome: 'No answer', called_at: ist(1, 11) },
      { lead_id: silent, outcome: 'No answer', called_at: ist(2, 11) },
      { lead_id: silent, outcome: 'No answer', called_at: ist(3, 11) },
      { lead_id: done, outcome: 'Interested', called_at: ist(1, 12) },
    ]);
    check('Signals: test calls logged', !calls.error, calls.error?.message);

    const adminRows = (await admin.from('lead_signal').select('*').in('lead_id', [keen, silent, done, salesOnly])).data || [];
    const a = adminRows.find((r) => r.lead_id === keen), b = adminRows.find((r) => r.lead_id === silent);
    check('Signals: a recent "Interested" lead scores higher than one with 3 "No answer"', !!a && !!b && a.score > b.score, JSON.stringify([a?.score, b?.score]));
    check('Signals: score is 0–100 with a matching band', [a, b].every((r) => r && r.score >= 0 && r.score <= 100
      && r.band === (r.score >= 70 ? 'Hot' : r.score >= 40 ? 'Warm' : 'Cold')), JSON.stringify([a?.band, b?.band]));
    check('Signals: reasons say why, in plain words', !!a?.reasons?.includes('Said interested 3 days ago') && !!b?.reasons?.includes('No answer 3 times') && a.reasons.length <= 3,
      JSON.stringify([a?.reasons, b?.reasons]));
    check('Signals: best time comes from the lead’s own answered calls', a?.best_from === 18 && a?.best_to === 20 && a?.best_label === 'Usually answers 6–8 pm', JSON.stringify(a && [a.best_from, a.best_to, a.best_label]));
    check('Signals: with no answered calls the team time is used (or nothing)', !b?.best_label || b.best_label.startsWith('Most leads answer '), b?.best_label);
    check('Signals: Converted leads are left out', !adminRows.some((r) => r.lead_id === done));
    check('Signals: Admin sees the Counselling lead’s signal', adminRows.some((r) => r.lead_id === salesOnly));

    // Telecaller: only leads they can see
    const teleRows = (await tele.from('lead_signal').select('lead_id, score')).data || [];
    const teleLeads = new Set(((await tele.from('lead_list').select('id')).data || []).map((r) => r.id));
    check('Signals: telecaller sees signals for their own leads', teleRows.some((r) => r.lead_id === keen) && teleRows.some((r) => r.lead_id === silent));
    check('Signals: telecaller sees signals only for leads they can see', teleRows.every((r) => teleLeads.has(r.lead_id)) && !teleRows.some((r) => r.lead_id === salesOnly),
      String(teleRows.filter((r) => !teleLeads.has(r.lead_id)).length) + ' extra');
    const same = teleRows.find((r) => r.lead_id === keen);
    check('Signals: the same lead gets the same score for every role', same?.score === a?.score, JSON.stringify([same?.score, a?.score]));
    const sneak = await tele.rpc('lead_signal_calc', { p_lead: salesOnly });
    check('Signals: telecaller cannot score a lead they cannot see by asking directly', !!sneak.error || (sneak.data || []).length === 0, JSON.stringify(sneak.data));

    // Trainer and visitors: nothing
    check('Signals: trainer sees no signals', ((await trainer.from('lead_signal').select('lead_id')).data || []).length === 0);
    const tCalc = await trainer.rpc('lead_signal_calc', { p_lead: keen });
    check('Signals: trainer cannot score a lead directly', !!tCalc.error || (tCalc.data || []).length === 0);
    const tHeat = await trainer.rpc('pickup_heatmap', { p_days: 60 }), tWin = await trainer.rpc('pickup_windows', { p_days: 60 });
    check('Signals: trainer gets no pickup heatmap or team times', (!!tHeat.error || (tHeat.data || []).length === 0) && (!!tWin.error || (tWin.data || []).length === 0));
    const v = await anon.from('lead_signal').select('lead_id');
    check('Signals: visitors without login see nothing', !!v.error || (v.data || []).length === 0);

    // Heatmap: counts calls in the grid the telecaller can see
    const heat = await tele.rpc('pickup_heatmap', { p_days: 60 });
    const cell = (heat.data || []).find((r) => r.hour === 11);
    check('Signals: telecaller gets the pickup heatmap', !heat.error && !!cell && cell.calls >= 1 && (heat.data || []).every((r) => r.weekday >= 1 && r.weekday <= 7 && r.hour >= 9 && r.hour <= 21 && r.connected <= r.calls), heat.error?.message);
    const days = await tele.rpc('pickup_heatmap_days', { p_days: 60 });
    check('Signals: heatmap period is limited for staff by the old-data rule', !days.error && days.data >= 1 && days.data <= 60, JSON.stringify(days.data));

    // Lead list: signal in the same request, sortable by score
    const list = await tele.from('lead_list').select('id, signal:lead_signal_of(score, band, best_label)').in('id', [keen, silent]).order('lead_score', { ascending: false });
    check('Signals: the lead list can read and sort by the score', !list.error && list.data?.[0]?.id === keen && list.data[0].signal?.score === a?.score, list.error?.message || JSON.stringify(list.data));
  } finally {
    const ids = [keen, silent, done, salesOnly];
    await service.from('lead').delete().in('id', ids);   // calls go with them
    const grps = ((await service.from('recycle_bin').select('grp').like('row_label', tag + '%')).data || []).map((r) => r.grp);
    if (grps.length) await service.from('recycle_bin').delete().in('grp', grps);
  }
}
