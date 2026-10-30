-- Ad tracking and conversions (contract: docs/ads-tracking-contract.md).
-- 1. lead_click: where a lead came from (UTM tags, ad click ids, consent). Filled by the incoming-lead door when the
--    website sends `attribution`. Staff who can see the lead see the campaign tags; click ids, browser ids, IP and
--    browser name are server-only (column grants) and IP/browser are cleared after 90 days.
-- 2. ad_conversion_rule: which moments are reported to Meta / Google (lead arrived, a stage, first fee received).
-- 3. ad_conversion: one row per lead per rule (queue + log). Meta rows are sent by /api/ads/send (pg_cron every minute);
--    Google rows are read by Google Ads from the scheduled-upload feed /api/ads/google-feed.
-- 4. ad_settings: one row. Secrets (Meta token, feed password) are never granted to the browser.
-- 5. campaign_performance: budget, leads, enrolments and cost per enrolment per campaign.
-- Only leads that gave ad consent on the website, or came from a Meta lead form (Meta already has that lead), are reported.

insert into public.page (id, grp, title, sort) values ('ads', 'Marketing', 'Ad conversions', 6)
on conflict (id) do nothing;
-- Grant only for a role that exists (on a fresh database the roles come later from seed.sql, which grants it too)
insert into public.role_page_access (role, page_id, mode)
select name, 'ads', 'r' from public.app_role where name = 'Marketing'
on conflict do nothing;

-- 1. Where the lead came from
create table if not exists public.lead_click (
  lead_id uuid primary key references public.lead (id) on delete cascade,
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  gclid text, gbraid text, wbraid text, fbclid text,
  fbc text, fbp text,                               -- Meta browser ids (_fbc / _fbp)
  landing_url text, referrer text,
  client_ip inet, user_agent text,                  -- cleared after 90 days
  ad_consent boolean not null default false,        -- visitor accepted ad cookies on the website
  consent_at timestamptz,
  web_event_id text,                                -- id of the browser Lead event, reused server side so Meta counts it once
  clicked_at timestamptz,                           -- first visit from the ad
  created_at timestamptz not null default now(),
  constraint lead_click_lengths check (
    coalesce(length(utm_source), 0) <= 200 and coalesce(length(utm_medium), 0) <= 200 and coalesce(length(utm_campaign), 0) <= 200
    and coalesce(length(utm_content), 0) <= 200 and coalesce(length(utm_term), 0) <= 200
    and coalesce(length(gclid), 0) <= 300 and coalesce(length(gbraid), 0) <= 300 and coalesce(length(wbraid), 0) <= 300
    and coalesce(length(fbclid), 0) <= 500 and coalesce(length(fbc), 0) <= 600 and coalesce(length(fbp), 0) <= 200
    and coalesce(length(landing_url), 0) <= 1000 and coalesce(length(referrer), 0) <= 1000 and coalesce(length(user_agent), 0) <= 500
    and coalesce(length(web_event_id), 0) <= 100)
);

-- 2. Which moments are reported
create table if not exists public.ad_conversion_rule (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('meta', 'google')),
  trigger text not null check (trigger in ('arrived', 'stage', 'paid')),
  stage text,                                       -- for trigger 'stage': a lead_stage value
  event_name text not null check (length(trim(event_name)) between 1 and 100),   -- Meta event, or Google conversion action name
  send_value boolean not null default false,        -- 'paid': send the fee amount as the value
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  constraint ad_rule_stage check ((trigger = 'stage') = (stage is not null))
);
create unique index if not exists ad_conversion_rule_once on public.ad_conversion_rule (platform, trigger, coalesce(stage, ''));
insert into public.ad_conversion_rule (platform, trigger, stage, event_name, send_value, sort) values
  ('meta', 'arrived', null, 'Lead', false, 0),
  ('meta', 'stage', 'Counselling', 'Schedule', false, 1),
  ('meta', 'stage', 'Converted', 'CompleteRegistration', false, 2),
  ('meta', 'paid', null, 'Purchase', true, 3),
  ('google', 'arrived', null, 'Website lead', false, 10),
  ('google', 'stage', 'Converted', 'Enrolment', false, 11),
  ('google', 'paid', null, 'Fee received', true, 12)
on conflict do nothing;

-- 3. Queue + log
create table if not exists public.ad_conversion (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.lead (id) on delete cascade,
  rule_id uuid references public.ad_conversion_rule (id) on delete set null,
  platform text not null check (platform in ('meta', 'google')),
  event_name text not null,
  event_id text not null default replace(gen_random_uuid()::text, '-', ''),   -- dedup key sent to the platform
  event_time timestamptz not null default now(),
  value numeric(12, 2),
  currency text not null default 'INR',
  status text not null default 'Queued' check (status in ('Queued', 'Sending', 'Sent', 'Failed', 'Skipped')),
  attempts int not null default 0,
  next_try_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (lead_id, rule_id)
);
create index if not exists ad_conversion_due_idx on public.ad_conversion (platform, status, next_try_at);
create index if not exists ad_conversion_recent_idx on public.ad_conversion (created_at desc);

