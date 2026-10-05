-- A student's name and ID can only be changed by Admin once the record exists (spelling corrections).
-- Server jobs (no signed-in user) are unaffected. Every change is already recorded by the audit trail (058).
create or replace function public.candidate_identity_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and (new.full_name is distinct from old.full_name or new.code is distinct from old.code) then
    raise exception 'Only an Admin can change a student''s name or ID. Ask an Admin to correct it.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.candidate_identity_guard() from public, anon, authenticated;
drop trigger if exists candidate_identity_guard on public.candidate;
create trigger candidate_identity_guard before update of full_name, code on public.candidate
  for each row execute function public.candidate_identity_guard();
