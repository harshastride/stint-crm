-- Stint CRM · daily numbers behind the dashboard sparklines.
-- Runs with the caller's own permissions (security invoker): row security still filters each table,
-- and a metric whose page the caller cannot read comes back as null.
create or replace function public.kpi_trends(days int default 60)
returns table (day date, leads int, enrolled int, placed int, collected numeric)
language sql stable security invoker set search_path = public as $$
  with d as (
    select generate_series(current_date - (least(greatest(coalesce(days, 60), 1), 180) - 1), current_date, interval '1 day')::date as day
  )
  select d.day,
    case when public.can_page('lead', 'r') then (select count(*)::int from public.lead l where l.created_at::date = d.day) end,
    case when public.can_page('candidate', 'r') then (select count(*)::int from public.candidate c where c.created_at::date = d.day) end,
    case when public.can_page('placement', 'r') then (select count(*)::int from public.placement p where p.created_at::date = d.day and p.status <> 'Dropped') end,
    case when public.can_page('payment', 'r') then (select coalesce(sum(f.amount), 0) from public.fee_payment f where f.status = 'Received' and f.paid_on = d.day) end
  from d order by d.day;
$$;
revoke all on function public.kpi_trends(int) from public, anon;
grant execute on function public.kpi_trends(int) to authenticated;
