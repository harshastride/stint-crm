// Staff scorecard (migration 092): who sees whose numbers, and that the numbers match crafted rows.
// Uses an old, otherwise empty week (Mon 8 – Sun 14 Jan 2024, India time) so real data never mixes in.
export default async function ({ env, createClient, check, admin, tele, sales, trainer, anon, service }) {
  const PASSWORD = env.DEMO_PASSWORD || 'stint-demo-1234';
  const junior = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const signIn = await junior.auth.signInWithPassword({ email: 'pooja@demo.stint.local', password: PASSWORD });
  const juniorId = signIn.data.user?.id;
  const headId = (await tele.auth.getUser()).data.user?.id;
  const salesId = (await sales.auth.getUser()).data.user?.id;
  if (!juniorId || !headId || !salesId) { check('Scorecard: demo logins found (pooja, teja, manish)', false, signIn.error?.message || 'missing'); return; }

  const W = { p_from: '2024-01-08', p_to: '2024-01-14' };
  const tag = 'Scorecard Test ' + Date.now();
  const prog = (await service.from('program').select('id').limit(1).single()).data;
  const lead = (await service.from('lead').insert({ full_name: tag, mobile: '90000' + String(Date.now()).slice(-5), owner_id: juniorId, created_by: juniorId, stage: 'Interested' }).select('id').single()).data;
  if (!lead || !prog) { check('Scorecard: test lead created', false, 'no lead or program'); return; }
  let cand = null;
  try {
    const calls = await service.from('call_log').insert([
      { lead_id: lead.id, caller_id: juniorId, outcome: 'Connected', duration_sec: 125, called_at: '2024-01-09T10:00:00+05:30' },
      { lead_id: lead.id, caller_id: juniorId, outcome: 'No answer', duration_sec: 0, called_at: '2024-01-10T11:00:00+05:30' },
      { lead_id: lead.id, caller_id: juniorId, outcome: 'Booked counselling', duration_sec: 60, called_at: '2024-01-14T23:50:00+05:30' }, // last minutes of Sunday, India time
      { lead_id: lead.id, caller_id: juniorId, outcome: 'Connected', duration_sec: 300, called_at: '2024-01-15T00:10:00+05:30' },        // Monday India time: next week
      { lead_id: lead.id, caller_id: juniorId, outcome: 'Connected', duration_sec: 30, called_at: '2024-01-02T12:00:00+05:30' },         // the week before
    ]);
    check('Scorecard: test calls created', !calls.error, calls.error?.message);
    const quote = await service.from('fee_quote').insert({ lead_id: lead.id, program_id: prog.id, list_price: 50000, amount: 50000, created_by: juniorId, created_at: '2024-01-11T09:00:00+05:30' });
    check('Scorecard: test quote created', !quote.error, quote.error?.message);
    const c = await service.from('candidate').insert({ full_name: tag, lead_id: lead.id, program_id: prog.id, joined_on: '2024-01-12' }).select('id').single();
    cand = c.data;
    check('Scorecard: test enrolment created', !c.error, c.error?.message);

    // Who sees whom
    const j = await junior.rpc('staff_scorecard', W);
    check('Scorecard: a junior telecaller sees only their own row', !j.error && j.data?.length === 1 && j.data[0].staff_id === juniorId && j.data[0].is_me === true, j.error?.message || JSON.stringify(j.data?.map((r) => r.name)));
    const h = await tele.rpc('staff_scorecard', W);
    const hRows = h.data || [];
    check('Scorecard: a team head sees their team (themselves and the junior)', !h.error && hRows.some((r) => r.staff_id === juniorId) && hRows.some((r) => r.staff_id === headId), h.error?.message);
    check('Scorecard: a team head sees no one from another team', !h.error && hRows.every((r) => r.role === 'Telecaller'), JSON.stringify(hRows.map((r) => r.role)));
    const a = await admin.rpc('staff_scorecard', W);
    const aRows = a.data || [];
    check('Scorecard: Admin sees every team', !a.error && aRows.some((r) => r.staff_id === juniorId) && aRows.some((r) => r.staff_id === salesId) && new Set(aRows.map((r) => r.role)).size >= 3, a.error?.message);
    const t = await trainer.rpc('staff_scorecard', W);
    check('Scorecard: a trainer gets nothing', !!t.error && !(t.data || []).length);
    const n = await anon.rpc('staff_scorecard', W);
    check('Scorecard: signed-out visitors get nothing', !!n.error && !(n.data || []).length);
    const raw = await tele.rpc('scorecard_counts', W);
    check('Scorecard: the raw counts helper cannot be called directly', !!raw.error);

    // Numbers
    const r = j.data?.[0] || {};
    check('Scorecard: calls counted by India date (Sunday 23:50 in, Monday 00:10 out)', r.calls === 3, JSON.stringify(r));
    check('Scorecard: connected excludes No answer', r.connected === 2 && Number(r.connected_pct) === 66.7, `${r.connected} / ${r.connected_pct}`);
    check('Scorecard: talk time is the call length in minutes', Number(r.talk_minutes) === 3.1, String(r.talk_minutes));
    check('Scorecard: counselling booked, quotes sent and enrolments counted', r.counselling_booked === 1 && r.quotes_sent === 1 && r.enrolments === 1, JSON.stringify([r.counselling_booked, r.quotes_sent, r.enrolments]));
    check('Scorecard: earlier weeks before the person joined are left out of their average', r.prev_periods === 1 && Number(r.prev4_avg_calls) === 1 && Number(r.prev4_avg_connected_pct) === 100, JSON.stringify([r.prev_periods, r.prev4_avg_calls, r.prev4_avg_connected_pct]));
    check('Scorecard: the history lists the 4 earlier weeks', Array.isArray(r.history) && r.history.length === 4 && r.history[3]?.from === '2024-01-01' && r.history[3]?.calls === 1, JSON.stringify(r.history));
    check('Scorecard: a person with no calls shows connected % as empty, not 0', aRows.filter((x) => x.calls === 0).every((x) => x.connected_pct === null));
    const hj = hRows.find((x) => x.staff_id === juniorId);
    check('Scorecard: the head sees the same numbers for the junior', hj?.calls === 3 && hj?.enrolments === 1);

    // Team average
    const tj = await junior.rpc('staff_scorecard_team', W);
    const tjr = (tj.data || [])[0];
    check('Scorecard: a junior sees only their own team’s average', !tj.error && (tj.data || []).length === 1 && tjr?.role === 'Telecaller', tj.error?.message);
    check('Scorecard: a small team’s average is hidden from a junior', tjr && (tjr.people >= 3 ? tjr.shown === true : tjr.shown === false && tjr.avg_calls === null), JSON.stringify(tjr));
    const ta = await admin.rpc('staff_scorecard_team', W);
    const tel = (ta.data || []).find((x) => x.role === 'Telecaller');
    check('Scorecard: Admin sees the team average', !ta.error && tel?.shown === true && Number(tel?.avg_calls) >= 3 / Math.max(1, tel?.people || 1) - 0.05, JSON.stringify(tel));
    const tt = await trainer.rpc('staff_scorecard_team', W);
    check('Scorecard: a trainer gets no team average', !!tt.error && !(tt.data || []).length);

    // Period checks
    const bad = await admin.rpc('staff_scorecard', { p_from: '2024-01-14', p_to: '2024-01-08' });
    const long = await admin.rpc('staff_scorecard', { p_from: '2023-01-01', p_to: '2024-01-08' });
    check('Scorecard: a back-to-front or over-long period is refused', !!bad.error && !!long.error);
  } finally {
    if (cand?.id) await service.from('candidate').delete().eq('id', cand.id);
    await service.from('lead').delete().eq('id', lead.id); // calls and quote go with it
    const grps = ((await service.from('recycle_bin').select('grp').eq('row_label', tag)).data || []).map((x) => x.grp);
    if (grps.length) await service.from('recycle_bin').delete().in('grp', grps);
    await junior.auth.signOut();
  }
}
