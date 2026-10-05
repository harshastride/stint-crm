-- Stage rules (owner's decision 5 Oct 2026): a lead or candidate can only move to a stage that is
-- allowed from where it is now, and only when the requirements of that move are met.
-- Enforced by a BEFORE UPDATE OF stage trigger on lead and candidate, so no screen, import or API can skip it.
-- Not checked: INSERT (imports and seeds set the first stage), moves made by other database logic
-- (e.g. booking counselling moves the lead to Counselling), and server jobs using the service role or SQL.
-- Admin can override one move with force_stage(kind, id, to_stage, reason); the reason is kept in status history.

insert into public.page (id, grp, title, sort) values ('stage_rules', 'Admin settings', 'Stage rules', 41) on conflict (id) do nothing;

-- Reason a lead was marked Not interested (choices editable in Dropdown values)
alter table public.lead add column if not exists lost_reason text;
grant select (lost_reason) on public.lead to authenticated;  -- lead reads are column-level since 047
insert into public.dropdown_list (id, name, used_on) values ('lost_reason', 'Reason not interested', 'Leads') on conflict (id) do nothing;
insert into public.dropdown_value (list_id, value, sort, locked) values
  ('lost_reason', 'Fee too high', 0, false), ('lost_reason', 'Joined another institute', 1, false),
  ('lost_reason', 'Not reachable', 2, false), ('lost_reason', 'Not eligible', 3, false),
  ('lost_reason', 'Timing not right', 4, false), ('lost_reason', 'Other', 5, false)
on conflict (list_id, value) do nothing;

create table if not exists public.stage_transition (
  kind text not null check (kind in ('lead', 'candidate')),
  from_stage text not null,
  to_stage text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (kind, from_stage, to_stage)
);

create table if not exists public.stage_requirement (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('lead', 'candidate')),
  from_stage text,            -- null = from any stage
  to_stage text,              -- null = any exit
  code text not null,         -- what the database checks (see stage_unmet)
  label text not null,        -- shown to staff
  active boolean not null default true,
  sort int not null default 0,
  updated_at timestamptz not null default now(),
  unique nulls not distinct (kind, from_stage, to_stage, code)
);

alter table public.stage_transition enable row level security;
alter table public.stage_requirement enable row level security;
revoke all on public.stage_transition, public.stage_requirement from anon;
grant select, insert, update, delete on public.stage_transition, public.stage_requirement to authenticated;

drop policy if exists stage_transition_read on public.stage_transition;
drop policy if exists stage_transition_write on public.stage_transition;
create policy stage_transition_read on public.stage_transition for select to authenticated
  using (public.can_page('stage_rules', 'r') or public.can_page(kind, 'r'));
create policy stage_transition_write on public.stage_transition for all to authenticated
  using (public.can_page('stage_rules', 'w')) with check (public.can_page('stage_rules', 'w'));

drop policy if exists stage_requirement_read on public.stage_requirement;
drop policy if exists stage_requirement_write on public.stage_requirement;
create policy stage_requirement_read on public.stage_requirement for select to authenticated
  using (public.can_page('stage_rules', 'r') or public.can_page(kind, 'r'));
create policy stage_requirement_write on public.stage_requirement for all to authenticated
  using (public.can_page('stage_rules', 'w')) with check (public.can_page('stage_rules', 'w'));

-- Default moves
insert into public.stage_transition (kind, from_stage, to_stage) values
  ('lead', 'New', 'Callback'), ('lead', 'New', 'Interested'), ('lead', 'New', 'Not interested'),
  ('lead', 'Callback', 'Callback'), ('lead', 'Callback', 'Interested'), ('lead', 'Callback', 'Not interested'),
  ('lead', 'Interested', 'Counselling'), ('lead', 'Interested', 'Not interested'),
  ('lead', 'Counselling', 'Converted'), ('lead', 'Counselling', 'Interested'), ('lead', 'Counselling', 'Not interested'),
  ('lead', 'Not interested', 'New'),
  ('candidate', 'Enrolled', 'Training'),
  ('candidate', 'Training', 'Mocks'), ('candidate', 'Training', 'Enrolled'),
  ('candidate', 'Mocks', 'Resume'), ('candidate', 'Mocks', 'Training'),
  ('candidate', 'Resume', 'Docs'), ('candidate', 'Resume', 'Mocks'),
  ('candidate', 'Docs', 'Ready'), ('candidate', 'Docs', 'Resume'),
  ('candidate', 'Ready', 'Placed'), ('candidate', 'Ready', 'Docs'),
  ('candidate', 'Placed', 'Alumni'), ('candidate', 'Placed', 'Ready'),
  ('candidate', 'Alumni', 'Placed')
