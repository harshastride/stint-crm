-- Slice 3 · Activepieces.
-- 3.1 Business events go into an outbox (integration_event) from database triggers; a job sends them to the
--     Activepieces webhook with an HMAC-SHA256 signature (pg_net), and records the result.
-- 3.3 The outbox is the delivery log: sent / failed per flow, with retry.
-- 3.5 Marketing consent on leads, carried in every lead event so flows can respect it.
create extension if not exists pg_net;
create extension if not exists pgcrypto with schema extensions;

-- Admin-only settings: webhook URL, signing secret, key for incoming leads
create table public.integration_config (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table public.integration_config enable row level security;
create policy integration_config_admin on public.integration_config for all to authenticated using (public.is_admin()) with check (public.is_admin());
insert into public.integration_config (key, value) values
  ('activepieces_webhook_url', null),
  ('signing_secret', encode(extensions.gen_random_bytes(24), 'hex')),
  ('incoming_api_key', encode(extensions.gen_random_bytes(24), 'hex'));

create table public.integration_event (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  entity text not null,
  entity_id uuid,
  person_name text,
  payload jsonb not null,
  status text not null default 'Pending' check (status in ('Pending', 'Sending', 'Sent', 'Failed')),
  attempts int not null default 0,
  next_try_at timestamptz not null default now(),
  request_id bigint,
  response_code int,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index integration_event_status_idx on public.integration_event (status, next_try_at);
create index integration_event_created_idx on public.integration_event (created_at desc);

insert into public.page (id, grp, title, sort) values ('deliveries', 'Admin settings', 'Automation log', 44)
on conflict (id) do nothing;
alter table public.integration_event enable row level security;
create policy integration_event_read on public.integration_event for select to authenticated using (public.can_page('deliveries', 'r'));
create policy integration_event_upd on public.integration_event for update to authenticated using (public.can_page('deliveries', 'w')) with check (public.can_page('deliveries', 'w'));
revoke insert, delete on public.integration_event from authenticated;

-- 3.5 consent
alter table public.lead add column marketing_consent boolean not null default false;
alter table public.lead add column consent_at timestamptz;

-- Payload helpers: who the event is about, with the contact details a message flow needs
create or replace function public.lead_brief(lid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object('id', l.id, 'name', l.full_name, 'mobile', l.mobile, 'email', l.email, 'city', l.city,
    'stage', l.stage, 'program', p.name, 'source', s.name, 'owner', o.full_name, 'owner_email', o.email,
    'marketing_consent', l.marketing_consent))
  from public.lead l left join public.program p on p.id = l.program_id left join public.lead_source s on s.id = l.source_id
  left join public.staff o on o.id = l.owner_id where l.id = lid
$$;
create or replace function public.candidate_brief(cid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object('id', c.id, 'code', c.code, 'name', c.full_name, 'stage', c.stage, 'program', p.name,
    'mobile', cp.contact->>'mobile', 'email', cp.contact->>'email', 'owner', o.full_name, 'owner_email', o.email))
  from public.candidate c left join public.program p on p.id = c.program_id left join public.candidate_private cp on cp.candidate_id = c.id
  left join public.staff o on o.id = c.poc_id where c.id = cid
$$;

create or replace function public.emit_event(ev text, ent text, eid uuid, who text, data jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.integration_event (event, entity, entity_id, person_name, payload)
  values (ev, ent, eid, who, jsonb_build_object('event', ev, 'occurred_at', now(), 'data', data))
$$;

-- Triggers that raise events
create or replace function public.events_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.emit_event('lead.created', 'lead', new.id, new.full_name, jsonb_build_object('lead', public.lead_brief(new.id)));
  else
    if new.owner_id is distinct from old.owner_id and new.owner_id is not null then
      perform public.emit_event('lead.assigned', 'lead', new.id, new.full_name, jsonb_build_object('lead', public.lead_brief(new.id)));
    end if;
    if new.stage = 'Converted' and old.stage is distinct from 'Converted' then
      perform public.emit_event('lead.converted', 'lead', new.id, new.full_name, jsonb_build_object('lead', public.lead_brief(new.id),
        'candidate', (select public.candidate_brief(c.id) from public.candidate c where c.lead_id = new.id limit 1)));
    end if;
  end if;
  return null;
end $$;
-- runs after convert_lead (alphabetical: lead_convert < lead_events) so the candidate exists
create trigger lead_events after insert or update of owner_id, stage on public.lead for each row execute function public.events_lead();

create or replace function public.events_candidate_side() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev text; extra jsonb := '{}'; who text;
begin
  case tg_table_name
    when 'counselling_session' then
      if tg_op = 'INSERT' then ev := 'counselling.booked';
        extra := jsonb_build_object('lead', public.lead_brief(new.lead_id), 'scheduled_at', new.scheduled_at,
          'counsellor', (select full_name from public.staff where id = new.counsellor_id)); end if;
    when 'fee_quote' then
      if new.status = 'Sent' and (tg_op = 'INSERT' or old.status is distinct from 'Sent') then ev := 'quote.sent';
        extra := jsonb_build_object('lead', public.lead_brief(new.lead_id), 'amount', new.amount, 'discount_pct', new.discount_pct,
          'instalments', new.instalments, 'valid_until', new.valid_until, 'program', (select name from public.program where id = new.program_id)); end if;
    when 'fee_payment' then
      if new.status = 'Received' and (tg_op = 'INSERT' or old.status is distinct from 'Received') then ev := 'payment.recorded';
        extra := jsonb_build_object('candidate', public.candidate_brief(new.candidate_id), 'amount', new.amount, 'mode', new.mode,
          'receipt_no', new.receipt_no, 'paid_on', new.paid_on, 'for', new.label); end if;
    when 'mock_session' then
      if tg_op = 'INSERT' and new.status = 'Booked' then ev := 'mock.booked';
      elsif new.status in ('Passed', 'Failed') and (tg_op = 'INSERT' or old.status is distinct from new.status) then ev := 'mock.result'; end if;
      if ev is not null then extra := jsonb_build_object('candidate', public.candidate_brief(new.candidate_id), 'status', new.status, 'level', new.level); end if;
    when 'resume_version' then
      if new.status = 'Rejected' and (tg_op = 'INSERT' or old.status is distinct from 'Rejected') then ev := 'resume.rejected';
        extra := jsonb_build_object('candidate', public.candidate_brief(new.candidate_id), 'version', new.version, 'reason', new.reason); end if;
    when 'vendor_request' then
      if tg_op = 'INSERT' then ev := 'vendor_request.created';
        extra := jsonb_build_object('candidate', public.candidate_brief(new.candidate_id), 'request', to_jsonb(new) - 'candidate_id'); end if;
    when 'placement' then
      if tg_op = 'INSERT' then ev := 'placement.recorded';
        extra := jsonb_build_object('candidate', public.candidate_brief(new.candidate_id), 'role', new.role, 'ctc_lpa', new.ctc_lpa,
          'joining_on', new.joining_on, 'company', (select name from public.company where id = new.company_id)); end if;
  end case;
  if ev is null then return null; end if;
  who := coalesce(extra #>> '{candidate,name}', extra #>> '{lead,name}');
  perform public.emit_event(ev, case when tg_table_name in ('counselling_session', 'fee_quote') then 'lead' else 'candidate' end,
    case when tg_table_name in ('counselling_session', 'fee_quote') then new.lead_id else new.candidate_id end, who, extra);
  return null;
end $$;
create trigger counselling_events after insert on public.counselling_session for each row execute function public.events_candidate_side();
create trigger quote_events after insert or update of status on public.fee_quote for each row execute function public.events_candidate_side();
create trigger payment_events after insert or update of status on public.fee_payment for each row execute function public.events_candidate_side();
create trigger mock_events after insert or update of status on public.mock_session for each row execute function public.events_candidate_side();
create trigger resume_events after insert or update of status on public.resume_version for each row execute function public.events_candidate_side();
create trigger vendor_events after insert on public.vendor_request for each row execute function public.events_candidate_side();
create trigger placement_events after insert on public.placement for each row execute function public.events_candidate_side();

create or replace function public.events_attendance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.mark = 'A' and (tg_op = 'INSERT' or old.mark is distinct from 'A') then
    perform public.emit_event('attendance.absent', 'candidate', new.candidate_id, (select full_name from public.candidate where id = new.candidate_id),
      jsonb_build_object('candidate', public.candidate_brief(new.candidate_id), 'day', new.day, 'batch', (select code from public.batch where id = new.batch_id)));
  end if;
  return null;
end $$;
create trigger attendance_events after insert or update of mark on public.attendance for each row execute function public.events_attendance();

-- Sender: every minute. Checks answers to earlier sends, then sends what is due.
create or replace function public.dispatch_events() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare url text; secret text; e record; body text; rid bigint; n int := 0; r record;
begin
  -- 1. answers to earlier sends
  for e in select * from public.integration_event where status = 'Sending' and request_id is not null loop
    select status_code, error_msg, timed_out into r from net._http_response where id = e.request_id;
    if found then
      if r.status_code between 200 and 299 then
        update public.integration_event set status = 'Sent', sent_at = now(), response_code = r.status_code, last_error = null where id = e.id;
      else
        update public.integration_event set
          status = case when e.attempts >= 5 then 'Failed' else 'Pending' end,
          response_code = r.status_code, last_error = coalesce(r.error_msg, case when r.timed_out then 'Timed out' end, 'HTTP ' || r.status_code),
          next_try_at = now() + make_interval(mins => power(2, e.attempts)::int)
        where id = e.id;
      end if;
    elsif e.next_try_at < now() - interval '10 minutes' then
      update public.integration_event set status = 'Pending', last_error = 'No answer from Activepieces' where id = e.id;
    end if;
  end loop;

  -- 2. send what is due
  select value into url from public.integration_config where key = 'activepieces_webhook_url';
  select value into secret from public.integration_config where key = 'signing_secret';
  if coalesce(trim(url), '') = '' then
    update public.integration_event set last_error = 'Activepieces webhook is not set up yet' where status = 'Pending' and last_error is distinct from 'Activepieces webhook is not set up yet';
    return 0;
  end if;
  for e in select * from public.integration_event where status = 'Pending' and next_try_at <= now() order by created_at limit 200 for update skip locked loop
    body := (e.payload || jsonb_build_object('id', e.id))::text;
    select net.http_post(
      url := url,
      body := body::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-Stint-Event', e.event, 'X-Stint-Event-Id', e.id::text,
        'X-Stint-Signature', 'sha256=' || encode(extensions.hmac(body, secret, 'sha256'), 'hex')),
      timeout_milliseconds := 10000) into rid;
    update public.integration_event set status = 'Sending', request_id = rid, attempts = attempts + 1, next_try_at = now() where id = e.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.dispatch_events() from public, anon, authenticated;
select cron.schedule('dispatch-events', '* * * * *', 'select public.dispatch_events()');

-- Retry from the log (admins / whoever may edit the log page)
create or replace function public.retry_event(eid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_page('deliveries', 'w') then raise exception 'Your role can’t retry deliveries.' using errcode = '42501'; end if;
  update public.integration_event set status = 'Pending', next_try_at = now(), attempts = 0, last_error = null where id = eid and status in ('Failed', 'Pending', 'Sending');
end $$;
grant execute on function public.retry_event(uuid) to authenticated;

-- "Send a test event" from the setup screen
create or replace function public.send_test_event() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can send a test event.' using errcode = '42501'; end if;
  perform public.emit_event('test.ping', 'test', null, 'Test', jsonb_build_object('message', 'Hello from Stint CRM'));
end $$;
grant execute on function public.send_test_event() to authenticated;
