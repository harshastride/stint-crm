-- 2.8 Passwords. Invited staff and staff whose password an admin reset get a temporary password and
-- must change it on first login. Until they do, my_role() is empty, so row security gives them nothing.
alter table public.staff add column must_change_password boolean not null default false;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.staff where id = auth.uid() and status = 'Active' and not must_change_password
$$;

-- Called by the app right after the person sets a new password with Supabase Auth
create or replace function public.password_changed() returns void
language sql security definer set search_path = public as $$
  update public.staff set must_change_password = false, last_login_at = now() where id = auth.uid()
$$;
grant execute on function public.password_changed() to authenticated;
