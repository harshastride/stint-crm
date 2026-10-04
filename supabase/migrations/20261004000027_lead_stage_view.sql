-- Records tab on Roles & permissions: a role can also be limited to leads in certain stages (empty = all).
alter table public.app_role add column sees_lead_stages text[] not null default '{}';

create or replace function public.lead_stage_visible(stage text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or coalesce((select cardinality(sees_lead_stages) = 0 or stage = any(sees_lead_stages)
                                         from public.app_role where name = public.my_role()), true)
$$;
create policy lead_stage_sel on public.lead as restrictive for select to authenticated using (public.lead_stage_visible(stage));
create policy lead_stage_upd on public.lead as restrictive for update to authenticated using (public.lead_stage_visible(stage));

create or replace function public.lead_in_scope(lid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select lid is null or exists (
    select 1 from public.lead l where l.id = lid
      and public.lead_stage_visible(l.stage)
      and (not public.scoped_on('lead')
           or public.in_scope('lead', l.owner_id, l.created_by)
           or l.stage = any(coalesce((select picks_up from public.app_role where name = public.my_role()), '{}'))))
$$;