on conflict do nothing;

-- Default requirements. Training → Mocks attendance is OFF until attendance is tracked (owner, 5 Oct 2026).
insert into public.stage_requirement (kind, from_stage, to_stage, code, label, active, sort) values
  ('lead', 'New', 'Callback', 'call_logged', 'At least one call logged', true, 1),
  ('lead', 'New', 'Interested', 'call_logged', 'At least one call logged', true, 1),
  ('lead', null, 'Callback', 'next_call_set', 'Next call date and time set', true, 2),
  ('lead', 'Interested', 'Counselling', 'counselling_booked', 'A counselling session booked', true, 3),
  ('lead', 'Counselling', 'Converted', 'counselling_done', 'Counselling session marked Done', true, 4),
  ('lead', 'Counselling', 'Converted', 'quote_sent', 'A fee quote sent or accepted', true, 5),
  ('lead', null, 'Not interested', 'lost_reason', 'A reason for not interested', true, 6),
  ('candidate', 'Enrolled', 'Training', 'batch_assigned', 'Assigned to a batch', true, 1),
  ('candidate', 'Enrolled', 'Training', 'first_payment', 'First fee payment received', true, 2),
  ('candidate', 'Training', 'Mocks', 'attendance_min', 'Attendance at or above the minimum', false, 3),
  ('candidate', 'Mocks', 'Resume', 'mock_passed', 'At least one mock passed', true, 4),
  ('candidate', 'Resume', 'Docs', 'resume_approved', 'An approved resume version', true, 5),
  ('candidate', 'Docs', 'Ready', 'docs_verified', 'All documents Verified', true, 6),
  ('candidate', 'Ready', 'Placed', 'offer_accepted', 'A placement with offer accepted or joined', true, 7),
  ('candidate', 'Placed', 'Alumni', 'joined_date_passed', 'Joining date has passed', true, 8)
on conflict do nothing;

