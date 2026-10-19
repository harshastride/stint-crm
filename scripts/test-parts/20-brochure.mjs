// Course brochures (migrations 088–089): sends and views are written only by the server, follow the lead's row rules,
// the open recorder is server-only, and the public tracker ignores unknown links.
export default async function ({ env, check, admin, tele, sales, trainer, anon, service }) {
  const teleId = (await tele.auth.getUser()).data.user?.id;
  const salesId = (await sales.auth.getUser()).data.user?.id;
  if (!teleId || !salesId) { check('Brochure: demo logins found', false, 'telecaller or sales sign-in missing'); return; }
  const tag = 'Brochure Test ' + Date.now();
  const mob = () => '7' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const made = await service.from('lead').insert([
    { full_name: tag + ' Mine', mobile: mob(), stage: 'New', owner_id: teleId },
    { full_name: tag + ' Sales', mobile: mob(), stage: 'Counselling', owner_id: salesId },
  ]).select('id, full_name');
  check('Brochure: test leads created', !made.error && made.data?.length === 2, made.error?.message);
  if (made.error || !made.data) return;
  const mine = made.data.find((r) => r.full_name.endsWith('Mine')).id, other = made.data.find((r) => r.full_name.endsWith('Sales')).id;
  const bro = await service.from('brochure').insert({ title: tag, status: 'Live', file_path: 'test0000/brochure.pdf' }).select('id').single();
  check('Brochure: test brochure created', !bro.error, bro.error?.message);
  let objectPath = null;
  try {
    if (bro.error) return;
    const sends = await service.from('brochure_send').insert([{ brochure_id: bro.data.id, lead_id: mine, sent_by: teleId }, { brochure_id: bro.data.id, lead_id: other, sent_by: salesId }]).select('id, token, lead_id');
    check('Brochure: server can create sends', !sends.error && sends.data?.length === 2, sends.error?.message);
    if (sends.error) return;
    const sMine = sends.data.find((x) => x.lead_id === mine), sOther = sends.data.find((x) => x.lead_id === other);

    // writes by signed-in staff are refused
    const ins = await tele.from('brochure_send').insert({ brochure_id: bro.data.id, lead_id: mine });
    check('Brochure: telecaller cannot create a send directly', !!ins.error);
    const view = await tele.from('brochure_view').insert({ send_id: sMine.id, lead_id: mine, page: 1, seconds: 30 });
    check('Brochure: telecaller cannot add a view directly', !!view.error);
    const upd = await tele.from('brochure_send').update({ open_count: 99 }).eq('id', sMine.id).select('id');
    check('Brochure: telecaller cannot change open counts', !!upd.error || (upd.data || []).length === 0);
    const newBro = await tele.from('brochure').insert({ title: tag + ' fake' });
    check('Brochure: telecaller (view only) cannot add a brochure', !!newBro.error);

    // reads follow the lead
    const tSends = ((await tele.from('brochure_send').select('lead_id').in('id', [sMine.id, sOther.id])).data || []).map((r) => r.lead_id);
    check('Brochure: telecaller sees the send for their own lead', tSends.includes(mine), JSON.stringify(tSends));
    check('Brochure: telecaller cannot read sends for a lead they cannot see', !tSends.includes(other), JSON.stringify(tSends));
    const tList = ((await tele.from('brochure_send_list').select('lead_id').in('id', [sMine.id, sOther.id])).data || []).map((r) => r.lead_id);
    check('Brochure: the send list view follows the same rule', tList.includes(mine) && !tList.includes(other), JSON.stringify(tList));
    const aList = (await admin.from('brochure_send_list').select('id').in('id', [sMine.id, sOther.id])).data || [];
    check('Brochure: admin sees both sends', aList.length === 2, String(aList.length));
    const trB = (await trainer.from('brochure').select('id').eq('id', bro.data.id)).data || [];
    const trS = (await trainer.from('brochure_summary').select('id').eq('id', bro.data.id)).data || [];
    check('Brochure: trainer cannot read brochures', trB.length === 0 && trS.length === 0, JSON.stringify([trB.length, trS.length]));

    // the open recorder is server-only
    for (const [who, c] of [['visitor', anon], ['telecaller', tele], ['admin', admin]]) {
      const r = await c.rpc('brochure_track', { p_token: sMine.token, p_events: [{ page: 1, seconds: 10 }] });
      check(`Brochure: brochure_track not callable by ${who}`, !!r.error);
    }
    const still = (await service.from('brochure_send').select('open_count').eq('id', sMine.id).single()).data;
    check('Brochure: refused calls changed nothing', still?.open_count === 0, JSON.stringify(still));

    // storage: only writers upload; nobody signed out reads
    const upTele = await tele.storage.from('brochures').upload(`test0000/${Date.now()}.pdf`, new Blob(['%PDF-1.4'], { type: 'application/pdf' }), { contentType: 'application/pdf' });
    check('Brochure: telecaller cannot upload a brochure PDF', !!upTele.error);
    objectPath = `test0000/${Date.now()}-admin.pdf`;
    const upAdmin = await admin.storage.from('brochures').upload(objectPath, new Blob(['%PDF-1.4'], { type: 'application/pdf' }), { contentType: 'application/pdf' });
    check('Brochure: admin can upload a brochure PDF', !upAdmin.error, upAdmin.error?.message);
    if (upAdmin.error) objectPath = null;
    else {
      const dl = await anon.storage.from('brochures').download(objectPath);
      check('Brochure: signed-out visitor cannot read the PDF', !!dl.error || !dl.data);
      const tl = await tele.storage.from('brochures').download(objectPath);
      check('Brochure: telecaller reads the PDF only through a server link', !!tl.error || !tl.data);
    }

    // server path: an open records views, counts once per visit, and alerts the owner
    const t1 = await service.rpc('brochure_track', { p_token: sMine.token, p_events: [{ page: 0, seconds: 0 }] });
    check('Brochure: server records an open', t1.data?.ok === true && t1.data?.opened === true, JSON.stringify(t1.data || t1.error?.message));
    const t2 = await service.rpc('brochure_track', { p_token: sMine.token, p_events: [{ page: 2, seconds: 9999 }, { page: 'x', seconds: 5 }] });
    const after = (await service.from('brochure_send').select('open_count, total_seconds, first_opened_at').eq('id', sMine.id).single()).data;
    check('Brochure: a heartbeat is not a new open, and seconds are capped to real time', t2.data?.opened === false && after?.open_count === 1 && after.total_seconds <= 30, JSON.stringify(after));
    const note = (await service.from('notification').select('id, kind, title, link').eq('staff_id', teleId).eq('kind', 'brochure').like('link', '%' + mine)).data || [];
    check('Brochure: the lead owner gets a "call now" notification', note.length === 1 && /reading the brochure/.test(note[0].title), JSON.stringify(note));
    const ev = (await service.from('integration_event').select('id').eq('event', 'brochure.opened').eq('entity_id', mine)).data || [];
    check('Brochure: a brochure.opened event is raised', ev.length >= 1, String(ev.length));
    const views = (await tele.from('brochure_view').select('page').eq('send_id', sMine.id)).data || [];
    check('Brochure: telecaller sees the views of their own lead', views.length >= 2, String(views.length));

    // bad tokens change nothing (database and public route)
    const before = (await service.from('brochure_send').select('open_count, total_seconds').in('id', [sMine.id, sOther.id])).data;
    for (const bad of ['nope', 'f'.repeat(36), sMine.token + "' or 1=1--"]) {
      const r = await service.rpc('brochure_track', { p_token: bad, p_events: [{ page: 1, seconds: 60 }] });
      check(`Brochure: unknown link ${JSON.stringify(bad.slice(0, 12))} is refused`, r.data?.ok === false, JSON.stringify(r.data || r.error?.message));
    }
    const APP = env.APP_URL || 'http://localhost:3100';
    const res = await fetch(APP + '/api/brochures/track', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'a'.repeat(36), events: [{ page: 1, seconds: 60 }] }) }).catch(() => null);
    if (!res || res.status === 404) console.log('SKIP brochure public tracker check: app not running (or not this version) on ' + APP);
    else check('Brochure: public tracker with a bad link answers 200 (no hint)', res.status === 200, String(res.status));
    const nowRows = (await service.from('brochure_send').select('open_count, total_seconds').in('id', [sMine.id, sOther.id])).data;
    check('Brochure: bad links changed no send', JSON.stringify(before) === JSON.stringify(nowRows), JSON.stringify([before, nowRows]));

    // switched off: links stop recording
    await service.from('brochure').update({ status: 'Off' }).eq('id', bro.data.id);
    const off = await service.rpc('brochure_track', { p_token: sOther.token, p_events: [{ page: 0, seconds: 0 }] });
    check('Brochure: a switched-off brochure records nothing', off.data?.ok === false, JSON.stringify(off.data));
  } finally {
    await service.from('notification').delete().eq('kind', 'brochure').in('link', [`/p/lead?person=lead:${mine}`, `/p/lead?person=lead:${other}`]);
    await service.from('integration_event').delete().eq('event', 'brochure.opened').in('entity_id', [mine, other]);
    if (objectPath) await service.storage.from('brochures').remove([objectPath]);
    await service.from('lead').delete().in('id', [mine, other]);   // sends and views go with them
    if (!bro.error) await service.from('brochure').delete().eq('id', bro.data.id);
    const grps = ((await service.from('recycle_bin').select('grp').like('row_label', tag + '%')).data || []).map((r) => r.grp);
    if (grps.length) await service.from('recycle_bin').delete().in('grp', grps);
  }
}
