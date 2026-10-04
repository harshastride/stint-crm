-- Announcements: Admin posts a short notice that every staff member sees at the top of the CRM.
create table public.announcement (
  id uuid primary key default gen_random_uuid(),
  message text not null check (length(message) between 3 and 280),
  tone text not null default 'Info' check (tone in ('Info', 'Important', 'Good news')),
  show_until date not null default (current_date + 7),
  created_by uuid references public.staff (id) default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.announcement enable row level security;
create policy announcement_read on public.announcement for select to authenticated using (public.my_role() is not null);
create policy announcement_write on public.announcement for all to authenticated using (public.can_page('announcement', 'w')) with check (public.can_page('announcement', 'w'));
insert into public.page (id, grp, title, sort) values ('announcement', 'Admin settings', 'Announcements', 43) on conflict (id) do nothing;

-- Who is looking at a lead or candidate right now (a heartbeat every 20 seconds while the panel is open)
create table public.viewing (
  staff_id uuid not null references public.staff (id) on delete cascade default auth.uid(),
  kind text not null check (kind in ('lead', 'candidate')),
  entity_id uuid not null,
  seen_at timestamptz not null default now(),
  primary key (staff_id, kind, entity_id)
);
alter table public.viewing enable row level security;
create policy viewing_read on public.viewing for select to authenticated using (public.can_page(kind, 'r'));
create policy viewing_mine on public.viewing for insert to authenticated with check (staff_id = auth.uid() and public.can_page(kind, 'r'));
create policy viewing_mine_upd on public.viewing for update to authenticated using (staff_id = auth.uid()) with check (staff_id = auth.uid());
create policy viewing_mine_del on public.viewing for delete to authenticated using (staff_id = auth.uid());

-- Staff onboarding checklist: what a new person has already done
create or replace function public.my_onboarding() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tour', (select tour_done_at is not null from staff where id = auth.uid()),
    'call', exists (select 1 from call_log where caller_id = auth.uid()),
    'note', exists (select 1 from note where by_id = auth.uid()),
    'followup', exists (select 1 from follow_up where created_by = auth.uid()),
    'view', exists (select 1 from saved_view where owner_id = auth.uid())
  )
$$;
grant execute on function public.my_onboarding() to authenticated;
