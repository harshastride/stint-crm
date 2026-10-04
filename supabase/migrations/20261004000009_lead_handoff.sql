-- Hand-off between lead-owning teams: a role can pick up leads in certain stages (Sales picks up "Interested"),
-- and booking counselling makes the counsellor the lead's owner and moves it to Counselling.
alter table public.app_role add column picks_up text[] not null default '{}';
update public.app_role set picks_up = '{Interested}' where name = 'Sales';

create or replace function public.lead_in_scope(lid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select lid is null or not public.scoped_on('lead') or exists (
    select 1 from public.lead l where l.id = lid
      and (public.in_scope('lead', l.owner_id, l.created_by)
           or l.stage = any(coalesce((select picks_up from public.app_role where name = public.my_role()), '{}'))))
$$;

drop policy lead_scope_sel on public.lead;
drop policy lead_scope_upd on public.lead;
create policy lead_scope_sel on public.lead as restrictive for select to authenticated using (public.lead_in_scope(id));
create policy lead_scope_upd on public.lead as restrictive for update to authenticated using (public.lead_in_scope(id));

create or replace function public.counselling_takes_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.lead set owner_id = coalesce(new.counsellor_id, auth.uid()),
         stage = case when stage in ('New', 'Callback', 'Interested') then 'Counselling' else stage end
  where id = new.lead_id;
  return new;
end $$;
create trigger counselling_takes_lead after insert on public.counselling_session for each row execute function public.counselling_takes_lead();
