-- 2.3 File uploads: one private bucket for candidate files.
-- Path: <candidate_id>/<page id>/<random>-<file name>. Access follows the page grid for that page
-- (resume → Resumes, doc → Documents) and the Head/Junior scope of the candidate.
insert into storage.buckets (id, name, public, file_size_limit)
values ('candidate-files', 'candidate-files', false, 20971520)
on conflict (id) do nothing;

create or replace function public.can_file(path text, need text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare parts text[] := string_to_array(path, '/'); cid uuid;
begin
  if array_length(parts, 1) < 3 or parts[2] not in ('resume', 'doc') then return false; end if;
  begin cid := parts[1]::uuid; exception when others then return false; end;
  return public.can_page(parts[2], need) and public.candidate_in_scope(cid)
     and exists (select 1 from public.candidate where id = cid);
end $$;

create policy candidate_files_read on storage.objects for select to authenticated
  using (bucket_id = 'candidate-files' and public.can_file(name, 'r'));
create policy candidate_files_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'candidate-files' and public.can_file(name, 'w'));
create policy candidate_files_upd on storage.objects for update to authenticated
  using (bucket_id = 'candidate-files' and public.can_file(name, 'w'));
create policy candidate_files_del on storage.objects for delete to authenticated
  using (bucket_id = 'candidate-files' and public.can_file(name, 'w'));
