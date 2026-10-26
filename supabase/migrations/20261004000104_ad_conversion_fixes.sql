-- Fixes from the review of migration 101 (ad conversions).
-- 1. One report per lead per platform and event name (not per rule id): deleting, re-adding, restoring or editing a
--    rule no longer sends the same event twice.
-- 2. "First fee received": the unique key decides, so fees saved together (an import) still report once.
--    Fee time: today → now; an older date → noon India time that day; never before the ad click, never in the future.
-- 3. Retry / Skip only on rows that are waiting, failed or skipped (a Sent or Sending row cannot be sent again).
-- 4. Meta "Purchase" needs the fee amount, so it is allowed only on the first-fee rule with the amount on.
--    Event names may not start with = + - @ (they go into the Google upload file).
-- 5. Campaign results count every lead of the campaign for anyone who may open Campaigns (totals only; no
--    personal data), instead of only the leads the viewer can see.

-- 1. Unique key
alter table public.ad_conversion drop constraint if exists ad_conversion_lead_id_rule_id_key;
delete from public.ad_conversion a using public.ad_conversion b
  where a.lead_id = b.lead_id and a.platform = b.platform and a.event_name = b.event_name and a.created_at > b.created_at;
alter table public.ad_conversion drop constraint if exists ad_conversion_once;
alter table public.ad_conversion add constraint ad_conversion_once unique (lead_id, platform, event_name);

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
         or (from_meta and r.platform = 'meta' and p_trigger <> 'arrived'))
  on conflict (lead_id, platform, event_name) do nothing;
end $$;
revoke all on function public.ad_enqueue(uuid, text, text, numeric, timestamptz) from public, anon, authenticated;

-- 2. First fee
create or replace function public.ad_on_payment() returns trigger language plpgsql security definer set search_path = public as $$
declare lid uuid; t timestamptz; clicked timestamptz;
begin
  if new.status = 'Received' and (tg_op = 'INSERT' or old.status is distinct from 'Received') then
    select lead_id into lid from public.candidate where id = new.candidate_id;
    if lid is not null then
      t := case when new.paid_on is null or new.paid_on >= (now() at time zone 'Asia/Kolkata')::date then now()
                else (new.paid_on + time '12:00') at time zone 'Asia/Kolkata' end;
      select created_at into clicked from public.lead_click where lead_id = lid;
      t := least(greatest(t, coalesce(clicked, t)), now());
      perform public.ad_enqueue(lid, 'paid', null, new.amount, t);
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.ad_on_payment() from public, anon, authenticated;

-- 3. Retry / Skip
drop policy if exists ad_conv_retry on public.ad_conversion;
create policy ad_conv_retry on public.ad_conversion for update to authenticated
  using (public.can_page('ads', 'w') and status in ('Queued', 'Failed', 'Skipped'))
  with check (public.can_page('ads', 'w') and status in ('Queued', 'Skipped'));

-- 4. Rule checks
update public.ad_conversion_rule set send_value = true where platform = 'meta' and event_name = 'Purchase' and trigger = 'paid';
update public.ad_conversion_rule set active = false where platform = 'meta' and event_name = 'Purchase' and trigger <> 'paid';
alter table public.ad_conversion_rule drop constraint if exists ad_rule_purchase_value;
alter table public.ad_conversion_rule add constraint ad_rule_purchase_value
  check (platform <> 'meta' or event_name <> 'Purchase' or (trigger = 'paid' and send_value));
alter table public.ad_conversion_rule drop constraint if exists ad_rule_name_safe;
alter table public.ad_conversion_rule add constraint ad_rule_name_safe check (event_name !~ '^\s*[=+@-]');

-- 5. Campaign results (totals for anyone who may open Campaigns)
create or replace function public.campaign_performance_rows()
returns table (id uuid, name text, channel text, status text, budget numeric, starts_on date, leads bigint, enrolments bigint,
               fees_received numeric, budget_per_lead numeric, budget_per_enrolment numeric)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.channel, c.status, c.budget, c.starts_on,
         count(l.id), count(l.id) filter (where l.stage = 'Converted'),
         coalesce(sum(p.received), 0),
         case when count(l.id) > 0 and c.budget > 0 then round(c.budget / count(l.id), 0) end,
         case when count(l.id) filter (where l.stage = 'Converted') > 0 and c.budget > 0
              then round(c.budget / count(l.id) filter (where l.stage = 'Converted'), 0) end
  from public.campaign c
  left join public.lead l on l.campaign_id = c.id
  left join lateral (select sum(f.amount) as received from public.candidate cd join public.fee_payment f on f.candidate_id = cd.id
                     where cd.lead_id = l.id and f.status = 'Received') p on true
  where public.can_page('campaign', 'r')
  group by c.id
$$;
revoke all on function public.campaign_performance_rows() from public, anon;
grant execute on function public.campaign_performance_rows() to authenticated;

drop view if exists public.campaign_performance;
create view public.campaign_performance with (security_invoker = true) as
  select * from public.campaign_performance_rows();
grant select on public.campaign_performance to authenticated;
