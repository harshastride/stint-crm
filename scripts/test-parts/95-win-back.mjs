// Win-back list (migration 097): who sees which lost leads, what "Back to calling" does, and who may log attempts.
// Test leads are made with the service client (back-dated), then removed with everything linked to them.
export default async function ({ check, admin, tele, sales, trainer, mkt, service }) {
  const TAG = 'WinBack Test';
  const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
  const fakeMobile = () => '90000' + String(Math.floor(Math.random() * 1e5)).padStart(5, '0');
  const staffId = async (login) => (await service.from('staff').select('id').eq('email', `${login}@demo.stint.local`).single()).data?.id;
  const ids = [];

  const cleanup = async () => {
    const left = ((await service.from('lead').select('id').like('full_name', TAG + '%')).data || []).map((r) => r.id);
    if (left.length) await service.from('lead').delete().in('id', left);
    const grps = ((await service.from('recycle_bin').select('grp').like('row_label', TAG + '%')).data || []).map((r) => r.grp);
    if (grps.length) await service.from('recycle_bin').delete().in('grp', grps);
  };
  await cleanup(); // leftovers from an earlier run

  try {
    const teja = await staffId('teja'), manish = await staffId('manish');
    const add = async (name, owner, stage, changedDays, reason) => {
      const r = await service.from('lead').insert({ full_name: `${TAG} ${name}`, mobile: fakeMobile(), stage, lost_reason: reason, owner_id: owner, stage_changed_at: daysAgo(changedDays) })
        .select('id').single();
      if (r.error) throw new Error('could not add test lead: ' + r.error.message);
      ids.push(r.data.id);
      return r.data.id;
    };
    const mine = await add('Asha', teja, 'Not interested', 90, 'Fee too high');        // Teja's lost lead, past the cooling period
    const other = await add('Bala', manish, 'Not interested', 90, 'Timing not right');  // Sales owner: not Teja's team
    const fresh = await add('Chitra', teja, 'Not interested', 10, 'Fee too high');      // still cooling
    const called = await add('Dev', teja, 'Not interested', 90, 'Fee too high');        // contacted since it was lost
    await service.from('call_log').insert({ lead_id: called, caller_id: teja, outcome: 'No answer', called_at: daysAgo(5) });

    const list = async (c) => ((await c.from('winback_list').select('lead_id, owner_id, reason_group, why, last_note, days_since').in('lead_id', ids)).data || []);
    const teleRows = await list(tele), ids4 = (rows) => new Set(rows.map((r) => r.lead_id));
    check('Win-back: a telecaller sees their own lost lead after the cooling period', ids4(teleRows).has(mine), JSON.stringify(teleRows));
    check('Win-back: a telecaller does not see a lost lead owned by Sales', !ids4(teleRows).has(other));
    check('Win-back: a lead still inside the cooling period is not listed', !ids4(teleRows).has(fresh));
    check('Win-back: a lead called since it was lost is not listed', !ids4(teleRows).has(called));
    const row = teleRows.find((r) => r.lead_id === mine);
    check('Win-back: the row says why (reason and days)', row?.reason_group === 'Fee too high' && /Fee too high/.test(row?.why || '') && row?.days_since >= 89, JSON.stringify(row));

    // every row a telecaller sees belongs to their team (owner is a telecaller, or no owner)
    const allTele = (await tele.from('winback_list').select('owner_id').limit(1000)).data || [];
    const owners = [...new Set(allTele.map((r) => r.owner_id).filter(Boolean))];
    const roles = owners.length ? ((await service.from('staff').select('id, role').in('id', owners)).data || []) : [];
    check('Win-back: every lead a telecaller sees is owned by a telecaller (or nobody)', roles.every((s) => s.role === 'Telecaller'), JSON.stringify(roles));
    check('Win-back: Sales sees their own lost lead', ids4(await list(sales)).has(other));
    check('Win-back: Marketing (view only) can read the list', ids4(await list(mkt)).has(mine));
    check('Win-back: a trainer sees nothing on the list', ((await trainer.from('winback_list').select('lead_id').limit(5)).data || []).length === 0);
    check('Win-back: a trainer cannot read the summary', !!(await trainer.rpc('winback_summary')).error);
    check('Win-back: the list never has mobile numbers', !!(await tele.from('winback_list').select('mobile').limit(1)).error);
    check('Win-back: the old lost lead is still hidden from the normal lead list', ((await tele.from('lead_list').select('id').eq('id', mine)).data || []).length === 0);

    // attempts
    const meTele = (await tele.auth.getUser()).data.user?.id;
    const bad = await tele.from('winback_attempt').insert({ lead_id: other, by_id: meTele, outcome: 'skipped' });
    check('Win-back: a telecaller cannot log an attempt for a lead they cannot see', !!bad.error);
    const fake = await tele.from('winback_attempt').insert({ lead_id: mine, by_id: meTele, outcome: 'reopened' });
    check('Win-back: "Back to calling" cannot be written by hand', !!fake.error);
    const asOther = await tele.from('winback_attempt').insert({ lead_id: mine, by_id: manish, outcome: 'skipped' });
    check('Win-back: an attempt cannot be logged in someone else’s name', !!asOther.error);
    check('Win-back: a trainer cannot log attempts', !!(await trainer.from('winback_attempt').insert({ lead_id: mine, outcome: 'skipped' })).error);
    const skip = await tele.from('winback_attempt').insert({ lead_id: mine, by_id: meTele, outcome: 'skipped' }).select('id').single();
    check('Win-back: "Not now" is logged', !skip.error, skip.error?.message);
    check('Win-back: after "Not now" the lead leaves the list', !ids4(await list(tele)).has(mine));
    if (skip.data) await tele.from('winback_attempt').delete().eq('id', skip.data.id);
    check('Win-back: undoing "Not now" brings it back', ids4(await list(tele)).has(mine));

    // context for the message writer
    const ctx = await tele.rpc('winback_context', { p_lead: mine });
    check('Win-back: the message writer gets the reason and course, no contact details', !ctx.error && ctx.data?.reason === 'Fee too high' && !JSON.stringify(ctx.data).match(/90000\d{5}/), ctx.error?.message);
    check('Win-back: no message context for a lead the caller cannot see', !!(await tele.rpc('winback_context', { p_lead: other })).error);

    // back to calling
    check('Win-back: a trainer cannot bring a lead back', !!(await trainer.rpc('winback_reopen', { p_lead: mine })).error);
    check('Win-back: Marketing (view only) cannot bring a lead back', !!(await mkt.rpc('winback_reopen', { p_lead: mine })).error);
    check('Win-back: a telecaller cannot bring back a lead they cannot see', !!(await tele.rpc('winback_reopen', { p_lead: other })).error);
    const re = await tele.rpc('winback_reopen', { p_lead: mine });
    check('Win-back: Back to calling works', !re.error, re.error?.message);
    const lead = (await service.from('lead').select('stage, next_call_at, owner_id, lost_reason').eq('id', mine).single()).data;
    check('Win-back: the lead moves to Callback with a next call set', lead?.stage === 'Callback' && !!lead?.next_call_at && Date.parse(lead.next_call_at) > Date.now() - 60_000, JSON.stringify(lead));
    const fu = (await service.from('follow_up').select('owner_id, status, title').eq('lead_id', mine)).data || [];
    check('Win-back: a follow-up is made for the lead’s owner', fu.some((f) => f.owner_id === teja && f.status === 'Open' && /^Win-back call/.test(f.title)), JSON.stringify(fu));
    const att = (await service.from('winback_attempt').select('outcome, lost_reason').eq('lead_id', mine)).data || [];
    check('Win-back: the reason is kept on the attempt', att.some((a) => a.outcome === 'reopened' && a.lost_reason === 'Fee too high'), JSON.stringify(att));
    check('Win-back: after coming back the lead is a normal visible lead again', ((await tele.from('lead_list').select('id').eq('id', mine)).data || []).length === 1);
    check('Win-back: and it is off the win-back list', !ids4(await list(tele)).has(mine));
    const sum = await tele.rpc('winback_summary');
    check('Win-back: the summary counts it as back this month', !sum.error && sum.data?.back_this_month >= 1, JSON.stringify(sum.data || sum.error));
    check('Win-back: a second Back to calling is refused', !!(await tele.rpc('winback_reopen', { p_lead: mine })).error);
    check('Win-back: Admin sees every team’s lost leads', ids4(await list(admin)).has(other));
  } finally {
    await cleanup();
  }
}
