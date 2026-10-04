-- Saved views on list pages: a name plus tab, search, sort and hidden columns.
-- Visible to the owner, to the owner's role ("team") or to everyone; only the owner (or Admin) changes or deletes it.
create table public.saved_view (
  id uuid primary key default gen_random_uuid(),
  page_id text not null references public.page (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  config jsonb not null default '{}'::jsonb,
  shared text not null default 'me' check (shared in ('me', 'team', 'all')),
  owner_id uuid not null default auth.uid() references public.staff (id) on delete cascade,
  owner_role text not null default public.my_role(),
  created_at timestamptz not null default now()
);
create index saved_view_page_idx on public.saved_view (page_id);
alter table public.saved_view enable row level security;
create policy saved_view_read on public.saved_view for select to authenticated
  using (public.can_page(page_id, 'r') and (owner_id = auth.uid() or shared = 'all' or (shared = 'team' and owner_role = public.my_role()) or public.is_admin()));
create policy saved_view_ins on public.saved_view for insert to authenticated
  with check (owner_id = auth.uid() and owner_role = public.my_role() and public.can_page(page_id, 'r'));
create policy saved_view_upd on public.saved_view for update to authenticated using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin());
create policy saved_view_del on public.saved_view for delete to authenticated using (owner_id = auth.uid() or public.is_admin());
grant select, insert, update, delete on public.saved_view to authenticated;
