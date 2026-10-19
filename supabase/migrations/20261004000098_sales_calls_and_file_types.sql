-- Owner decisions (growth features):
-- 1. Sales may log calls (Start my calls is used by Sales too), so Sales gets write on Call logs.
-- 2. The server refuses files that are not PDF, Word or a photo for candidate resumes and documents
--    (before, only the screen checked the type). Same list the screens accept; size limit unchanged (20 MB).

update public.role_page_access set mode = 'w' where role = 'Sales' and page_id = 'call';
insert into public.role_page_access (role, page_id, mode)
select name, 'call', 'w' from public.app_role where name = 'Sales'
on conflict (role, page_id) do update set mode = 'w';

update storage.buckets set allowed_mime_types = array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif'
] where id = 'candidate-files';