-- 4. Settings (one row)
create table if not exists public.ad_settings (
  id int primary key default 1 check (id = 1),
  meta_enabled boolean not null default false,
  meta_dataset_id text,                             -- Pixel / dataset id
  meta_capi_token text,                             -- Conversions API token: never granted to the browser
  meta_test_event_code text,                        -- while set, Meta shows events under Test events only
  meta_token_set boolean generated always as (meta_capi_token is not null and meta_capi_token <> '') stored,
  google_enabled boolean not null default false,
  google_feed_user text not null default 'google-ads',
  google_feed_password text,                        -- scheduled-upload password: never granted to the browser
  google_password_set boolean generated always as (google_feed_password is not null and google_feed_password <> '') stored,
  google_feed_days int not null default 60 check (google_feed_days between 1 and 90),
  last_feed_at timestamptz,                         -- last time Google read the feed
  updated_at timestamptz not null default now()
);
insert into public.ad_settings (id) values (1) on conflict (id) do nothing;

-- Enqueue: one row per matching active rule, once per lead and rule.
create or replace function public.ad_enqueue(p_lead uuid, p_trigger text, p_stage text default null, p_value numeric default null, p_at timestamptz default now())
returns void language plpgsql security definer set search_path = public as $$
declare consent boolean; from_meta boolean;
begin
  select ad_consent into consent from public.lead_click where lead_id = p_lead;
  from_meta := exists (select 1 from public.meta_lead where lead_id = p_lead);
  insert into public.ad_conversion (lead_id, rule_id, platform, event_name, event_time, value)
  select p_lead, r.id, r.platform, r.event_name, coalesce(p_at, now()), case when r.send_value then p_value end
  from public.ad_conversion_rule r
  where r.active and r.trigger = p_trigger and (p_trigger <> 'stage' or r.stage = p_stage)
    and (coalesce(consent, false)
         -- Meta lead form leads: Meta already has the lead; report later steps only (Conversion Leads)
         or (from_meta and r.platform = 'meta' and p_trigger <> 'arrived'))
  on conflict (lead_id, rule_id) do nothing;
end $$;
revoke all on function public.ad_enqueue(uuid, text, text, numeric, timestamptz) from public, anon, authenticated;

create or replace function public.ad_on_click() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.ad_enqueue(new.lead_id, 'arrived', null, null, coalesce((select created_at from public.lead where id = new.lead_id), now()));
  -- a lead already further along when its click arrived (e.g. resent later) gets its current stage too
  perform public.ad_enqueue(new.lead_id, 'stage', (select stage from public.lead where id = new.lead_id));
  return new;
end $$;
drop trigger if exists ad_on_click on public.lead_click;
create trigger ad_on_click after insert or update of ad_consent on public.lead_click for each row execute function public.ad_on_click();

create or replace function public.ad_on_stage() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.stage is distinct from old.stage then perform public.ad_enqueue(new.id, 'stage', new.stage); end if;
  return new;
end $$;
drop trigger if exists ad_on_stage on public.lead;
create trigger ad_on_stage after update of stage on public.lead for each row execute function public.ad_on_stage();

-- First fee received for a candidate who started as a lead
create or replace function public.ad_on_payment() returns trigger language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  if new.status = 'Received' and (tg_op = 'INSERT' or old.status is distinct from 'Received') then
    select lead_id into lid from public.candidate where id = new.candidate_id;
    if lid is not null and not exists (select 1 from public.fee_payment where candidate_id = new.candidate_id and status = 'Received' and id <> new.id) then
      perform public.ad_enqueue(lid, 'paid', null, new.amount, coalesce(new.paid_on::timestamptz, now()));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ad_on_payment on public.fee_payment;
create trigger ad_on_payment after insert or update of status on public.fee_payment for each row execute function public.ad_on_payment();

-- Row security
alter table public.lead_click enable row level security;
alter table public.ad_conversion_rule enable row level security;
alter table public.ad_conversion enable row level security;
alter table public.ad_settings enable row level security;
revoke all on public.lead_click, public.ad_conversion_rule, public.ad_conversion, public.ad_settings from public, anon, authenticated;

-- campaign tags: anyone who can see the lead (lead row security applies through the sub-select)
grant select (lead_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_url, referrer, ad_consent, consent_at, clicked_at, created_at) on public.lead_click to authenticated;
drop policy if exists lead_click_read on public.lead_click;
create policy lead_click_read on public.lead_click for select to authenticated using (exists (select 1 from public.lead l where l.id = lead_id));

grant select on public.ad_conversion_rule to authenticated;
grant insert, update, delete on public.ad_conversion_rule to authenticated;
drop policy if exists ad_rule_read on public.ad_conversion_rule;
create policy ad_rule_read on public.ad_conversion_rule for select to authenticated using (public.can_page('ads', 'r'));
drop policy if exists ad_rule_write on public.ad_conversion_rule;
create policy ad_rule_write on public.ad_conversion_rule for all to authenticated using (public.can_page('ads', 'w')) with check (public.can_page('ads', 'w'));

