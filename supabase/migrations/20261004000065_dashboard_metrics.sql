-- Stint CRM · dashboard numbers computed in the database (one round trip, no rows sent to the browser).
-- Both functions run with the caller's own rights (security invoker): row security on every table applies,
-- so each number equals the count the caller gets when opening the matching list. A metric whose page the
-- caller cannot read comes back as null (shown as hidden, never as 0).
-- Periods use India time (Asia/Kolkata): "this month" = 1st of this month up to now; "last month to date"
-- = the same days of last month, so a partly-finished month is never compared with a full one.

create or replace function public.dashboard_metrics()
returns jsonb
language sql stable security invoker set search_path = public as $$
  with t as (
    select (now() at time zone 'Asia/Kolkata')::date as today,
           date_trunc('month', now() at time zone 'Asia/Kolkata')::date as m0,
           (date_trunc('month', now() at time zone 'Asia/Kolkata') - interval '1 month')::date as m1
  ), b as (
    select t.*,
      -- same number of days into last month (capped at last month's end)
      least((t.m1 + (t.today - t.m0))::date, (t.m0 - 1)) as m1_to,
      (t.today::timestamp at time zone 'Asia/Kolkata') as today_ts,
      ((t.today + 1)::timestamp at time zone 'Asia/Kolkata') as tomorrow_ts,
      (t.m0::timestamp at time zone 'Asia/Kolkata') as m0_ts,
      (t.m1::timestamp at time zone 'Asia/Kolkata') as m1_ts
    from t
  ), me as (
    select s.id, s.role, s.level from public.staff s where s.id = auth.uid()
  )
  select jsonb_build_object(
    'as_of', now(),
    'today', b.today, 'month_from', b.m0, 'last_from', b.m1, 'last_to', b.m1_to,
    -- follow-ups the caller can see (same rows as the Follow-ups page)
    'fu_overdue', case when public.can_page('followups', 'r') then (select count(*) from public.follow_up f where f.status = 'Open' and f.due_at < b.today_ts) end,
    'fu_today',   case when public.can_page('followups', 'r') then (select count(*) from public.follow_up f where f.status = 'Open' and f.due_at >= b.today_ts and f.due_at < b.tomorrow_ts) end,
    'fu_open',    case when public.can_page('followups', 'r') then (select count(*) from public.follow_up f where f.status = 'Open') end,
    'alerts_open', case when public.can_page('alert', 'r') then (select count(*) from public.alert a where a.status = 'Open') end,
    'alerts_high', case when public.can_page('alert', 'r') then (select count(*) from public.alert a where a.status = 'Open' and a.priority = 'High') end,
    'fees_overdue_n',   case when public.can_page('payment', 'r') then (select count(*) from public.fee_payment p where p.status = 'Overdue') end,
    'fees_overdue_amt', case when public.can_page('payment', 'r') then (select coalesce(sum(p.amount), 0) from public.fee_payment p where p.status = 'Overdue') end,
    'collected_month',  case when public.can_page('payment', 'r') then (select coalesce(sum(p.amount), 0) from public.fee_payment p where p.status = 'Received' and p.paid_on between b.m0 and b.today) end,
    'collected_last',   case when public.can_page('payment', 'r') then (select coalesce(sum(p.amount), 0) from public.fee_payment p where p.status = 'Received' and p.paid_on between b.m1 and b.m1_to) end,
    'leads_open',  case when public.can_page('lead', 'r') then (select count(*) from public.lead_list l where l.stage not in ('Converted', 'Not interested')) end,
    'leads_month', case when public.can_page('lead', 'r') then (select count(*) from public.lead_list l where l.created_at >= b.m0_ts and l.created_at < b.tomorrow_ts) end,
    'leads_last',  case when public.can_page('lead', 'r') then (select count(*) from public.lead_list l where l.created_at >= b.m1_ts and l.created_at < ((b.m1_to + 1)::timestamp at time zone 'Asia/Kolkata')) end,
    'leads_today', case when public.can_page('lead', 'r') then (select count(*) from public.lead_list l where l.created_at >= b.today_ts and l.created_at < b.tomorrow_ts) end,
    'enrolled_month', case when public.can_page('candidate', 'r') then (select count(*) from public.candidate c where c.created_at >= b.m0_ts and c.created_at < b.tomorrow_ts) end,
    'enrolled_last',  case when public.can_page('candidate', 'r') then (select count(*) from public.candidate c where c.created_at >= b.m1_ts and c.created_at < ((b.m1_to + 1)::timestamp at time zone 'Asia/Kolkata')) end,
    'joining_soon',   case when public.can_page('placement', 'r') then (select count(*) from public.placement p where p.status = 'Joining soon') end,
    -- this month's enrolment target: own (Sales member) or whole team (anyone else who can read targets)
    'target', case when public.can_page('target', 'r') then (
      select sum(st.target) from public.sales_target st, me
      where st.month = b.m0 and (me.role <> 'Sales' or me.level = 'Head' or st.staff_id = me.id)) end,
    'target_mine', exists (select 1 from me where me.role = 'Sales' and coalesce(me.level, '') <> 'Head'),
    'target_done', case when public.can_page('candidate', 'r') then (
      select count(*) from public.candidate c, me
      where c.created_at >= b.m0_ts and c.created_at < b.tomorrow_ts
        and (me.role <> 'Sales' or me.level = 'Head' or c.poc_id = me.id)) end,
    -- leads created this month by source, with how many of them became candidates
    'sources', case when public.can_page('lead', 'r') then (
      select coalesce(jsonb_agg(x order by x.leads desc, x.name), '[]'::jsonb) from (
        select coalesce(s.name, 'No source') as name, count(*) as leads,
               case when public.can_page('candidate', 'r') then count(*) filter (where exists (select 1 from public.candidate c where c.lead_id = l.id)) end as enrolled
        from public.lead_list l left join public.lead_source s on s.id = l.source_id
        where l.created_at >= b.m0_ts and l.created_at < b.tomorrow_ts
        group by 1 order by 2 desc, 1 limit 6) x) end
  )
  from b;
$$;
revoke all on function public.dashboard_metrics() from public, anon;
grant execute on function public.dashboard_metrics() to authenticated;

-- Cohort funnel: leads CREATED in the period (India dates, both inclusive; null = any time), and for each
-- step how many of THOSE leads ever reached it. Evidence for "reached": the lead's current stage, any
-- recorded stage change in status_history, a counselling session, or a linked candidate. A later step
-- counts as having passed the earlier ones, so each step is <= the one before by construction.
-- Steps the caller cannot see (no candidate page) come back with n = null.
create or replace function public.funnel_cohort(p_from date default null, p_to date default null)
returns table (step int, label text, n bigint, history_since timestamptz)
language sql stable security invoker set search_path = public as $$
  with cohort as (
    select l.id, l.stage from public.lead_list l
    where public.can_page('lead', 'r')
      and (p_from is null or l.created_at >= (p_from::timestamp at time zone 'Asia/Kolkata'))
      and (p_to is null or l.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Kolkata'))
  ), ev as (
    select c.id,
      exists (select 1 from public.candidate k where k.lead_id = c.id and (k.stage in ('Placed', 'Alumni')
              or exists (select 1 from public.status_history h where h.entity = 'candidate' and h.entity_id = k.id and h.to_value in ('Placed', 'Alumni')))) as placed,
      (c.stage = 'Converted' or exists (select 1 from public.candidate k where k.lead_id = c.id)) as enrolled,
      (c.stage in ('Counselling', 'Converted')
        or exists (select 1 from public.status_history h where h.entity = 'lead' and h.entity_id = c.id and h.to_value in ('Counselling', 'Converted'))
        or exists (select 1 from public.counselling_session s where s.lead_id = c.id)) as counselled,
      (c.stage in ('Interested', 'Counselling', 'Converted')
        or exists (select 1 from public.status_history h where h.entity = 'lead' and h.entity_id = c.id and h.to_value in ('Interested', 'Counselling', 'Converted'))) as interested
    from cohort c
  ), r as (
    select id, placed,
      (enrolled or placed) as enrolled,
      (counselled or enrolled or placed) as counselled,
      (interested or counselled or enrolled or placed) as interested
    from ev
  ), hs as (
    select min(h.at) as since from public.status_history h where h.entity = 'lead'
  )
  select v.step, v.label, v.n, hs.since from hs, (values
    (1, 'Leads created', case when public.can_page('lead', 'r') then (select count(*) from r) end),
    (2, 'Showed interest', case when public.can_page('lead', 'r') then (select count(*) from r where interested) end),
    (3, 'Counselled', case when public.can_page('lead', 'r') then (select count(*) from r where counselled) end),
    (4, 'Enrolled', case when public.can_page('lead', 'r') and public.can_page('candidate', 'r') then (select count(*) from r where enrolled) end),
    (5, 'Placed', case when public.can_page('lead', 'r') and public.can_page('candidate', 'r') then (select count(*) from r where placed) end)
  ) v(step, label, n)
  order by v.step;
$$;
revoke all on function public.funnel_cohort(date, date) from public, anon;
grant execute on function public.funnel_cohort(date, date) to authenticated;
