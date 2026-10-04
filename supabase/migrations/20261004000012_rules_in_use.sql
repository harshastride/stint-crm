-- 2.5 Follow-up rules and assignment rules are used, not just listed.

-- Assignment rules: "give to" is a role; "when" is one of three moments.
update public.assignment_rule set give_to = case give_to when 'Telecallers' then 'Telecaller' when 'Sales team' then 'Sales'
  when 'HR / Counsellors' then 'HR / Counsellor' else give_to end;

-- Pick the person for a moment ('New lead', 'Lead marked Interested', 'Lead converted'), or null if no live rule.
create or replace function public.pick_assignee(moment text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare r record; cap int; who uuid;
begin
  select * into r from public.assignment_rule where when_text = moment and status = 'Live' order by id limit 1;
  if not found then return null; end if;
  cap := nullif(substring(coalesce(r.limit_per_person, '') from '\d+'), '')::int;
  with people as (
    select s.id, s.full_name,
           case when moment = 'Lead converted'
                then (select count(*) from public.candidate c where c.poc_id = s.id and c.stage <> 'Alumni')
                else (select count(*) from public.lead l where l.owner_id = s.id and l.stage not in ('Converted', 'Not interested')) end as open_count,
           case when moment = 'Lead converted'
                then (select max(c.created_at) from public.candidate c where c.poc_id = s.id)
                else (select max(l.created_at) from public.lead l where l.owner_id = s.id) end as last_given
    from public.staff s where s.role = r.give_to and s.status = 'Active'
  )
  select id into who from people
  where cap is null or open_count < cap
  order by case when r.method = 'Round-robin, in turn' then coalesce(extract(epoch from last_given), 0) else open_count end, full_name
  limit 1;
  return who;
end $$;

-- New lead with no owner: follow the "New lead" rule (falls back to the least busy telecaller)
create or replace function public.assign_lead_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is null then new.created_by := auth.uid(); end if;
  if new.owner_id is null then
    new.owner_id := public.pick_assignee('New lead');
  end if;
  if new.owner_id is null then
    select s.id into new.owner_id from public.staff s
    left join public.lead l on l.owner_id = s.id and l.stage not in ('Converted', 'Not interested')
    where s.role = 'Telecaller' and s.status = 'Active' group by s.id order by count(l.id), min(s.full_name) limit 1;
  end if;
  return new;
end $$;

-- Lead marked Interested: hand it to Sales by the rule. Converted: give the candidate an HR owner.
create or replace function public.assign_on_stage() returns trigger
language plpgsql security definer set search_path = public as $$
declare who uuid;
begin
  if new.stage = 'Interested' and old.stage is distinct from 'Interested'
     and not exists (select 1 from public.staff s join public.app_role r on r.name = s.role where s.id = new.owner_id and 'Interested' = any(r.picks_up)) then
    who := public.pick_assignee('Lead marked Interested');
    if who is not null then new.owner_id := who; end if;
  end if;
  return new;
end $$;
create trigger lead_assign_on_stage before update of stage on public.lead for each row execute function public.assign_on_stage();

create or replace function public.assign_candidate_poc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.poc_id is null then new.poc_id := public.pick_assignee('Lead converted'); end if;
  return new;
end $$;
create trigger candidate_assign before insert on public.candidate for each row execute function public.assign_candidate_poc();

-- Follow-up rules: when something is logged, what comes next and when.
create or replace function public.rule_due(after text) returns timestamptz
language sql stable as $$
  select case
    when after is null or after ilike 'same day%' then now() + interval '2 hours'
    when after ~ '\d+\s*day' then now() + (substring(after from '(\d+)\s*day') || ' days')::interval
    when after ~ '\d+\s*hour' then now() + (substring(after from '(\d+)\s*hour') || ' hours')::interval
    else now() + interval '1 day'
  end
$$;

-- For the screen: the suggestion for a trigger such as 'Call: No answer'
create or replace function public.suggest_follow_up(p_trigger text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('title', r.suggest_next, 'due_at', public.rule_due(r.after), 'after', r.after)
  from public.follow_rule r where r.trigger = p_trigger and r.status = 'Live' limit 1
$$;
grant execute on function public.suggest_follow_up(text) to authenticated;

-- Candidate events raise the next follow-up for the candidate's owner by the rule
create or replace function public.follow_up_from_rule(p_trigger text, cid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record; owner uuid;
begin
  select * into r from public.follow_rule where trigger = p_trigger and status = 'Live' limit 1;
  if not found then return; end if;
  select poc_id into owner from public.candidate where id = cid;
  if exists (select 1 from public.follow_up where candidate_id = cid and title = r.suggest_next and status = 'Open') then return; end if;
  insert into public.follow_up (title, candidate_id, owner_id, owner_role, due_at, created_by)
  values (r.suggest_next, cid, owner, case when owner is null then 'HR / Counsellor' end, public.rule_due(r.after), auth.uid());
end $$;

create or replace function public.candidate_event_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  t := case tg_table_name
    when 'mock_session' then case when new.status = 'Failed' then 'Mock: Failed' end
    when 'resume_version' then case when new.status = 'Rejected' then 'Resume: Rejected' end
  end;
  if t is not null and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.follow_up_from_rule(t, new.candidate_id);
  end if;
  return new;
end $$;
create trigger mock_rules after insert or update of status on public.mock_session for each row execute function public.candidate_event_rules();

create or replace function public.attendance_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.mark = 'A' and (tg_op = 'INSERT' or old.mark is distinct from 'A') then
    perform public.follow_up_from_rule('Attendance: Absent', new.candidate_id);
  end if;
  return new;
end $$;
create trigger attendance_rules after insert or update of mark on public.attendance for each row execute function public.attendance_rules();
create trigger resume_rules after insert or update of status on public.resume_version for each row execute function public.candidate_event_rules();
