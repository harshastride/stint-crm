-- The student's own uploaded document paths, so My files can open them (storage already limits them to <cid>/doc/).
create or replace function public.portal_document_paths() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'file_path', file_path)), '[]'::jsonb)
  from candidate_document where candidate_id = public.my_candidate() and file_path is not null
$$;
grant execute on function public.portal_document_paths() to authenticated;
