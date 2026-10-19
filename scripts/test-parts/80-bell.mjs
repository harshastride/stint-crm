// Bell: staff can mark only their own notifications seen / done, never someone else's, and never change the text.
export default async function ({ check, tele, sales, anon, service }) {
  const teleId = (await tele.auth.getUser()).data.user?.id;
  const salesId = (await sales.auth.getUser()).data.user?.id;
  if (!teleId || !salesId) { check('Bell: demo logins found', false, 'telecaller or sales sign-in missing'); return; }
  const tag = 'bell test ' + Date.now();
  // Mark-all below touches the telecaller's real unread rows: remember them and put them back afterwards.
  const before = ((await service.from('notification').select('id').eq('staff_id', teleId).is('read_at', null).is('done_at', null)).data || []).map((r) => r.id);
  const made = await service.from('notification').insert([
    { staff_id: teleId, kind: 'mention', title: tag + ' A', body: 'one', link: '/p/lead' },
    { staff_id: teleId, kind: 'follow_up', title: tag + ' B', body: 'two', link: '/p/followups' },
    { staff_id: salesId, kind: 'mention', title: tag + ' C', body: 'three', link: '/p/lead' },
  ]).select('id, staff_id, title');
  check('Bell: test notifications created', !made.error && made.data?.length === 3, made.error?.message);
  if (made.error || !made.data) return;
  const [a, b, c] = made.data;
  const row = async (id) => (await service.from('notification').select('title, body, link, staff_id, read_at, done_at').eq('id', id).single()).data;
  try {
    // Own rows: seen, done, back to the list
    const r1 = await tele.rpc('notification_mark', { p_ids: [a.id], p_read: true });
    check('Bell: a user can mark their own notification read', !r1.error && r1.data === 1 && !!(await row(a.id))?.read_at, r1.error?.message);
    const r2 = await tele.rpc('notification_mark', { p_ids: [b.id], p_done: true });
    const rb = await row(b.id);
    check('Bell: a user can mark their own notification done (it also counts as seen)', !r2.error && !!rb?.done_at && !!rb?.read_at, r2.error?.message);
    const open = (await tele.from('notification').select('id').is('done_at', null).like('title', tag + '%')).data || [];
    check('Bell: done items leave the open list', open.length === 1 && open[0].id === a.id, JSON.stringify(open));
    const r3 = await tele.rpc('notification_mark', { p_ids: [b.id], p_done: false });
    check('Bell: a done notification can be brought back', !r3.error && !(await row(b.id))?.done_at, r3.error?.message);
    const r4 = await tele.rpc('notification_mark', { p_ids: [a.id], p_read: false });
    check('Bell: a user can mark their own notification unread again', !r4.error && !(await row(a.id))?.read_at, r4.error?.message);

    // Someone else's row
    const x1 = await tele.rpc('notification_mark', { p_ids: [c.id], p_read: true, p_done: true });
    const rc = await row(c.id);
    check('Bell: a user cannot mark another user’s notification read or done', (x1.error || x1.data === 0) && !rc?.read_at && !rc?.done_at, JSON.stringify(x1.data));
    await tele.from('notification').update({ read_at: new Date().toISOString(), done_at: new Date().toISOString() }).eq('id', c.id);
    const rc2 = await row(c.id);
    check('Bell: a direct update cannot touch another user’s notification', !rc2?.read_at && !rc2?.done_at);
    const peek = (await tele.from('notification').select('id').eq('id', c.id)).data || [];
    check('Bell: a user cannot see another user’s notification', peek.length === 0);

    // Text, link and owner are fixed
    const t1 = await tele.from('notification').update({ title: 'changed', body: 'changed' }).eq('id', a.id);
    const t2 = await tele.from('notification').update({ link: 'https://example.com' }).eq('id', a.id);
    const t3 = await tele.from('notification').update({ staff_id: salesId }).eq('id', a.id);
    const ra = await row(a.id);
    check('Bell: a user cannot change the text of their notification', !!t1.error && ra?.title === tag + ' A' && ra?.body === 'one', t1.error ? '' : 'update allowed');
    check('Bell: a user cannot change where a notification links to', !!t2.error && ra?.link === '/p/lead', t2.error ? '' : 'update allowed');
    check('Bell: a user cannot hand a notification to someone else', !!t3.error && ra?.staff_id === teleId, t3.error ? '' : 'update allowed');
    const ins = await tele.from('notification').insert({ staff_id: salesId, kind: 'mention', title: tag + ' fake' });
    check('Bell: a user cannot create notifications', !!ins.error);
    const d1 = await tele.from('notification').update({ read_at: new Date().toISOString() }).eq('id', a.id).select('id');
    check('Bell: the seen time can still be set directly on your own row', !d1.error && d1.data?.length === 1, d1.error?.message);

    // Mark all read: only my open rows
    await service.from('notification').update({ read_at: null }).eq('id', a.id);
    const all = await tele.rpc('notification_mark', { p_ids: null, p_read: true });
    check('Bell: "Mark all read" marks my open notifications', !all.error && !!(await row(a.id))?.read_at && !!(await row(b.id))?.read_at, all.error?.message);
    check('Bell: "Mark all read" leaves other people’s notifications alone', !(await row(c.id))?.read_at);
    const bad = await tele.rpc('notification_mark', { p_ids: null, p_done: false });
    check('Bell: bringing back needs a choice of notifications', !!bad.error);
    const an = await anon.rpc('notification_mark', { p_ids: [a.id], p_read: true });
    check('Bell: signed-out visitors cannot mark notifications', !!an.error);
  } finally {
    await service.from('notification').delete().in('id', [a.id, b.id, c.id]);
    await service.from('notification').delete().like('title', tag + '%');
    if (before.length) await service.from('notification').update({ read_at: null }).in('id', before);
  }
}
