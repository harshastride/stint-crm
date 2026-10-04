-- Program comparison for counselling: aggregate numbers only, no people.
create or replace function public.program_stats()
returns table (program_id uuid, name text, fee numeric, duration_weeks int, enrolled int, placed int, placement_rate numeric, avg_ctc_lpa numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_role() is null then raise exception 'Staff only'; end if;
  return query
  select p.id, p.name, p.fee, p.duration_weeks,
    count(distinct c.id)::int,
    count(distinct c.id) filter (where c.stage = 'Placed' or pl.id is not null)::int,
    case when count(distinct c.id) = 0 then 0
      else round(100.0 * count(distinct c.id) filter (where c.stage = 'Placed' or pl.id is not null) / count(distinct c.id), 1) end,
    round(avg(pl.ctc_lpa), 2)
  from program p
  left join candidate c on c.program_id = p.id
  left join placement pl on pl.candidate_id = c.id
  where p.active is not false
  group by p.id, p.name, p.fee, p.duration_weeks
  order by p.name;
end $$;
revoke all on function public.program_stats() from public, anon;
grant execute on function public.program_stats() to authenticated;
