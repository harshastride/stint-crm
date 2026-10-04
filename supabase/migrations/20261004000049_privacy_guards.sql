-- Masked values (•••••1234) must never overwrite the real ones: candidate_private_set drops any value
-- that contains the mask dot, keeping what is stored. Plus a safe duplicate check for the lead import.
create or replace function public.candidate_private_set(cid uuid, grp text, data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare clean jsonb;
begin
  if grp not in ('contact', 'family', 'identity', 'bank') then raise exception 'Unknown group'; end if;
  if public.field_mode(grp) <> 'f' or not (public.can_page('candidate', 'w') or public.can_page('enrolform', 'w')) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into clean
    from jsonb_each(coalesce(data, '{}'::jsonb)) where not (jsonb_typeof(value) = 'string' and value #>> '{}' like '%•%');
  insert into public.candidate_private (candidate_id) values (cid) on conflict do nothing;
  execute format('update public.candidate_private set %I = %I || $1, updated_at = now() where candidate_id = $2', grp, grp) using clean, cid;
end $$;

-- Which of these mobiles are already leads (for the import screen); answers only yes/no per number given.
create or replace function public.existing_lead_mobiles(p_mobiles text[]) returns text[]
language sql stable security definer set search_path = public as $$
  select case when public.can_page('import', 'w') or public.can_page('lead', 'w')
    then coalesce(array_agg(mobile), '{}') else '{}' end
  from public.lead where mobile = any (p_mobiles[1:500])
$$;
revoke execute on function public.existing_lead_mobiles(text[]) from public, anon;
grant execute on function public.existing_lead_mobiles(text[]) to authenticated;
