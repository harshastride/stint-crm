-- Stint CRM · Staff scorecard (Reports → Staff scorecard, page id 'scorecard').
-- Per person, for a chosen period (India dates, both ends included): calls, connected %, talk time, counselling
-- booked, fee quotes sent, enrolments, this month's enrolment target, and the same numbers for the 4 periods before
-- (each of the same length, cut to the same number of days when the period is still running, so a part week is
-- compared with the same days of earlier weeks, never with full weeks).
-- Who sees whom (same rule as may_act_for, migration 043 / team scope 008):
--   Admin → everyone · a Head → people in their own role · a Junior → only themselves.
-- The team average comes from staff_scorecard_team; a Junior sees it only when the team has 3 or more people,
-- so one colleague's numbers can never be worked out from it.
-- Re-runnable: create or replace / on conflict.

-- 1. The page and who can open it
insert into public.page (id, grp, title, sort) values ('scorecard', 'Reports', 'Staff scorecard', 38)
on conflict (id) do update set grp = excluded.grp, title = excluded.title;
select public.page_place('scorecard', 'reports_builder');   -- last under Reports

insert into public.role_page_access (role, page_id, mode)
select r.name, 'scorecard', 'r' from public.app_role r
where r.name in ('Telecaller', 'Sales', 'HR / Counsellor', 'Placement', 'Finance', 'Front desk')
on conflict (role, page_id) do nothing;

-- Date lookups used by the counts below (call_log.called_at and audit_log.at are indexed already)
create index if not exists fee_quote_created_at_idx on public.fee_quote (created_at);
create index if not exists candidate_joined_on_idx on public.candidate (joined_on);

-- 2. Checks the period and returns the last day actually counted (today at most, India time)
create or replace function public.scorecard_period(p_from date, p_to date) returns date
language plpgsql stable security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Pick a start date on or before the end date.' using errcode = '22023';
  end if;
  if p_from > today then raise exception 'Pick a period that has already started.' using errcode = '22023'; end if;
  if p_to - p_from > 92 then raise exception 'Pick at most 3 months at a time.' using errcode = '22023'; end if;
  return least(p_to, today);
end $$;
revoke all on function public.scorecard_period(date, date) from public, anon, authenticated;

-- 3. Raw counts per staff member for one window of India dates (internal: only the functions below call it)
--    calls        call_log rows logged by the person (caller_id), by call time
--    connected    of those, every outcome except 'No answer' and 'Wrong number'
--    talk_sec     sum of the call length logged
--    counselling  different leads the person booked counselling for: a call marked 'Booked counselling',
--                 or a counselling session they added (the audit trail records who added it)
--    quotes       fee quotes the person created, by created time
--    enrolments   candidates whose joining date is in the window and whose lead the person currently owns
create or replace function public.scorecard_counts(p_from date, p_to date)
returns table (staff_id uuid, calls int, connected int, talk_sec int, counselling int, quotes int, enrolments int)
language sql stable security definer set search_path = public as $$
  with w as (
    select (p_from::timestamp at time zone 'Asia/Kolkata') as f, ((p_to + 1)::timestamp at time zone 'Asia/Kolkata') as t
  ), c as (
    select cl.caller_id as sid, count(*)::int as calls,
           count(*) filter (where cl.outcome not in ('No answer', 'Wrong number'))::int as connected,
           coalesce(sum(greatest(cl.duration_sec, 0)), 0)::int as talk_sec
    from public.call_log cl, w
    where cl.caller_id is not null and cl.called_at >= w.f and cl.called_at < w.t
    group by 1
  ), b as (
    select x.sid, count(distinct x.lead_id)::int as n from (
      select cl.caller_id as sid, cl.lead_id from public.call_log cl, w
      where cl.outcome = 'Booked counselling' and cl.caller_id is not null and cl.called_at >= w.f and cl.called_at < w.t
      union
      select a.actor, cs.lead_id from public.audit_log a
      join public.counselling_session cs on cs.id::text = a.row_id, w
      where a.table_name = 'counselling_session' and a.action = 'INSERT' and a.actor is not null and a.at >= w.f and a.at < w.t
    ) x group by 1
  ), q as (
    select fq.created_by as sid, count(*)::int as n from public.fee_quote fq, w
    where fq.created_by is not null and fq.created_at >= w.f and fq.created_at < w.t
    group by 1
  ), e as (
    select l.owner_id as sid, count(*)::int as n
    from public.candidate k join public.lead l on l.id = k.lead_id
    where l.owner_id is not null and k.joined_on between p_from and p_to
    group by 1
  ), ids as (
    select sid from c union select sid from b union select sid from q union select sid from e
  )
  select ids.sid, coalesce(c.calls, 0), coalesce(c.connected, 0), coalesce(c.talk_sec, 0),
         coalesce(b.n, 0), coalesce(q.n, 0), coalesce(e.n, 0)
  from ids
  left join c on c.sid = ids.sid left join b on b.sid = ids.sid
  left join q on q.sid = ids.sid left join e on e.sid = ids.sid
