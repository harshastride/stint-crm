-- The automatic alert check (run by Admin with "run now") closes alerts that are fixed. The "only the assigned
-- person decides" rule must not block that system job. raise_alerts_now marks the transaction as a system job;
-- the assignee rule lets system jobs through (signed-in staff cannot set this flag: it is not reachable through the API).
create or replace function public.assignee_decides() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  col text := tg_argv[0]; st text := tg_argv[1]; open_vals text[] := string_to_array(tg_argv[2], ','); auto boolean := tg_argv[3] = 'auto'; what text := tg_argv[4];
  n jsonb := to_jsonb(new); o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  who uuid := (n ->> col)::uuid; was uuid := (o ->> col)::uuid; decided boolean;
begin
  if auth.uid() is null or current_setting('stint.system_job', true) = 'on' then return new; end if;
  -- handing the task to someone else
  if tg_op = 'UPDATE' and was is not null and who is distinct from was
     and not (public.my_role() = 'Admin' or public.may_act_for(was)) then
    raise exception 'Only Admin, % or their team head can reassign this %.', public.staff_name(was), what using errcode = '42501';
  end if;
  decided := case when tg_op = 'INSERT' then not (coalesce(n ->> st, '') = any (open_vals)) else (n ->> st) is distinct from (o ->> st) end;
  if decided then
    if who is null then
      if auto then new := jsonb_populate_record(new, jsonb_build_object(col, auth.uid())); end if;   -- the person deciding is recorded
    elsif not public.may_act_for(who) then
      raise exception 'Only % (assigned) can change this % to %. Ask them, or ask their team head.', public.staff_name(who), what, coalesce(n ->> st, 'empty') using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create or replace function public.raise_alerts_now() returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can run the alert check.' using errcode = '42501'; end if;
  perform set_config('stint.system_job', 'on', true);   -- this transaction only
  return public.raise_alerts();
end $$;
