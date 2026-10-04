-- Only the person a task is assigned to can decide it (approve / reject a resume, pass / fail a mock, finish a
-- counselling session, a checklist item, a follow-up or an alert, give SME feedback). Their own team head can
-- step in. Anyone else gets a clear message. Changing who it is assigned to is for Admin, that team's head, or
-- the assignee handing it over. System jobs (no signed-in user) are not limited.
create or replace function public.staff_name(p uuid) returns text language sql stable security definer set search_path = public as $$
  select full_name from staff where id = p $$;

create or replace function public.may_act_for(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p = auth.uid() or (public.my_level() = 'Head' and exists (select 1 from staff where id = p and role = public.my_role()))
$$;

create or replace function public.assignee_decides() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  col text := tg_argv[0]; st text := tg_argv[1]; open_vals text[] := string_to_array(tg_argv[2], ','); auto boolean := tg_argv[3] = 'auto'; what text := tg_argv[4];
  n jsonb := to_jsonb(new); o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  who uuid := (n ->> col)::uuid; was uuid := (o ->> col)::uuid; decided boolean;
begin
  if auth.uid() is null then return new; end if;
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

create trigger resume_assignee before insert or update on public.resume_version for each row execute function public.assignee_decides('reviewer_id', 'status', 'Pending', 'auto', 'resume');
create trigger mock_assignee before insert or update on public.mock_session for each row execute function public.assignee_decides('trainer_id', 'status', 'Booked', 'auto', 'mock');
create trigger counsel_assignee before insert or update on public.counselling_session for each row execute function public.assignee_decides('counsellor_id', 'status', 'Booked', 'auto', 'counselling session');
create trigger checklist_assignee before insert or update on public.placement_checklist_item for each row execute function public.assignee_decides('owner_id', 'status', 'Pending', 'auto', 'checklist item');
create trigger followup_assignee before insert or update on public.follow_up for each row execute function public.assignee_decides('owner_id', 'status', 'Open', 'no', 'follow-up');
create trigger alert_assignee before insert or update on public.alert for each row execute function public.assignee_decides('owner_id', 'status', 'Open', 'no', 'alert');
create trigger sme_assignee before insert or update on public.sme_feedback for each row execute function public.assignee_decides('sme_id', 'verdict', '', 'auto', 'SME feedback');

-- A document's "Verified by" is always the person who actually verified it
create or replace function public.document_verifier() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.status = 'Verified' and (tg_op = 'INSERT' or old.status is distinct from 'Verified') then
    new.verified_by := auth.uid(); new.verified_at := now();
  elsif new.status <> 'Verified' then
    new.verified_by := null; new.verified_at := null;
  elsif tg_op = 'UPDATE' then
    new.verified_by := old.verified_by; new.verified_at := old.verified_at;
  end if;
  return new;
end $$;
create trigger document_verifier before insert or update on public.candidate_document for each row execute function public.document_verifier();