grant select on public.ad_conversion to authenticated;
grant update (status, attempts, next_try_at, last_error) on public.ad_conversion to authenticated;   -- "Retry" from the log
drop policy if exists ad_conv_read on public.ad_conversion;
create policy ad_conv_read on public.ad_conversion for select to authenticated using (public.can_page('ads', 'r'));
drop policy if exists ad_conv_retry on public.ad_conversion;
create policy ad_conv_retry on public.ad_conversion for update to authenticated using (public.can_page('ads', 'w')) with check (public.can_page('ads', 'w') and status in ('Queued', 'Skipped'));

grant select (id, meta_enabled, meta_dataset_id, meta_test_event_code, meta_token_set, google_enabled, google_feed_user, google_password_set, google_feed_days, last_feed_at, updated_at) on public.ad_settings to authenticated;
grant update (meta_enabled, meta_dataset_id, meta_test_event_code, google_enabled, google_feed_user, google_feed_days) on public.ad_settings to authenticated;
drop policy if exists ad_settings_read on public.ad_settings;
create policy ad_settings_read on public.ad_settings for select to authenticated using (public.can_page('ads', 'r'));
drop policy if exists ad_settings_edit on public.ad_settings;
create policy ad_settings_edit on public.ad_settings for update to authenticated using (public.can_page('ads', 'w')) with check (public.can_page('ads', 'w'));

create or replace function public.ad_settings_touch() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists ad_settings_touch on public.ad_settings;
create trigger ad_settings_touch before update on public.ad_settings for each row execute function public.ad_settings_touch();

-- Audit trail for settings and rules (token/password columns are masked by audit_row). Recycle bin for rules only:
-- settings hold secrets; lead_click and ad_conversion are tracking data removed with their lead.
do $$
declare t text;
begin
  foreach t in array array['ad_settings', 'ad_conversion_rule'] loop
    execute format('drop trigger if exists zz_audit on public.%I', t);
    execute format('create trigger zz_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
  drop trigger if exists aa_bin on public.ad_conversion_rule;
  create trigger aa_bin before delete on public.ad_conversion_rule for each row execute function public.bin_row();
end $$;

-- 5. Campaign results. Budget is what was planned for the campaign (there is no spend import yet), so the screen says "budget".
create or replace view public.campaign_performance with (security_invoker = true) as
  select c.id, c.name, c.channel, c.status, c.budget, c.starts_on,
         count(l.id) as leads,
         count(l.id) filter (where l.stage = 'Converted') as enrolments,
         coalesce(sum(p.received), 0) as fees_received,
         case when count(l.id) > 0 and c.budget > 0 then round(c.budget / count(l.id), 0) end as budget_per_lead,
         case when count(l.id) filter (where l.stage = 'Converted') > 0 and c.budget > 0
              then round(c.budget / count(l.id) filter (where l.stage = 'Converted'), 0) end as budget_per_enrolment
  from public.campaign c
  left join public.lead l on l.campaign_id = c.id
  left join lateral (select sum(f.amount) as received from public.candidate cd join public.fee_payment f on f.candidate_id = cd.id
                     where cd.lead_id = l.id and f.status = 'Received') p on true
  group by c.id;
grant select on public.campaign_performance to authenticated;

-- Every minute, if a Meta conversion is waiting (or stuck), ask the app to send it (same pattern as Meta leads / Teams)
create or replace function public.call_ad_sender() returns bigint
language sql security definer set search_path = public, extensions as $$
  select net.http_post(
    url := (select value from public.integration_config where key = 'app_url') || '/api/ads/send',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.integration_config where key = 'cron_secret')))
  where (select meta_enabled from public.ad_settings where id = 1)
    and (exists (select 1 from public.ad_conversion where platform = 'meta' and status = 'Queued' and next_try_at <= now())
      or exists (select 1 from public.ad_conversion where platform = 'meta' and status = 'Sending' and next_try_at < now() - interval '5 minutes'))
$$;
revoke all on function public.call_ad_sender() from public, anon, authenticated;

-- Privacy: clear IP and browser name after 90 days
create or replace function public.ad_purge_clicks() returns void language sql security definer set search_path = public as $$
  update public.lead_click set client_ip = null, user_agent = null
  where created_at < now() - interval '90 days' and (client_ip is not null or user_agent is not null)
$$;
revoke all on function public.ad_purge_clicks() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('ad-conversions') where exists (select 1 from cron.job where jobname = 'ad-conversions');
  perform cron.schedule('ad-conversions', '* * * * *', 'select public.call_ad_sender()');
  perform cron.unschedule('ad-purge-clicks') where exists (select 1 from cron.job where jobname = 'ad-purge-clicks');
  perform cron.schedule('ad-purge-clicks', '17 3 * * *', 'select public.ad_purge_clicks()');
exception when others then raise notice 'pg_cron not available: %', sqlerrm;
end $$;