$$;
revoke all on function public.scorecard_counts(date, date) from public, anon, authenticated;

-- 4. The scorecard rows the caller may see
drop function if exists public.staff_scorecard(date, date);
create or replace function public.staff_scorecard(p_from date, p_to date)
returns table (
  staff_id uuid, name text, role text, level text, is_me boolean,
  calls int, connected int, connected_pct numeric, talk_minutes numeric,
  counselling_booked int, quotes_sent int, enrolments int,
  target int, target_month date, month_enrolments int,
  prev_periods int,
  prev4_avg_calls numeric, prev4_avg_connected_pct numeric, prev4_avg_talk_minutes numeric,
  prev4_avg_counselling numeric, prev4_avg_quotes numeric, prev4_avg_enrolments numeric,
  history jsonb,
  days_counted int, counted_to date
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  d_to date; len int; n int; m0 date;
  roles text[] := array['Telecaller', 'Sales', 'HR / Counsellor', 'Placement', 'Finance', 'Front desk'];
begin
  if auth.uid() is null or not public.can_page('scorecard', 'r') then
    raise exception 'This page isn''t open to your role.' using errcode = '42501';
  end if;
  d_to := public.scorecard_period(p_from, p_to);
  len := p_to - p_from + 1;           -- the period's full length
  n := d_to - p_from + 1;             -- days counted so far
  m0 := date_trunc('month', d_to)::date;

  return query
  with cur as (
    select * from public.scorecard_counts(p_from, d_to)
  ), mtd as (
    select * from public.scorecard_counts(m0, d_to)
  ), prev as (
    select g.k as pk, (p_from - g.k * len) as pf, (p_from - g.k * len + n - 1) as pt, pc.*
    from generate_series(1, 4) g(k), lateral public.scorecard_counts(p_from - g.k * len, p_from - g.k * len + n - 1) pc
  ), people as (
    select s.id, s.full_name, s.role, s.level, (s.created_at at time zone 'Asia/Kolkata')::date as joined
    from public.staff s
    where (public.is_admin() or public.may_act_for(s.id))
      and ((s.status = 'Active' and s.role = any (roles)) or exists (select 1 from cur where cur.staff_id = s.id))
  )
  select p.id, p.full_name, p.role, p.level, p.id = auth.uid(),
    coalesce(c.calls, 0), coalesce(c.connected, 0),
    case when coalesce(c.calls, 0) > 0 then round(100.0 * c.connected / c.calls, 1) end,
    round(coalesce(c.talk_sec, 0) / 60.0, 1),
    coalesce(c.counselling, 0), coalesce(c.quotes, 0), coalesce(c.enrolments, 0),
    t.target, m0, coalesce(m.enrolments, 0),
    h.periods,
    case when h.periods > 0 then round(h.calls::numeric / h.periods, 1) end,
    case when h.calls > 0 then round(100.0 * h.connected / h.calls, 1) end,
    case when h.periods > 0 then round(h.talk_sec / 60.0 / h.periods, 1) end,
    case when h.periods > 0 then round(h.counselling::numeric / h.periods, 1) end,
    case when h.periods > 0 then round(h.quotes::numeric / h.periods, 1) end,
    case when h.periods > 0 then round(h.enrolments::numeric / h.periods, 1) end,
    h.hist,
    n, d_to
  from people p
  left join cur c on c.staff_id = p.id
  left join mtd m on m.staff_id = p.id
  left join public.sales_target t on t.staff_id = p.id and t.month = m0
  left join lateral (
    -- an earlier period counts towards the average if the person had joined by its last day, or did any work in it
    select count(*) filter (where z.ok)::int as periods,
      coalesce(sum(z.calls) filter (where z.ok), 0)::int as calls,
      coalesce(sum(z.connected) filter (where z.ok), 0)::int as connected,
      coalesce(sum(z.talk_sec) filter (where z.ok), 0)::int as talk_sec,
      coalesce(sum(z.counselling) filter (where z.ok), 0)::int as counselling,
      coalesce(sum(z.quotes) filter (where z.ok), 0)::int as quotes,
      coalesce(sum(z.enrolments) filter (where z.ok), 0)::int as enrolments,
      jsonb_agg(jsonb_build_object('from', z.pf, 'to', z.pt, 'counted', z.ok, 'calls', z.calls, 'connected', z.connected,
        'talk_minutes', round(z.talk_sec / 60.0, 1), 'counselling', z.counselling, 'quotes', z.quotes, 'enrolments', z.enrolments)
        order by z.pk desc) as hist
    from (
      select g.k as pk, (p_from - g.k * len) as pf, (p_from - g.k * len + n - 1) as pt,
        coalesce(x.calls, 0) as calls, coalesce(x.connected, 0) as connected, coalesce(x.talk_sec, 0) as talk_sec,
        coalesce(x.counselling, 0) as counselling, coalesce(x.quotes, 0) as quotes, coalesce(x.enrolments, 0) as enrolments,
        ((p_from - g.k * len + n - 1) >= p.joined or x.staff_id is not null) as ok
      from generate_series(1, 4) g(k)
      left join prev x on x.pk = g.k and x.staff_id = p.id
    ) z
  ) h on true
  order by p.role, p.full_name;
end $$;
revoke all on function public.staff_scorecard(date, date) from public, anon;
grant execute on function public.staff_scorecard(date, date) to authenticated;

-- 5. Team average per role for the same period: everyone active in the role, people with no work count as 0.
--    Connected % is the team's connected calls ÷ the team's calls.
--    Admin: every scorecard role · anyone else: their own role. A Junior sees the numbers only when the team has
--    3 or more people (shown = false otherwise).
drop function if exists public.staff_scorecard_team(date, date);
create or replace function public.staff_scorecard_team(p_from date, p_to date)
returns table (role text, people int, shown boolean, avg_calls numeric, connected_pct numeric, avg_talk_minutes numeric,
  avg_counselling numeric, avg_quotes numeric, avg_enrolments numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  d_to date;
  roles text[] := array['Telecaller', 'Sales', 'HR / Counsellor', 'Placement', 'Finance', 'Front desk'];
  admin boolean := public.is_admin();
  head boolean := public.my_level() = 'Head';
begin
  if auth.uid() is null or not public.can_page('scorecard', 'r') then
    raise exception 'This page isn''t open to your role.' using errcode = '42501';
  end if;
  d_to := public.scorecard_period(p_from, p_to);
  return query
  with cur as (select * from public.scorecard_counts(p_from, d_to)),
  team as (
    select s.role, count(*)::int as people,
      coalesce(sum(c.calls), 0)::numeric as calls, coalesce(sum(c.connected), 0)::numeric as connected,
      coalesce(sum(c.talk_sec), 0)::numeric as talk_sec, coalesce(sum(c.counselling), 0)::numeric as counselling,
      coalesce(sum(c.quotes), 0)::numeric as quotes, coalesce(sum(c.enrolments), 0)::numeric as enrolments
    from public.staff s left join cur c on c.staff_id = s.id
    where s.status = 'Active' and s.role = any (roles) and (admin or s.role = public.my_role())
    group by s.role
  )
  select t.role, t.people, (admin or head or t.people >= 3),
    case when admin or head or t.people >= 3 then round(t.calls / t.people, 1) end,
    case when (admin or head or t.people >= 3) and t.calls > 0 then round(100 * t.connected / t.calls, 1) end,
    case when admin or head or t.people >= 3 then round(t.talk_sec / 60 / t.people, 1) end,
    case when admin or head or t.people >= 3 then round(t.counselling / t.people, 1) end,
    case when admin or head or t.people >= 3 then round(t.quotes / t.people, 1) end,
    case when admin or head or t.people >= 3 then round(t.enrolments / t.people, 1) end
  from team t
  order by t.role;
end $$;
revoke all on function public.staff_scorecard_team(date, date) from public, anon;
grant execute on function public.staff_scorecard_team(date, date) to authenticated;
