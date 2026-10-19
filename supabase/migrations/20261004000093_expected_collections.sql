-- 093: Expected collections. Money falling due over the coming days, week by week, and which part is at risk.
-- Everything is security invoker: fee_payment row security (can_page('payment','r') + candidate_in_scope) decides
-- which rows are counted, and the functions return nothing at all to a role without the Payments page
-- (so "no access" is never shown as "₹0 due"). Days are India days (Asia/Kolkata). Weeks start on Monday.
--
-- Definitions (the card's "How it's counted" note says the same in plain words):
--   unpaid       = status Due or Overdue (Refund pending / Refunded are not money coming in).
--   late now     = status Overdue, or status Due with a due day before today (the 15-minute job may not have run yet).
--   at-risk student = has an instalment late now, OR paid an earlier instalment more than 14 days after its due day.
--   due          = unpaid, with a due day inside the window (today .. today + days - 1).
--   at risk      = the part of "due" that belongs to an at-risk student.
--   already paid = Received, with a due day inside the window (paid ahead of time).
--   collected    = Received, with a paid day this week (up to today) / this India month (up to today).
--   overdue now  = unpaid and late now (not part of the window; shown on its own).
-- Idempotent: safe to run again.

create index if not exists fee_payment_paid_on_idx on public.fee_payment (paid_on);

-- One row per student who is late now or paid late before. Internal helper, also security invoker.
create or replace function public.collections_flags()
returns table (candidate_id uuid, overdue_amount numeric, overdue_count int, oldest_unpaid date, worst_paid_late int)
language sql
stable
security invoker
set search_path = public
as $$
  with b as (select (now() at time zone 'Asia/Kolkata')::date as today),
  p as (
    select f.candidate_id, f.amount, f.due_on, f.paid_on,
           (f.status = 'Overdue' or (f.status = 'Due' and f.due_on < b.today)) as late_now,
           (f.status = 'Received' and f.paid_on is not null and f.due_on is not null and f.paid_on - f.due_on > 14) as paid_late
    from public.fee_payment f, b
  )
  select p.candidate_id,
         coalesce(sum(p.amount) filter (where p.late_now), 0),
         (count(*) filter (where p.late_now))::int,
         min(p.due_on) filter (where p.late_now),
         max(p.paid_on - p.due_on) filter (where p.paid_late)
  from p
  where p.late_now or p.paid_late
  group by p.candidate_id
$$;

revoke all on function public.collections_flags() from public, anon;
grant execute on function public.collections_flags() to authenticated;

-- Week by week from this week (India), covering today .. today + p_days - 1.
-- from_day / to_day = the part of the week inside the window (this week starts today; the last week may stop early).
drop function if exists public.expected_collections(int);
create or replace function public.expected_collections(p_days int default 56)
returns table (
  week_start date, week_end date, from_day date, to_day date,
  due_amount numeric, due_count int,
  at_risk_amount numeric, at_risk_count int,
  paid_early_amount numeric,
  collected_amount numeric, collected_count int
)
language sql
stable
security invoker
set search_path = public
as $$
  with b as (
    select (now() at time zone 'Asia/Kolkata')::date as today,
           greatest(1, least(coalesce(p_days, 56), 366)) as n
  ),
  w as (
    select gs::date as ws, greatest(gs::date, b.today) as d0, least(gs::date + 6, b.today + b.n - 1) as d1, b.today
    from b, generate_series(date_trunc('week', b.today)::date, date_trunc('week', b.today + b.n - 1)::date, interval '7 days') gs
  ),
  risk as (select x.candidate_id from public.collections_flags() x),
  pay as (
    select f.amount, f.status, f.due_on, f.paid_on, (f.candidate_id in (select r.candidate_id from risk r)) as risky
    from public.fee_payment f, b
    where f.due_on between b.today and b.today + b.n - 1
       or (f.status = 'Received' and f.paid_on between date_trunc('week', b.today)::date and b.today)
  )
  select w.ws, w.ws + 6, w.d0, w.d1,
    coalesce(sum(p.amount) filter (where p.status in ('Due', 'Overdue') and p.due_on between w.d0 and w.d1), 0),
    (count(*) filter (where p.status in ('Due', 'Overdue') and p.due_on between w.d0 and w.d1))::int,
    coalesce(sum(p.amount) filter (where p.status in ('Due', 'Overdue') and p.due_on between w.d0 and w.d1 and p.risky), 0),
    (count(*) filter (where p.status in ('Due', 'Overdue') and p.due_on between w.d0 and w.d1 and p.risky))::int,
    coalesce(sum(p.amount) filter (where p.status = 'Received' and p.due_on between w.d0 and w.d1), 0),
    coalesce(sum(p.amount) filter (where p.status = 'Received' and p.paid_on between w.ws and least(w.ws + 6, w.today)), 0),
    (count(*) filter (where p.status = 'Received' and p.paid_on between w.ws and least(w.ws + 6, w.today)))::int
  from w
  left join pay p on p.due_on between w.ws and w.ws + 6 or p.paid_on between w.ws and w.ws + 6
  where public.can_page('payment', 'r')
  group by w.ws, w.d0, w.d1, w.today
  order by w.ws
$$;

revoke all on function public.expected_collections(int) from public, anon;
grant execute on function public.expected_collections(int) to authenticated;

-- Totals for the next p_days, plus the 10 at-risk students with the most money at stake. Names only, no contact details.
drop function if exists public.collections_summary(int);
create or replace function public.collections_summary(p_days int default 30)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with b as (
    select (now() at time zone 'Asia/Kolkata')::date as today,
           greatest(1, least(coalesce(p_days, 30), 366)) as n
  ),
  flags as (select * from public.collections_flags()),
  win as (
    select f.candidate_id, f.amount, f.status, f.due_on, (f.candidate_id in (select x.candidate_id from flags x)) as risky
    from public.fee_payment f, b
    where f.due_on between b.today and b.today + b.n - 1
  ),
  soon as (
    select w.candidate_id, sum(w.amount) as due_soon, min(w.due_on) as next_due
    from win w where w.status in ('Due', 'Overdue') group by w.candidate_id
  ),
  top as (
    select f.candidate_id, c.full_name, f.overdue_amount, coalesce(s.due_soon, 0) as due_soon, s.next_due,
           f.overdue_amount + coalesce(s.due_soon, 0) as amount,
           case when f.oldest_unpaid is not null then b.today - f.oldest_unpaid end as days_late,
           f.worst_paid_late, f.oldest_unpaid
    from flags f
    cross join b
    left join soon s on s.candidate_id = f.candidate_id
    left join public.candidate c on c.id = f.candidate_id
    where f.overdue_amount > 0 or coalesce(s.due_soon, 0) > 0
  )
  select case when not public.can_page('payment', 'r') then jsonb_build_object('allowed', false) else jsonb_build_object(
    'allowed', true,
    'today', b.today,
    'days', b.n,
    'from', b.today,
    'to', b.today + b.n - 1,
    'due_total', (select coalesce(sum(amount), 0) from win where status in ('Due', 'Overdue')),
    'due_count', (select count(*) from win where status in ('Due', 'Overdue')),
    'at_risk_total', (select coalesce(sum(amount), 0) from win where status in ('Due', 'Overdue') and risky),
    'at_risk_count', (select count(*) from win where status in ('Due', 'Overdue') and risky),
    'paid_early_total', (select coalesce(sum(amount), 0) from win where status = 'Received'),
    'overdue_now_total', (select coalesce(sum(overdue_amount), 0) from flags),
    'overdue_now_count', (select coalesce(sum(overdue_count), 0) from flags),
    'overdue_students', (select count(*) from flags where overdue_count > 0),
    'month_from', date_trunc('month', b.today)::date,
    'collected_this_month', (select coalesce(sum(f.amount), 0) from public.fee_payment f
                             where f.status = 'Received' and f.paid_on between date_trunc('month', b.today)::date and b.today),
    'at_risk_students', (select count(*) from top),
    'top_at_risk', coalesce((select jsonb_agg(jsonb_build_object(
        'candidate_id', t.candidate_id, 'name', coalesce(t.full_name, 'Student'),
        'amount', t.amount, 'overdue_amount', t.overdue_amount, 'due_soon_amount', t.due_soon,
        'days_late', t.days_late, 'oldest_unpaid', t.oldest_unpaid, 'next_due_on', t.next_due,
        'paid_late_days', t.worst_paid_late,
        'reason', case when t.days_late is not null then 'Late ' || t.days_late || ' day' || case when t.days_late = 1 then '' else 's' end
                       else 'Paid an earlier instalment ' || t.worst_paid_late || ' days late' end
      ) order by t.amount desc, t.days_late desc nulls last, t.full_name)
      from (select * from top order by amount desc, days_late desc nulls last, full_name limit 10) t), '[]'::jsonb)
  ) end
  from b
$$;

revoke all on function public.collections_summary(int) from public, anon;
grant execute on function public.collections_summary(int) to authenticated;
