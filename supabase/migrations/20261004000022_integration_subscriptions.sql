-- "Stint CRM" block for Activepieces: each trigger in a flow registers its own address for one event.
-- Every event still goes to the main webhook (if set) and also to each subscription for that event,
-- each delivery signed with its own secret and logged/retried separately.
create table public.integration_subscription (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  target_url text not null,
  secret text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  label text,
  created_at timestamptz not null default now()
);
alter table public.integration_subscription enable row level security;
create policy integration_subscription_read on public.integration_subscription for select to authenticated using (public.can_page('deliveries', 'r'));

alter table public.integration_event add column subscription_id uuid references public.integration_subscription (id) on delete cascade;

create or replace function public.emit_event(ev text, ent text, eid uuid, who text, data jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.integration_event (event, entity, entity_id, person_name, payload, subscription_id)
  select ev, ent, eid, who, jsonb_build_object('event', ev, 'occurred_at', now(), 'data', data), s.id
  from (select null::uuid as id
        union all
        select id from public.integration_subscription where event = ev or (event = '*' and ev <> 'test.ping')) s
$$;

create or replace function public.dispatch_events() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare main_url text; main_secret text; e record; body text; rid bigint; n int := 0; r record; url text; secret text;
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
  select value into main_url from public.integration_config where key = 'activepieces_webhook_url';
  select value into main_secret from public.integration_config where key = 'signing_secret';
  update public.integration_event set last_error = 'Activepieces webhook is not set up yet'
  where status = 'Pending' and subscription_id is null and coalesce(trim(main_url), '') = ''
    and last_error is distinct from 'Activepieces webhook is not set up yet';
  for e in select ie.*, s.target_url as s_url, s.secret as s_secret
           from public.integration_event ie left join public.integration_subscription s on s.id = ie.subscription_id
           where ie.status = 'Pending' and ie.next_try_at <= now()
             and (ie.subscription_id is not null or coalesce(trim(main_url), '') <> '')
           order by ie.created_at limit 200 for update of ie skip locked loop
    url := coalesce(e.s_url, main_url); secret := coalesce(e.s_secret, main_secret);
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
