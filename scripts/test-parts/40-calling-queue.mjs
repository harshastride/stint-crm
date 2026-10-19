// Start my calls (migration 091): my_call_queue returns only my leads that I can see, in calling order, without contact details.
// Crafted case for the telecaller: an overdue follow-up, a next call later today, a new lead nobody called, a follow-up for
// tomorrow, and a lead owned by Sales. Cleans up every row it makes (and their recycle-bin copies).
export default async function ({ check, tele, sales, trainer, anon, service }) {
  const teleId = (await tele.auth.getUser()).data.user?.id;
  const salesId = (await sales.auth.getUser()).data.user?.id;
  if (!teleId || !salesId) { check('Queue: demo logins found', false, 'telecaller or sales sign-in missing'); return; }

  const tag = 'Queue Test ' + Date.now();
  const ist = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const startOf = (ymd) => new Date(ymd + 'T00:00:00+05:30').getTime();
  const now = Date.now();
  const endToday = startOf(ist(now + 864e5));
  const laterToday = Math.min(now + 30 * 60e3, endToday - 60e3);   // still today in India time
  const tomorrowNoon = endToday + 12 * 3600e3;
  const fake = () => '90000' + String(Math.floor(Math.random() * 1e5)).padStart(5, '0');   // made-up numbers, not real people

  const made = await service.from('lead').insert([
    { full_name: tag + ' A overdue', mobile: fake(), owner_id: teleId, stage: 'Callback' },
    { full_name: tag + ' B later', mobile: fake(), owner_id: teleId, stage: 'Callback', next_call_at: new Date(laterToday).toISOString() },
    { full_name: tag + ' C tomorrow', mobile: fake(), owner_id: teleId, stage: 'Callback' },
    { full_name: tag + ' D sales', mobile: fake(), owner_id: salesId, stage: 'Interested' },
    { full_name: tag + ' E new', mobile: fake(), owner_id: teleId, stage: 'New' },
  ]).select('id, full_name');
  check('Queue: test leads created', !made.error && made.data?.length === 5, made.error?.message);
  if (made.error || !made.data) return;
  const id = Object.fromEntries(made.data.map((r) => [r.full_name.slice(tag.length + 1, tag.length + 2), r.id]));
  const leadIds = made.data.map((r) => r.id);
  const fus = await service.from('follow_up').insert([
    { title: 'Call back', lead_id: id.A, owner_id: teleId, owner_role: 'Telecaller', due_at: new Date(now - 3 * 3600e3).toISOString() },
    { title: 'Call back', lead_id: id.C, owner_id: teleId, owner_role: 'Telecaller', due_at: new Date(tomorrowNoon).toISOString() },
    { title: 'Call back', lead_id: id.D, owner_id: salesId, owner_role: 'Sales', due_at: new Date(now - 3600e3).toISOString() },
  ]).select('id');
  check('Queue: test follow-ups created', !fus.error && fus.data?.length === 3, fus.error?.message);
  const callIds = [];

  try {
    const q = await tele.rpc('my_call_queue');
    const rows = q.data || [];
    const at = (lid) => rows.findIndex((r) => r.lead_id === lid);
    check('Queue: the telecaller can read their list', !q.error, q.error?.message);
    check('Queue: overdue follow-up, next call later today and an uncalled new lead are in the list', at(id.A) >= 0 && at(id.B) >= 0 && at(id.E) >= 0, JSON.stringify(rows.map((r) => r.full_name)));
    check('Queue: a follow-up due tomorrow is not in today’s list', at(id.C) < 0);
    check('Queue: another person’s lead is not in my list', at(id.D) < 0);
    check('Queue: overdue comes before due later today', at(id.A) >= 0 && at(id.A) < at(id.B) && at(id.E) < at(id.B));
    const a = rows[at(id.A)], b = rows[at(id.B)], e = rows[at(id.E)];
    check('Queue: overdue and due-later are marked', a?.overdue === true && a?.due_kind === 'follow_up' && b?.overdue === false && b?.due_kind === 'next_call' && e?.due_kind === 'new_lead', JSON.stringify({ a, b, e }));
    check('Queue: the list is numbered in order', rows.every((r, n) => r.pos === n + 1));
    check('Queue: no contact details in the list', rows.every((r) => !Object.keys(r).some((k) => /mobile|email|phone/i.test(k))), Object.keys(rows[0] || {}).join(','));
    const seen = ((await tele.from('lead_list').select('id').in('id', rows.map((r) => r.lead_id))).data || []).length;
    check('Queue: every lead in the list is one the telecaller can see', seen === rows.length, `${seen} of ${rows.length}`);

    // A call logged now makes the lead done for today, after the ones still to call
    const c = await tele.from('call_log').insert({ lead_id: id.B, caller_id: teleId, outcome: 'Connected', duration_sec: 60 }).select('id').single();
    if (c.data?.id) callIds.push(c.data.id);
    const q2 = (await tele.rpc('my_call_queue')).data || [];
    const b2 = q2.find((r) => r.lead_id === id.B);
    // B was due later today; a call before its time does not tick it off, so check with A (overdue) instead
    const c2 = await tele.from('call_log').insert({ lead_id: id.A, caller_id: teleId, outcome: 'No answer', duration_sec: 0 }).select('id').single();
    if (c2.data?.id) callIds.push(c2.data.id);
    const q3 = (await tele.rpc('my_call_queue')).data || [];
    const a3 = q3.find((r) => r.lead_id === id.A);
    check('Queue: a call before the due time leaves the lead to call again later', b2 && !b2.done_today, JSON.stringify(b2));
    check('Queue: calling an overdue lead marks it done today and moves it to the end', !!a3?.done_today && q3.slice(q3.indexOf(a3)).every((r) => r.done_today), JSON.stringify(q3.map((r) => [r.full_name, r.done_today])));

    const tq = (await tele.rpc('my_call_queue', { p_day: ist(endToday + 3600e3) })).data || [];
    check('Queue: tomorrow’s list has the follow-up due tomorrow', tq.some((r) => r.lead_id === id.C));

    const sq = (await sales.rpc('my_call_queue')).data || [];
    check('Queue: Sales sees their own lead and not the telecaller’s', sq.some((r) => r.lead_id === id.D) && !sq.some((r) => r.lead_id === id.A || r.lead_id === id.B));

    const tr = await trainer.rpc('my_call_queue');
    check('Queue: a trainer gets nothing', !!tr.error || (tr.data || []).length === 0, JSON.stringify(tr.data));
    const an = await anon.rpc('my_call_queue');
    check('Queue: signed-out visitors get nothing', !!an.error || (an.data || []).length === 0);
  } finally {
    const fuIds = (fus.data || []).map((r) => r.id);
    const extraFu = ((await service.from('follow_up').select('id').in('lead_id', leadIds)).data || []).map((r) => r.id);
    const allFu = [...new Set([...fuIds, ...extraFu])];
    if (callIds.length) await service.from('call_log').delete().in('id', callIds);
    await service.from('call_log').delete().in('lead_id', leadIds);
    if (allFu.length) await service.from('follow_up').delete().in('id', allFu);
    await service.from('lead').delete().in('id', leadIds);
    await service.from('recycle_bin').delete().in('row_id', [...leadIds, ...allFu, ...callIds]);
    await service.from('notification').delete().like('body', tag + '%');
    const ev = ((await service.from('integration_event').select('id').in('entity_id', leadIds)).data || []).map((r) => r.id);
    if (ev.length) { await service.from('teams_message').delete().in('source_event_id', ev); await service.from('integration_event').delete().in('id', ev); }
  }
}
