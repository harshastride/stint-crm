-- A role can be limited to candidates in certain stages (app_role.sees_candidate_stages; empty = all stages).
-- Front desk only needs students who have just enrolled (to finish the data sheet), and no Documents page.
alter table public.app_role add column sees_candidate_stages text[] not null default '{}';
update public.app_role set sees_candidate_stages = '{Enrolled}' where name = 'Front desk';
delete from public.role_page_access where role = 'Front desk' and page_id = 'doc';

create or replace function public.candidate_stage_visible(stage text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or coalesce((select cardinality(sees_candidate_stages) = 0 or stage = any(sees_candidate_stages)
                                         from public.app_role where name = public.my_role()), true)
$$;

create policy candidate_stage_sel on public.candidate as restrictive for select to authenticated using (public.candidate_stage_visible(stage));
create policy candidate_stage_upd on public.candidate as restrictive for update to authenticated using (public.candidate_stage_visible(stage));

-- child rows (notes, follow-ups shown in the quick panel, files) follow the same limit
create or replace function public.candidate_in_scope(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select cid is null or exists (select 1 from public.candidate c where c.id = cid
    and (not public.scoped_on('candidate') or public.in_scope('candidate', c.poc_id))
    and public.candidate_stage_visible(c.stage))
$$;
