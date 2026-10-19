// Expected collections (migration 093): Finance sees totals; a role without Payments gets nothing; a crafted Due payment
// next week lands in the right India week and in the 30-day total, and counts as at risk when the student is already late.
export default async function ({ check, fin, trainer, anon, service }) {
  const LABEL = 'Collections Test Student';
  const binGroups = async () => ((await service.from('recycle_bin').select('grp').eq('row_label', LABEL)).data || []).map((r) => r.grp);
  { const g = await binGroups(); if (g.length) await service.from('recycle_bin').delete().in('grp', g); }   // leftovers from earlier runs
  await service.from('candidate').delete().eq('full_name', LABEL);

  // India today, next week's day, and the Monday that starts its week
  const ist = (d) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const addDays = (s, k) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
  const today = ist(new Date()), nextWeek = addDays(today, 7), lateDay = addDays(today, -20);
  const dow = (new Date(nextWeek + 'T00:00:00Z').getUTCDay() + 6) % 7;   // Monday = 0
  const weekOf = addDays(nextWeek, -dow);

  const fs = await fin.rpc('collections_summary', { p_days: 30 });
  check('Collections: Finance gets the 30-day summary', !fs.error && fs.data?.allowed === true && typeof Number(fs.data?.due_total) === 'number', fs.error?.message);
  const fw = await fin.rpc('expected_collections', { p_days: 56 });
  check('Collections: Finance gets 8 or 9 weeks starting this week', !fw.error && fw.data?.length >= 8 && fw.data.length <= 9 && fw.data[0].from_day === today, JSON.stringify(fw.error || fw.data?.[0]));

  const ts = await trainer.rpc('collections_summary', { p_days: 30 }), tw = await trainer.rpc('expected_collections', { p_days: 56 });
  check('Collections: Trainer gets no totals and no weeks', (!!ts.error || ts.data?.allowed === false) && ts.data?.due_total === undefined && (!!tw.error || (tw.data || []).length === 0), JSON.stringify([ts.data, tw.data?.length]));
  const as = await anon.rpc('collections_summary', { p_days: 30 });
  check('Collections: signed-out callers are refused', !!as.error);
  const ts2 = await trainer.rpc('collections_flags');
  check('Collections: Trainer sees no at-risk students', !!ts2.error || (ts2.data || []).length === 0);

  const c = (await service.from('candidate').insert({ code: 'STA-COL-' + String(Date.now()).slice(-5), full_name: LABEL, stage: 'Enrolled' }).select('id').single()).data;
  if (!c) { check('Collections: test student created', false); return; }
  const AMT = 98765, LATE = 1111;
  const week = (rows) => (rows || []).find((w) => w.week_start === weekOf);
  const before = { s: fs.data, w: week(fw.data) };
  try {
    await service.from('fee_payment').insert({ candidate_id: c.id, amount: AMT, status: 'Due', due_on: nextWeek, label: 'Collections test' });
    let s1 = (await fin.rpc('collections_summary', { p_days: 30 })).data, w1 = week((await fin.rpc('expected_collections', { p_days: 56 })).data);
    check('Collections: a Due payment next week adds to that week and the 30-day total',
      Number(w1?.due_amount) - Number(before.w?.due_amount || 0) === AMT && Number(s1?.due_total) - Number(before.s.due_total) === AMT,
      JSON.stringify({ weekOf, before: before.w?.due_amount, after: w1?.due_amount }));
    check('Collections: an on-time student is not at risk', Number(s1?.at_risk_total) === Number(before.s.at_risk_total) && !(s1?.top_at_risk || []).some((r) => r.candidate_id === c.id));

    await service.from('fee_payment').insert({ candidate_id: c.id, amount: LATE, status: 'Overdue', due_on: lateDay, label: 'Collections test late' });
    const s2 = (await fin.rpc('collections_summary', { p_days: 30 })).data, w2 = week((await fin.rpc('expected_collections', { p_days: 56 })).data);
    const me = (s2?.top_at_risk || []).find((r) => r.candidate_id === c.id);
    check('Collections: once the student is late, next week\'s instalment counts as at risk',
      Number(s2?.at_risk_total) - Number(before.s.at_risk_total) === AMT && Number(w2?.at_risk_amount) - Number(before.w?.at_risk_amount || 0) === AMT, JSON.stringify(s2?.at_risk_total));
    check('Collections: the late amount shows as overdue now, not as due', Number(s2?.overdue_now_total) - Number(before.s.overdue_now_total) === LATE && Number(s2?.due_total) - Number(before.s.due_total) === AMT);
    check('Collections: the student is in the at-risk list with days late and no contact details',
      !!me && me.name === LABEL && me.days_late === 20 && Number(me.amount) === AMT + LATE && !('mobile' in me) && !('email' in me) && !('contact' in me), JSON.stringify(me));
    const t3 = (await trainer.rpc('collections_summary', { p_days: 30 })).data;
    check('Collections: Trainer still gets nothing after the change', !t3 || t3.allowed === false);
  } finally {
    await service.from('candidate').delete().eq('id', c.id);   // payments go with the student
    await service.from('alert').delete().eq('candidate_id', c.id);
    await service.from('teams_message').delete().eq('person_name', LABEL);
    await service.from('integration_event').delete().eq('person_name', LABEL);
    const g = await binGroups(); if (g.length) await service.from('recycle_bin').delete().in('grp', g);
  }
}
