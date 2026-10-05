-- Stint CRM · training: attendance standing per student.
-- Definition: attendance % = sessions attended (P or L) / sessions held since the student joined.
-- A "session held" is a day on which at least one student of the batch was marked.
-- Students under setting attendance_min_pct (default 75) are flagged.
insert into public.setting(key, value) values ('attendance_min_pct', '75') on conflict (key) do nothing;

-- the threshold is not sensitive; this narrow reader avoids exposing setting_int to the browser
create or replace function public.attendance_min_pct() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(trim(value), '')::int from setting where key = 'attendance_min_pct'), 75)
$$;
revoke all on function public.attendance_min_pct() from public, anon;
grant execute on function public.attendance_min_pct() to authenticated;

create or replace view public.attendance_standing with (security_invoker = true) as
with held as (
  select batch_id, day from public.attendance group by batch_id, day
)
select c.id as candidate_id, c.batch_id, c.full_name, c.joined_on,
  (select count(*) from held h where h.batch_id = c.batch_id and h.day >= c.joined_on)::int as sessions_held,
  (select count(*) from public.attendance a where a.candidate_id = c.id and a.batch_id = c.batch_id
     and a.day >= c.joined_on and a.mark in ('P', 'L'))::int as sessions_attended,
  public.attendance_min_pct() as min_pct
from public.candidate c
where c.batch_id is not null and public.can_page('attendance', 'r');

grant select on public.attendance_standing to authenticated;
revoke all on public.attendance_standing from anon;
