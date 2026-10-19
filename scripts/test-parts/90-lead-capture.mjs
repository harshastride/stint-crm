// Lead capture (migration 096): new conversations from WhatsApp, missed calls → leads. Staff never get the full number.
export default async function ({ env, check, admin, tele, trainer, desk, anon, service }) {
  const APP = env.APP_URL || 'http://localhost:3100';
  const stamp = String(Date.now()).slice(-8);
  const waNum = '9196' + stamp;          // WhatsApp sender, international form
  const callNum = '97' + stamp;          // missed call, 10 digits
  const leads = [], convs = [];
  const conv = async (n) => (await service.from('capture_conversation').select('id, number, status, lead_id, auto_replied_at').eq('number', n).maybeSingle()).data;
  const saved = (await service.from('setting').select('value').eq('key', 'capture_auto_create').maybeSingle()).data?.value ?? 'off';

  try {
    // Only the server may feed the inbox
    { const r = await tele.rpc('capture_inbound', { p_channel: 'whatsapp', p_number: waNum, p_body: 'Hi' });
      check('Lead capture: staff cannot post inbound messages themselves', !!r.error); }
    { const r = await anon.rpc('capture_inbound', { p_channel: 'whatsapp', p_number: waNum, p_body: 'Hi' });
      check('Lead capture: signed-out visitors cannot post inbound messages', !!r.error); }

    // A WhatsApp "Hi" from an unknown number (auto-create off): a new conversation + one queued auto-reply
    await service.from('setting').update({ value: 'off' }).eq('key', 'capture_auto_create');
    const a = await service.rpc('capture_inbound', { p_channel: 'whatsapp', p_number: '+' + waNum, p_body: 'Hi, course details please', p_provider_id: 'test.wamid.' + stamp, p_profile_name: 'Test Capture' });
    const c1 = await conv(waNum); if (c1) convs.push(c1.id);
    check('Lead capture: an unknown WhatsApp number becomes a new conversation', a.data?.kind === 'conversation' && c1?.status === 'New' && !c1.lead_id, JSON.stringify(a.error || a.data));
    const again = await service.rpc('capture_inbound', { p_channel: 'whatsapp', p_number: waNum, p_body: 'Hello?', p_provider_id: 'test.wamid.' + stamp + 'b' });
    const retry = await service.rpc('capture_inbound', { p_channel: 'whatsapp', p_number: waNum, p_body: 'Hello?', p_provider_id: 'test.wamid.' + stamp + 'b' });
    const outs = (await service.from('message').select('id, status').eq('conversation_id', c1?.id).eq('direction', 'out')).data || [];
    const ins = (await service.from('message').select('id').eq('conversation_id', c1?.id).eq('direction', 'in')).data || [];
    check('Lead capture: one auto-reply per number per 24 hours, queued until sent', outs.length === 1 && !again.data?.reply_id, JSON.stringify(outs));
    check('Lead capture: a repeated delivery of the same message is stored once', retry.data?.duplicate === true && ins.length === 2, String(ins.length));

    // Staff see the masked number only
    { const r = await tele.from('capture_conversation').select('id, number_masked, profile_name').eq('id', c1?.id);
      const row = r.data?.[0];
      check('Lead capture: telecaller sees the conversation with a masked number', !!row && /^•+\d{4}$/.test(row.number_masked) && !JSON.stringify(r.data).includes(stamp.slice(0, 4) + stamp.slice(4)), JSON.stringify(r.error || r.data)); }
    { const r = await tele.from('capture_conversation').select('number').eq('id', c1?.id);
      check('Lead capture: staff cannot read the full number', !!r.error || !(r.data || []).some((x) => x.number)); }
    { const r = await admin.from('capture_conversation').select('number').eq('id', c1?.id);
      check('Lead capture: not even Admin reads the full number from the screen', !!r.error || !(r.data || []).some((x) => x.number)); }
    { const r = await tele.rpc('capture_thread', { p_id: c1?.id });
      check('Lead capture: telecaller reads the messages without any number', !r.error && (r.data || []).length === 3 && !JSON.stringify(r.data).includes(waNum.slice(-10)), JSON.stringify(r.error || r.data)); }
    { const r = await tele.from('message').select('id').eq('conversation_id', c1?.id);
      check('Lead capture: messages of a non-lead are not readable directly', (r.data || []).length === 0); }

    // Trainer: no inbox at all
    { const r = await trainer.from('capture_conversation').select('id');
      check('Lead capture: trainer cannot read the inbox', (r.data || []).length === 0); }
    { const r = await trainer.rpc('capture_thread', { p_id: c1?.id });
      check('Lead capture: trainer cannot open a conversation', !!r.error); }
    { const r = await trainer.rpc('capture_make_lead', { p_id: c1?.id, p_name: 'Hacker' });
      check('Lead capture: trainer cannot make a lead from it', !!r.error); }
    { const r = await tele.from('capture_conversation').update({ status: 'Lead' }).eq('id', c1?.id).select('id');
      check('Lead capture: staff cannot change a conversation directly', !!r.error || (r.data || []).length === 0); }

    // Not a lead needs a listed reason; undo puts it back
    { const r = await desk.rpc('capture_not_lead', { p_id: c1?.id, p_reason: 'Made up' });
      check('Lead capture: Not a lead needs a reason from the list', !!r.error); }
    { const r = await desk.rpc('capture_not_lead', { p_id: c1?.id, p_reason: 'Spam' });
      const back = await desk.rpc('capture_reopen', { p_id: c1?.id });
      check('Lead capture: front desk can mark Not a lead and put it back', !r.error && !back.error && (await conv(waNum))?.status === 'New', JSON.stringify(r.error || back.error)); }

    // Make lead: name + course; the number comes from the message
    const prog = (await service.from('program').select('id').limit(1).maybeSingle()).data;
    { const r = await tele.rpc('capture_make_lead', { p_id: c1?.id, p_name: 'Test Capture', p_program: prog?.id ?? null });
      if (r.data?.lead_id) leads.push(r.data.lead_id);
      const l = r.data?.lead_id ? (await service.from('lead').select('mobile, owner_id, source:source_id(name), program_id').eq('id', r.data.lead_id).single()).data : null;
      const me = (await tele.auth.getUser()).data.user?.id;
      const moved = (await service.from('message').select('id').eq('conversation_id', c1?.id).eq('lead_id', r.data?.lead_id ?? '00000000-0000-0000-0000-000000000000')).data || [];
      check('Lead capture: Make lead creates the lead with the message number, source WhatsApp enquiry, owned by the telecaller',
        !r.error && l?.mobile === waNum.slice(-10) && l?.source?.name === 'WhatsApp enquiry' && l?.owner_id === me && moved.length === 3 && (await conv(waNum))?.status === 'Lead',
        JSON.stringify(r.error || l));
      const twice = await tele.rpc('capture_make_lead', { p_id: c1?.id, p_name: 'Again' });
      check('Lead capture: a conversation is made a lead only once', !!twice.error); }

    // Auto-create on: the next unknown WhatsApp number becomes a lead straight away
    {
      await service.from('setting').update({ value: 'on' }).eq('key', 'capture_auto_create');
      const n2 = '9195' + stamp;
      const r = await service.rpc('capture_inbound', { p_channel: 'whatsapp', p_number: n2, p_body: 'Hi', p_provider_id: 'test.wamid.' + stamp + 'c' });
      const c2 = await conv(n2); if (c2) convs.push(c2.id); if (r.data?.lead_id) leads.push(r.data.lead_id);
      const l = r.data?.lead_id ? (await service.from('lead').select('owner_id, source:source_id(name)').eq('id', r.data.lead_id).single()).data : null;
      check('Lead capture: with auto-create on, a new WhatsApp number becomes an assigned lead', r.data?.created === true && l?.source?.name === 'WhatsApp enquiry' && !!l?.owner_id, JSON.stringify(r.error || r.data));
      await service.from('setting').update({ value: saved }).eq('key', 'capture_auto_create');
    }

    // Missed call, database rule (works without the app): one lead + one call-back, the same number within 24 h adds nothing
    {
      const n3 = '98' + stamp;
      const r1 = await service.rpc('capture_inbound', { p_channel: 'missed_call', p_number: n3 });
      const r2 = await service.rpc('capture_inbound', { p_channel: 'missed_call', p_number: '0' + n3 });
      const c4 = await conv('91' + n3); if (c4) convs.push(c4.id);
      const ls = (await service.from('lead').select('id, owner_id, source:source_id(name)').eq('mobile', n3)).data || [];
      ls.forEach((l) => leads.push(l.id));
      const fus = ls[0] ? (await service.from('follow_up').select('owner_id').eq('lead_id', ls[0].id).eq('title', 'Call back missed call')).data || [] : [];
      check('Missed call rule: one lead (source Missed call), one call-back for its owner, once per 24 hours',
        r1.data?.created === true && r2.data?.duplicate === true && ls.length === 1 && ls[0].source?.name === 'Missed call' && fus.length === 1 && fus[0].owner_id === ls[0].owner_id,
        JSON.stringify({ e: r1.error || r2.error, ls, fus }));
    }

    // Missed-call endpoint (needs the app on port 3100)
    const post = (key, body) => fetch(APP + '/api/integrations/missed-call', { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'x-api-key': key } : {}) }, body: JSON.stringify(body) })
      .then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})), text: '' })).catch(() => null);
    const noKey = await post(null, { number: callNum });
    if (!noKey) console.log('SKIP missed-call endpoint checks: the app is not running on port 3100');
    else {
      check('Missed call: refused without the API key', noKey.status === 401);
      check('Missed call: refused with a wrong key', (await post('wrong', { number: callNum }))?.status === 401);
      const key = (await service.from('integration_config').select('value').eq('key', 'incoming_api_key').single()).data?.value;
      const one = await post(key, { number: '+91 ' + callNum, called_at: new Date().toISOString() });
      const two = await post(key, { number: callNum });
      const ls = (await service.from('lead').select('id, owner_id, source:source_id(name)').eq('mobile', callNum)).data || [];
      ls.forEach((l) => leads.push(l.id));
      const c3 = await conv('91' + callNum); if (c3) convs.push(c3.id);
      const fus = ls[0] ? (await service.from('follow_up').select('id, owner_id, due_at').eq('lead_id', ls[0].id).eq('title', 'Call back missed call')).data || [] : [];
      const replies = c3 ? (await service.from('message').select('id').eq('conversation_id', c3.id).eq('direction', 'out')).data || [] : [];
      check('Missed call: creates one lead (source Missed call, assigned) with a call-back due now for the owner',
        one?.status === 201 && ls.length === 1 && ls[0].source?.name === 'Missed call' && !!ls[0].owner_id && fus.length === 1 && fus[0].owner_id === ls[0].owner_id && new Date(fus[0].due_at) <= new Date(),
        JSON.stringify({ one: one?.json, ls, fus }));
      check('Missed call: the same number again within 24 hours adds nothing', two?.status === 200 && two.json.duplicate === true && fus.length === 1 && replies.length === 1, JSON.stringify(two?.json));
      check('Missed call: the response never contains the number', !JSON.stringify(one?.json || {}).includes(callNum) && !JSON.stringify(two?.json || {}).includes(callNum));
      check('Missed call: a bad number is refused', (await post(key, { number: '12' }))?.status === 400);
    }
  } finally {
    await service.from('setting').update({ value: saved }).eq('key', 'capture_auto_create');
    if (leads.length) {
      await service.from('follow_up').delete().in('lead_id', leads);
      await service.from('note').delete().in('lead_id', leads);
      await service.from('integration_event').delete().in('entity_id', leads);
      await service.from('notification').delete().in('link', leads.map((id) => '/p/lead?person=lead:' + id));
    }
    if (convs.length) {
      await service.from('message').delete().in('conversation_id', convs);
      await service.from('integration_event').delete().in('entity_id', convs);
      await service.from('notification').delete().eq('link', '/p/inbox').eq('body', 'Hi, course details please');
      await service.from('capture_conversation').delete().in('id', convs);
    }
    if (leads.length) await service.from('lead').delete().in('id', leads);
    const ids = [...leads, ...convs];
    if (ids.length) await service.from('recycle_bin').delete().in('row_id', ids);
    if (leads.length) await service.from('recycle_bin').delete().in('data->>lead_id', leads);
  }
}
