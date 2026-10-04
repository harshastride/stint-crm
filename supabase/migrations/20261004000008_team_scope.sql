-- 2.2 Head vs Junior scoping.
-- A role "owns" leads and/or candidates (app_role.owns). For a role that owns an entity:
--   Junior → only records they own (lead.owner_id / lead.created_by, candidate.poc_id) and the child rows of those
--   Head   → everything owned by anyone in their role (their team), plus unassigned records
--   Admin  → everything
-- Roles that do not own an entity keep the page grid as it is (a Trainer still sees every candidate in their pages).
-- These are RESTRICTIVE policies: they narrow what the page-grid policies already allow.
alter table public.app_role add column owns text[] not null default '{}';
update public.app_role set owns = '{lead}' where name in ('Telecaller', 'Sales');
update public.app_role set owns = '{candidate}' where name = 'HR / Counsellor';

create or replace function public.my_level() returns text
language sql stable security definer set search_path = public as $$
  select level from public.staff where id = auth.uid() and status = 'Active'
$$;

create or replace function public.scoped_on(entity text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select entity = any(r.owns) from public.app_role r where r.name = public.my_role()), false) and not public.is_admin()
$$;

-- Is a record with this owner (and creator) inside my scope for the entity?
create or replace function public.in_scope(entity text, owner uuid, creator uuid default null) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when not public.scoped_on(entity) then true
    when owner = auth.uid() or creator = auth.uid() then true
    when public.my_level() = 'Head' then owner is null or exists (select 1 from public.staff s where s.id = owner and s.role = public.my_role())
    else false
  end
$$;

create or replace function public.lead_in_scope(lid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select lid is null or not public.scoped_on('lead') or exists (select 1 from public.lead l where l.id = lid and public.in_scope('lead', l.owner_id, l.created_by))
$$;

create or replace function public.candidate_in_scope(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select cid is null or not public.scoped_on('candidate') or exists (select 1 from public.candidate c where c.id = cid and public.in_scope('candidate', c.poc_id))
$$;

-- The records themselves
create policy lead_scope_sel on public.lead as restrictive for select to authenticated using (public.in_scope('lead', owner_id, created_by));
create policy lead_scope_upd on public.lead as restrictive for update to authenticated using (public.in_scope('lead', owner_id, created_by));
create policy lead_scope_del on public.lead as restrictive for delete to authenticated using (public.in_scope('lead', owner_id, created_by));
create policy candidate_scope_sel on public.candidate as restrictive for select to authenticated using (public.in_scope('candidate', poc_id));
create policy candidate_scope_upd on public.candidate as restrictive for update to authenticated using (public.in_scope('candidate', poc_id));
create policy candidate_scope_del on public.candidate as restrictive for delete to authenticated using (public.in_scope('candidate', poc_id));

-- Child rows follow their lead or candidate
do $$
declare r record;
begin
  for r in select * from (values
      ('call_log', 'lead'), ('counselling_session', 'lead'), ('fee_quote', 'lead'),
      ('alumni_followup', 'cand'), ('attendance', 'cand'), ('candidate_document', 'cand'), ('fee_payment', 'cand'), ('fee_plan', 'cand'),
      ('job_record', 'cand'), ('mock_session', 'cand'), ('placement', 'cand'), ('placement_checklist_item', 'cand'),
      ('resume_version', 'cand'), ('sme_feedback', 'cand'), ('training_note', 'cand'), ('vendor_request', 'cand'),
      ('note', 'both'), ('recording', 'both'), ('alert', 'both')
    ) as t (tbl, kind)
  loop
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (%s) with check (%s)', r.tbl || '_scope', r.tbl,
      case r.kind when 'lead' then 'public.lead_in_scope(lead_id)' when 'cand' then 'public.candidate_in_scope(candidate_id)'
        else 'public.lead_in_scope(lead_id) and public.candidate_in_scope(candidate_id)' end,
      case r.kind when 'lead' then 'public.lead_in_scope(lead_id)' when 'cand' then 'public.candidate_in_scope(candidate_id)'
        else 'public.lead_in_scope(lead_id) and public.candidate_in_scope(candidate_id)' end);
  end loop;
end $$;