-- One requirement: null when met, otherwise what is missing in plain words. r = the row as it will be saved.
create or replace function public.stage_req_detail(p_kind text, p_code text, p_id uuid, r jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
declare n int; m int; pct int; minp int;
begin
  case p_code
  when 'call_logged' then
    if not exists (select 1 from call_log where lead_id = p_id) then return 'no call has been logged yet'; end if;
  when 'next_call_set' then
    if (r ->> 'next_call_at') is null then return 'the next call date and time is not set';
    elsif (r ->> 'next_call_at')::timestamptz < now() then return 'the next call time is in the past'; end if;
  when 'counselling_booked' then
    if not exists (select 1 from counselling_session where lead_id = p_id and status <> 'No-show') then return 'no counselling session is booked'; end if;
  when 'counselling_done' then
    if not exists (select 1 from counselling_session where lead_id = p_id and status in ('Done', 'Won')) then return 'the counselling session is not marked Done'; end if;
  when 'quote_sent' then
    if not exists (select 1 from fee_quote where lead_id = p_id and status in ('Sent', 'Negotiating', 'Accepted')) then return 'no fee quote has been sent'; end if;
  when 'lost_reason' then
    if coalesce(trim(r ->> 'lost_reason'), '') = '' then return 'no reason is recorded'; end if;
  when 'batch_assigned' then
    if (r ->> 'batch_id') is null then return 'no batch is assigned'; end if;
  when 'first_payment' then
    if not exists (select 1 from fee_payment where candidate_id = p_id and status = 'Received') then return 'no fee payment has been received'; end if;
  when 'attendance_min' then
    minp := public.attendance_min_pct();
    select count(*) into n from (select distinct day from attendance a where a.batch_id = (r ->> 'batch_id')::uuid and a.day >= (r ->> 'joined_on')::date) h;
    select count(*) into m from attendance a where a.candidate_id = p_id and a.batch_id = (r ->> 'batch_id')::uuid and a.day >= (r ->> 'joined_on')::date and a.mark in ('P', 'L');
    if n = 0 then return 'no classes have been marked yet'; end if;
    pct := floor(100.0 * m / n);
    if pct < minp then return format('attendance is %s%% (needs %s%%)', pct, minp); end if;
  when 'mock_passed' then
    if not exists (select 1 from mock_session where candidate_id = p_id and status = 'Passed') then return 'no mock has been passed'; end if;
  when 'resume_approved' then
    if not exists (select 1 from resume_version where candidate_id = p_id and status = 'Approved') then return 'no resume version is approved'; end if;
  when 'docs_verified' then
    select count(*), count(*) filter (where status <> 'Verified') into n, m from candidate_document where candidate_id = p_id;
    if n = 0 then return 'no documents are on file';
    elsif m > 0 then return format('%s of %s documents are not Verified', m, n); end if;
  when 'offer_accepted' then
    if not exists (select 1 from placement where candidate_id = p_id and status in ('Joining soon', 'Joined')) then return 'no placement with an accepted offer'; end if;
  when 'joined_date_passed' then
    if not exists (select 1 from placement where candidate_id = p_id and status <> 'Dropped' and joining_on <= current_date) then return 'the joining date has not passed yet'; end if;
  else return null;
  end case;
  return null;
end $$;
revoke all on function public.stage_req_detail(text, text, uuid, jsonb) from public, anon, authenticated;

-- Everything blocking one move: [] when allowed. Each item: {code, label, detail}; code 'not_allowed' when the move itself is off.
-- With p_all, met requirements are listed too ({..., met: true}) so the screen can show a full checklist.
drop function if exists public.stage_unmet(text, uuid, text, text, jsonb);
drop function if exists public.stage_check(text, uuid);
create or replace function public.stage_unmet(p_kind text, p_id uuid, p_from text, p_to text, r jsonb default null, p_all boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb := '[]'::jsonb; q record; d text;
begin
  if p_kind not in ('lead', 'candidate') then raise exception 'Unknown kind' using errcode = '22023'; end if;
  if auth.role() in ('authenticated', 'anon') and not public.can_page(p_kind, 'r') then raise exception 'Not allowed' using errcode = '42501'; end if;
  if r is null then
    if p_kind = 'lead' then select to_jsonb(l) into r from lead l where id = p_id; else select to_jsonb(c) into r from candidate c where id = p_id; end if;
  end if;
  if not exists (select 1 from stage_transition where kind = p_kind and from_stage = p_from and to_stage = p_to and active) then
    return jsonb_build_array(jsonb_build_object('code', 'not_allowed', 'label', format('Moving from %s to %s is not allowed', p_from, p_to), 'detail', 'that move is switched off', 'met', false));
  end if;
  for q in select * from stage_requirement where kind = p_kind and active
             and (from_stage is null or from_stage = p_from) and (to_stage is null or to_stage = p_to) order by sort, label loop
    d := public.stage_req_detail(p_kind, q.code, p_id, r);
    if d is not null then out := out || jsonb_build_object('code', q.code, 'label', q.label, 'detail', d, 'met', false);
    elsif p_all then out := out || jsonb_build_object('code', q.code, 'label', q.label, 'detail', null, 'met', true); end if;
  end loop;
  return out;
end $$;
revoke all on function public.stage_unmet(text, uuid, text, text, jsonb, boolean) from public, anon;
grant execute on function public.stage_unmet(text, uuid, text, text, jsonb, boolean) to authenticated, service_role;

-- The guard
create or replace function public.stage_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare u jsonb; allowed text; msg text;
begin
  if new.stage is not distinct from old.stage then return new; end if;
  if coalesce(current_setting('stint.stage_force', true), '') = 'on' then return new; end if;
  if pg_trigger_depth() > 1 then return new; end if;                               -- moves made by other database rules
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then return new; end if; -- service jobs, migrations, SQL
  u := public.stage_unmet(tg_table_name, new.id, old.stage, new.stage, to_jsonb(new));
  if jsonb_array_length(u) = 0 then return new; end if;
  if u -> 0 ->> 'code' = 'not_allowed' then
    select string_agg(t.to_stage, ', ' order by coalesce(v.sort, 99)) into allowed
      from stage_transition t left join dropdown_value v on v.list_id = tg_table_name || '_stage' and v.value = t.to_stage
     where t.kind = tg_table_name and t.from_stage = old.stage and t.active;
    msg := format('Can''t move from %s to %s: that move isn''t allowed.', old.stage, new.stage)
        || case when allowed is null then ' No moves are allowed from ' || old.stage || '.' else ' Allowed next: ' || allowed || '.' end;
  else
    select format('Can''t move to %s yet: %s.', new.stage, string_agg(x ->> 'detail', '; ')) into msg from jsonb_array_elements(u) x;
  end if;
  raise exception '%', msg using errcode = '23514', hint = 'stage_rules';
end $$;

revoke all on function public.stage_guard() from public, anon, authenticated;

drop trigger if exists lead_0_stage_guard on public.lead;
drop trigger if exists candidate_0_stage_guard on public.candidate;
create trigger lead_0_stage_guard before update of stage on public.lead for each row execute function public.stage_guard();
create trigger candidate_0_stage_guard before update of stage on public.candidate for each row execute function public.stage_guard();

-- What the browser shows: every allowed next stage with ok + what is missing. Row security applies (invoker).
create or replace function public.stage_check(p_kind text, p_id uuid)
returns table (to_stage text, ok boolean, missing jsonb, checks jsonb)
language plpgsql stable security invoker set search_path = public as $$
declare cur text; r jsonb;
begin
  -- only the columns the rules read (staff cannot select lead mobile/email)
  if p_kind = 'lead' then select l.stage, jsonb_build_object('id', l.id, 'next_call_at', l.next_call_at, 'lost_reason', l.lost_reason) into cur, r from lead l where l.id = p_id;
  elsif p_kind = 'candidate' then select c.stage, jsonb_build_object('id', c.id, 'batch_id', c.batch_id, 'joined_on', c.joined_on) into cur, r from candidate c where c.id = p_id;
  else raise exception 'Unknown kind' using errcode = '22023'; end if;
  if cur is null then return; end if;
  return query
    select t.to_stage, not exists (select 1 from jsonb_array_elements(u.m) x where not (x ->> 'met')::boolean),
           coalesce((select jsonb_agg(x) from jsonb_array_elements(u.m) x where not (x ->> 'met')::boolean), '[]'::jsonb), u.m
      from stage_transition t
      left join dropdown_value v on v.list_id = p_kind || '_stage' and v.value = t.to_stage
      cross join lateral (select public.stage_unmet(p_kind, p_id, cur, t.to_stage, r, true) as m) u
     where t.kind = p_kind and t.from_stage = cur and t.active
     order by coalesce(v.sort, 99), t.to_stage;
end $$;
revoke all on function public.stage_check(text, uuid) from public, anon;
grant execute on function public.stage_check(text, uuid) to authenticated;

-- Admin override for one move, with the reason kept in status history (the audit log records the row change too)
create or replace function public.force_stage(p_kind text, p_id uuid, p_to text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare cur text; who text;
begin
  if not public.is_admin() then raise exception 'Only an Admin can override a stage move.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give a reason of at least 5 characters for the override.' using errcode = '23514'; end if;
  if p_kind not in ('lead', 'candidate') then raise exception 'Unknown kind' using errcode = '22023'; end if;
  if not exists (select 1 from dropdown_value where list_id = p_kind || '_stage' and value = p_to) then
    raise exception '"%" is not a % stage.', p_to, p_kind using errcode = '23514';
  end if;
  if p_kind = 'lead' then select stage, full_name into cur, who from lead where id = p_id; else select stage, full_name into cur, who from candidate where id = p_id; end if;
  if cur is null then raise exception 'Record not found.' using errcode = 'P0002'; end if;
  if cur = p_to then return; end if;
  perform set_config('stint.stage_force', 'on', true);
  if p_kind = 'lead' then update lead set stage = p_to where id = p_id; else update candidate set stage = p_to where id = p_id; end if;
  perform set_config('stint.stage_force', '', true);
  insert into status_history (entity, entity_id, person_name, what, from_value, to_value, by_id)
  values (p_kind, p_id, who, left('Stage override by Admin: ' || trim(p_reason), 300), cur, p_to, auth.uid());
end $$;
revoke all on function public.force_stage(text, uuid, text, text) from public, anon;
grant execute on function public.force_stage(text, uuid, text, text) to authenticated;

-- Rule changes go to the audit log like other admin settings
drop trigger if exists zz_audit on public.stage_transition;
drop trigger if exists zz_audit on public.stage_requirement;
create trigger zz_audit after insert or update or delete on public.stage_transition for each row execute function public.audit_row();
create trigger zz_audit after insert or update or delete on public.stage_requirement for each row execute function public.audit_row();
