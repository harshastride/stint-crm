-- Team heads see activity only for people in their own team; Admin sees everyone.
create or replace function public.staff_activity(p_staff uuid default null, p_days int default 182) returns table (day date, n int)
language plpgsql stable security definer set search_path = public as $$
declare who uuid := coalesce(p_staff, auth.uid());
begin
  if who <> auth.uid() and coalesce(public.my_role(), '') <> 'Admin'
     and not (public.my_level() = 'Head' and exists (select 1 from staff where id = who and role = public.my_role())) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return query
    select d::date, count(*)::int from (
      select called_at as d from call_log where caller_id = who and called_at > now() - make_interval(days => p_days)
      union all select created_at from note where by_id = who and created_at > now() - make_interval(days => p_days)
      union all select created_at from follow_up where created_by = who and created_at > now() - make_interval(days => p_days)
    ) x group by 1;
end $$;
