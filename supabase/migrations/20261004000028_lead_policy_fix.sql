-- Fix: the lead policies looked the lead up by id, which fails for a row being inserted (INSERT … RETURNING).
-- Check the row's own columns instead; lead_in_scope (for child rows) short-circuits again when no limits apply.
create or replace function public.lead_row_visible(p_stage text, p_owner uuid, p_creator uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.lead_stage_visible(p_stage)
     and (not public.scoped_on('lead') or public.in_scope('lead', p_owner, p_creator)
          or p_stage = any(coalesce((select picks_up from public.app_role where name = public.my_role()), '{}')))
$$;

drop policy lead_scope_sel on public.lead;
drop policy lead_scope_upd on public.lead;
create policy lead_scope_sel on public.lead as restrictive for select to authenticated using (public.lead_row_visible(stage, owner_id, created_by));
create policy lead_scope_upd on public.lead as restrictive for update to authenticated using (public.lead_row_visible(stage, owner_id, created_by));

create or replace function public.lead_in_scope(lid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select lid is null
      or (not public.scoped_on('lead') and coalesce((select cardinality(sees_lead_stages) = 0 from public.app_role where name = public.my_role()), true))
      or exists (select 1 from public.lead l where l.id = lid and public.lead_row_visible(l.stage, l.owner_id, l.created_by))
$$;
