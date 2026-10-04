-- Conversion funnel: Leads → Interested → Counselling → Enrolled → Placed, for a date range.
-- Runs with the caller's own rights (security invoker), so row security on lead/candidate applies,
-- and a step is null when the caller cannot read that page at all.
create or replace function public.funnel_counts(p_from date default null, p_to date default null)
returns table (step int, label text, page text, stage text, n bigint)
language sql stable security invoker set search_path = public as $$
  with l as (
    select stage from public.lead
    where public.can_page('lead', 'r')
      and (p_from is null or created_at >= p_from::timestamptz)
      and (p_to is null or created_at < (p_to + 1)::timestamptz)),
  c as (
    select stage from public.candidate
    where public.can_page('candidate', 'r')
      and (p_from is null or joined_on >= p_from)
      and (p_to is null or joined_on <= p_to))
  select * from (values
    (1, 'Leads', 'lead', null::text,
       case when public.can_page('lead', 'r') then (select count(*) from l) end),
    (2, 'Interested', 'lead', 'Interested',
       case when public.can_page('lead', 'r') then (select count(*) from l where stage in ('Interested', 'Counselling', 'Converted')) end),
    (3, 'Counselling', 'lead', 'Counselling',
       case when public.can_page('lead', 'r') then (select count(*) from l where stage in ('Counselling', 'Converted')) end),
    (4, 'Enrolled', 'candidate', null::text,
       case when public.can_page('candidate', 'r') then (select count(*) from c) end),
    (5, 'Placed', 'candidate', 'Placed',
       case when public.can_page('candidate', 'r') then (select count(*) from c where stage in ('Placed', 'Alumni')) end)
  ) v(step, label, page, stage, n)
$$;
revoke all on function public.funnel_counts(date, date) from public, anon;
grant execute on function public.funnel_counts(date, date) to authenticated;
