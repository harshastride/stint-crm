-- Profile photos for staff and students. Private bucket 'photos'.
-- Paths: staff/<staff_id>/<random>.webp|jpg   candidate/<candidate_id>/<random>.webp|jpg
-- Write: staff photo = that staff member or Admin; candidate photo = staff with candidate write (in scope) or the student themself.
-- Read: staff photos = any active staff; candidate photos = staff who can see the candidate, or the student themself.
-- Column changes (staff.photo_path, candidate.photo_path) are recorded by the existing zz_audit triggers.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 1048576, array['image/webp', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

alter table public.staff add column if not exists photo_path text;
alter table public.candidate add column if not exists photo_path text;

create or replace function public.can_photo(path text, need text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare parts text[] := string_to_array(path, '/'); pid uuid;
begin
  if array_length(parts, 1) <> 3 or parts[3] !~ '^[A-Za-z0-9_-]{8,64}\.(webp|jpg)$' then return false; end if;
  begin pid := parts[2]::uuid; exception when others then return false; end;
  if parts[1] = 'staff' then
    if not exists (select 1 from public.staff where id = pid) then return false; end if;
    if need = 'r' then return public.my_role() is not null; end if;
    return pid = auth.uid() and public.my_role() is not null or public.is_admin();
  elsif parts[1] = 'candidate' then
    if not exists (select 1 from public.candidate where id = pid) then return false; end if;
    if public.my_candidate() = pid then return true; end if;
    return public.can_page('candidate', need) and public.candidate_in_scope(pid);
  end if;
  return false;
end $$;
revoke all on function public.can_photo(text, text) from public, anon;
grant execute on function public.can_photo(text, text) to authenticated;  -- used inside storage policies

drop policy if exists photos_read on storage.objects;
drop policy if exists photos_ins on storage.objects;
drop policy if exists photos_upd on storage.objects;
drop policy if exists photos_del on storage.objects;
create policy photos_read on storage.objects for select to authenticated using (bucket_id = 'photos' and public.can_photo(name, 'r'));
create policy photos_ins on storage.objects for insert to authenticated with check (bucket_id = 'photos' and public.can_photo(name, 'w'));
create policy photos_upd on storage.objects for update to authenticated using (bucket_id = 'photos' and public.can_photo(name, 'w'));
create policy photos_del on storage.objects for delete to authenticated using (bucket_id = 'photos' and public.can_photo(name, 'w'));

-- The stored path must point at this person's own folder (no borrowing someone else's file)
create or replace function public.photo_path_check() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.photo_path is not null and new.photo_path not like (case when tg_table_name = 'staff' then 'staff/' else 'candidate/' end) || new.id || '/%' then
    raise exception 'Photo must be stored in this person''s own folder.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists photo_path_check on public.staff;
create trigger photo_path_check before insert or update of photo_path on public.staff for each row execute function public.photo_path_check();
drop trigger if exists photo_path_check on public.candidate;
create trigger photo_path_check before insert or update of photo_path on public.candidate for each row execute function public.photo_path_check();

-- One call to set or clear a photo. Same rules as the bucket.
create or replace function public.set_photo(p_kind text, p_id uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_kind not in ('staff', 'candidate') then raise exception 'Unknown photo kind' using errcode = 'invalid_parameter_value'; end if;
  if p_path is not null and not public.can_photo(p_path, 'w') then raise exception 'You cannot change this photo.' using errcode = 'insufficient_privilege'; end if;
  if p_path is null and not public.can_photo(p_kind || '/' || p_id || '/check0000.webp', 'w') then
    raise exception 'You cannot change this photo.' using errcode = 'insufficient_privilege';
  end if;
  if p_kind = 'staff' then update public.staff set photo_path = p_path where id = p_id;
  else update public.candidate set photo_path = p_path where id = p_id; end if;
end $$;
revoke all on function public.set_photo(text, uuid, text) from public, anon;
grant execute on function public.set_photo(text, uuid, text) to authenticated;

-- Student portal: own photo path
create or replace function public.portal_photo() returns text
language sql stable security definer set search_path = public as $$
  select photo_path from public.candidate where id = public.my_candidate()
$$;
revoke all on function public.portal_photo() from public, anon;
grant execute on function public.portal_photo() to authenticated;
