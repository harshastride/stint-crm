-- Team leaderboard: staff ranked by calls (Telecaller), enrolments (Sales, HR / Counsellor) or placements (Placement).
-- Returns only staff names and counts, never lead or candidate details.
-- Sources: call_log.caller_id; candidate.joined_on credited to the owner of the lead it came from (else the candidate POC);
-- placement.created_at credited to the candidate POC.
create or replace function public.leaderboard(p_metric text, p_period text default 'week')
returns table (staff_id uuid, full_name text, role text, total int, rank int, prev_rank int, is_me boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  unit text;
  cur_from timestamptz; prev_from timestamptz;
  roles text[];
begin
  if auth.uid() is null or not public.can_page('home', 'r') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_period not in ('week', 'month') then raise exception 'Period must be week or month'; end if;
  roles := case p_metric
    when 'calls' then array['Telecaller']
    when 'enrolments' then array['Sales', 'HR / Counsellor']
    when 'placements' then array['Placement']
  end;
  if roles is null then raise exception 'Metric must be calls, enrolments or placements'; end if;
  unit := p_period;
  cur_from := date_trunc(unit, now());
  prev_from := date_trunc(unit, cur_from - interval '1 day');

  return query
  with ev as (
    select c.caller_id as sid, c.called_at as at from public.call_log c
      where p_metric = 'calls' and c.called_at >= prev_from
    union all
    select coalesce(l.owner_id, ca.poc_id), ca.joined_on::timestamptz from public.candidate ca
      left join public.lead l on l.id = ca.lead_id
      where p_metric = 'enrolments' and ca.joined_on >= prev_from::date
    union all
    select ca.poc_id, p.created_at from public.placement p join public.candidate ca on ca.id = p.candidate_id
      where p_metric = 'placements' and p.created_at >= prev_from
  ),
  people as (
    select s.id, s.full_name, s.role from public.staff s where s.status = 'Active' and s.role = any (roles)
  ),
  counts as (
    select p.id, p.full_name, p.role,
      count(e.sid) filter (where e.at >= cur_from)::int as cur,
      count(e.sid) filter (where e.at < cur_from)::int as prev
    from people p left join ev e on e.sid = p.id group by p.id, p.full_name, p.role
  )
  select c.id, c.full_name, c.role, c.cur,
    (rank() over (order by c.cur desc))::int,
    case when c.prev > 0 then (rank() over (order by c.prev desc))::int end,
    c.id = auth.uid()
  from counts c
  order by c.cur desc, c.full_name;
end $$;

revoke all on function public.leaderboard(text, text) from public, anon;
grant execute on function public.leaderboard(text, text) to authenticated;
