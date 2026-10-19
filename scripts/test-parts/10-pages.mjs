// Pages added by migrations 086-097: sidebar order (same on a fresh and an upgraded database), placement helper is not
// open to staff, and the Ask the CRM default access.
export default async function ({ check, admin, tele, service }) {
  for (const [who, c] of [['admin', admin], ['telecaller', tele]]) {
    const r = await c.rpc('page_place', { p_id: 'queue', p_anchor: 'home' });
    check(`page_place (sidebar order) is not open to signed-in users: ${who} refused`, !!r.error);
  }
  const pages = (await service.from('page').select('id, grp, sort').order('sort').order('id')).data || [];
  const order = (grp) => pages.filter((p) => p.grp === grp).map((p) => p.id);
  const sorts = (grp) => pages.filter((p) => p.grp === grp).map((p) => p.sort);
  const tele1 = order('Telecalling').filter((id) => ['queue', 'lead', 'inbox', 'call', 'recordings', 'winback'].includes(id)).join();
  check('sidebar: Telecalling reads Start my calls, Leads, New conversations, Call logs, Recordings, Win-back', tele1 === 'queue,lead,inbox,call,recordings,winback', tele1);
  const sales1 = order('Sales').filter((id) => ['counsel', 'quote', 'target', 'playbook', 'brochures'].includes(id)).join();
  check('sidebar: Sales ends with Sales targets, Sales playbook, Brochures', sales1 === 'counsel,quote,target,playbook,brochures', sales1);
  const rep = order('Reports');
  check('sidebar: Reports starts with Ask the CRM and ends with Staff scorecard', rep[0] === 'ask' && rep[rep.length - 1] === 'scorecard', rep.join());
  for (const g of ['Telecalling', 'Sales', 'Reports']) {
    const s = sorts(g);
    check(`sidebar: no two ${g} pages share a place`, new Set(s).size === s.length, s.join());
  }
  const ask = ((await service.from('role_page_access').select('role').eq('page_id', 'ask')).data || []).map((r) => r.role).sort().join();
  check('Ask the CRM: open by default to Finance and Sales only', ask === 'Finance,Sales', ask);
}
