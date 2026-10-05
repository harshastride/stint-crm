-- Login guard: count failed sign-ins per email; after 5 failures in 15 minutes the email is locked for 15 minutes.
-- Only the server (service role, /api/auth/sign-in) writes or checks; admins (Users & staff page) can read the log.
create table if not exists public.login_attempt (
  id bigint generated always as identity primary key,
  email text not null,
  ok boolean not null,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists login_attempt_email_time on public.login_attempt (email, created_at desc);
alter table public.login_attempt enable row level security;
drop policy if exists login_attempt_read on public.login_attempt;
create policy login_attempt_read on public.login_attempt for select to authenticated using (public.can_page('users', 'r'));
revoke insert, update, delete on public.login_attempt from anon, authenticated;
grant select on public.login_attempt to authenticated;

-- Seconds left on a lockout for this email (0 = not locked). Same answer whether the email exists or not.
create or replace function public.login_locked_seconds(p_email text) returns integer
language sql stable security definer set search_path = public as $$
  with f as (
    select created_at from public.login_attempt
    where email = lower(trim(p_email)) and not ok and created_at > now() - interval '15 minutes'
      and created_at > coalesce((select max(created_at) from public.login_attempt where email = lower(trim(p_email)) and ok), '-infinity')
    order by created_at desc limit 5
  )
  select case when count(*) >= 5 then greatest(0, ceil(extract(epoch from (max(created_at) + interval '15 minutes' - now()))))::int else 0 end from f
$$;

create or replace function public.login_record(p_email text, p_ok boolean, p_ip text) returns void
language sql security definer set search_path = public as $$
  insert into public.login_attempt (email, ok, ip) values (lower(trim(p_email)), p_ok, left(p_ip, 64));
  delete from public.login_attempt where created_at < now() - interval '90 days';
$$;

revoke all on function public.login_locked_seconds(text) from public, anon, authenticated;
revoke all on function public.login_record(text, boolean, text) from public, anon, authenticated;
grant execute on function public.login_locked_seconds(text) to service_role;
grant execute on function public.login_record(text, boolean, text) to service_role;
