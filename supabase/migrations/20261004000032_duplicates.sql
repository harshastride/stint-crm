-- Duplicate finder and merge (Admin settings → Duplicates).
insert into public.page (id, grp, title, sort) values ('duplicates', 'Admin settings', 'Duplicates', 42) on conflict (id) do nothing;

create or replace function public.norm_name(t text) returns text language sql immutable as $$
  select regexp_replace(lower(coalesce(t, '')), '[^a-z]', '', 'g')
$$;

-- Pairs that look like the same person. Leads: same email, or same name (ignoring spaces/case) and city.
-- Candidates: same mobile or email in their contact details, or same name and program.
create or replace function public.find_duplicates() returns table (kind text, a_id uuid, a_name text, a_info text, b_id uuid, b_name text, b_info text, reason text)
language sql stable security definer set search_path = public as $$
  select * from (
    select 'lead', a.id, a.full_name, concat_ws(' · ', a.mobile, a.email, a.stage), b.id, b.full_name, concat_ws(' · ', b.mobile, b.email, b.stage),
           case when lower(a.email) = lower(b.email) then 'Same email' else 'Same name and city' end
    from lead a join lead b on a.id < b.id
     and ((a.email is not null and lower(a.email) = lower(b.email))
          or (norm_name(a.full_name) <> '' and norm_name(a.full_name) = norm_name(b.full_name) and coalesce(lower(a.city), '') = coalesce(lower(b.city), '')))
    union all
    select 'candidate', a.id, a.full_name, concat_ws(' · ', a.code, a.stage), b.id, b.full_name, concat_ws(' · ', b.code, b.stage),
           case when pa.contact->>'mobile' = pb.contact->>'mobile' then 'Same mobile'
                when lower(pa.contact->>'email') = lower(pb.contact->>'email') then 'Same email' else 'Same name and program' end
    from candidate a join candidate b on a.id < b.id
    left join candidate_private pa on pa.candidate_id = a.id left join candidate_private pb on pb.candidate_id = b.id
    where (pa.contact->>'mobile' is not null and pa.contact->>'mobile' = pb.contact->>'mobile')
       or (pa.contact->>'email' is not null and lower(pa.contact->>'email') = lower(pb.contact->>'email'))
       or (norm_name(a.full_name) <> '' and norm_name(a.full_name) = norm_name(b.full_name) and a.program_id is not distinct from b.program_id)
  ) d where public.is_admin()
$$;
grant execute on function public.find_duplicates() to authenticated;

-- Merge `drop_id` into `keep_id`: every linked record moves over, empty fields are filled in, the duplicate is deleted.
create or replace function public.merge_people(p_kind text, keep_id uuid, drop_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare col text; t record; moved int := 0; n int; k record; d record;
begin
  if not public.is_admin() then raise exception 'Only an admin can merge records.' using errcode = '42501'; end if;
  if keep_id = drop_id then raise exception 'Pick two different records.' using errcode = '23514'; end if;
  col := case p_kind when 'lead' then 'lead_id' when 'candidate' then 'candidate_id' else null end;
  if col is null then raise exception 'Unknown kind %', p_kind; end if;

  if p_kind = 'lead' then
    select * into k from lead where id = keep_id; select * into d from lead where id = drop_id;
    if k is null or d is null then raise exception 'Record not found.'; end if;
    -- free the duplicate's mobile first (it is unique), then fill gaps on the kept lead
    update lead set mobile = mobile || '-merged-' || left(id::text, 8) where id = drop_id;
    update lead set email = coalesce(k.email, d.email), city = coalesce(k.city, d.city), program_id = coalesce(k.program_id, d.program_id),
      course_other = coalesce(k.course_other, d.course_other), source_id = coalesce(k.source_id, d.source_id), campaign_id = coalesce(k.campaign_id, d.campaign_id),
      referred_by = coalesce(k.referred_by, d.referred_by), notes = nullif(concat_ws(E'\n', k.notes, d.notes), ''),
      marketing_consent = k.marketing_consent or d.marketing_consent
    where id = keep_id;
  else
    select * into k from candidate where id = keep_id; select * into d from candidate where id = drop_id;
    if k is null or d is null then raise exception 'Record not found.'; end if;
    if exists (select 1 from fee_plan where candidate_id = keep_id) and exists (select 1 from fee_plan where candidate_id = drop_id) then
      raise exception 'Both students have a fee plan. Remove one plan first, then merge.' using errcode = '23514';
    end if;
    delete from attendance a where a.candidate_id = drop_id and exists (select 1 from attendance b where b.candidate_id = keep_id and b.day = a.day);
    update candidate set lead_id = coalesce(k.lead_id, d.lead_id), program_id = coalesce(k.program_id, d.program_id), batch_id = coalesce(k.batch_id, d.batch_id),
      poc_id = coalesce(k.poc_id, d.poc_id), profile = coalesce(d.profile, '{}'::jsonb) || coalesce(k.profile, '{}'::jsonb),
      education = case when jsonb_array_length(coalesce(k.education, '[]')) > 0 then k.education else d.education end,
      experience = case when jsonb_array_length(coalesce(k.experience, '[]')) > 0 then k.experience else d.experience end
    where id = keep_id;
    update candidate set lead_id = null where id = drop_id;
    -- private details: kept values win, gaps come from the duplicate
    update candidate_private kp set contact = coalesce(dp.contact, '{}') || coalesce(kp.contact, '{}'), family = coalesce(dp.family, '{}') || coalesce(kp.family, '{}'),
      identity = coalesce(dp.identity, '{}') || coalesce(kp.identity, '{}'), bank = coalesce(dp.bank, '{}') || coalesce(kp.bank, '{}')
    from candidate_private dp where kp.candidate_id = keep_id and dp.candidate_id = drop_id;
    insert into candidate_private (candidate_id, contact, family, identity, bank)
    select keep_id, contact, family, identity, bank from candidate_private where candidate_id = drop_id
    on conflict (candidate_id) do nothing;
  end if;

  -- open automatic alerts would clash with the kept record's own; drop the duplicate's
  delete from alert where status = 'Open' and auto and (case when p_kind = 'lead' then lead_id else candidate_id end) = drop_id;
  for t in select table_name from information_schema.columns
           where table_schema = 'public' and column_name = col and table_name in (select tablename from pg_tables where schemaname = 'public')
             and table_name not in ('lead', 'candidate_private') and not (p_kind = 'candidate' and table_name = 'candidate') loop
    execute format('update public.%I set %I = $1 where %I = $2', t.table_name, col, col) using keep_id, drop_id;
    get diagnostics n = row_count; moved := moved + n;
  end loop;
  update integration_event set entity_id = keep_id where entity_id = drop_id;
  update status_history set entity_id = keep_id where entity_id = drop_id;
  insert into note (lead_id, candidate_id, kind, body, by_id)
  values (case when p_kind = 'lead' then keep_id end, case when p_kind = 'candidate' then keep_id end, 'Note',
          'Merged duplicate “' || d.full_name || '” into this record (' || moved || ' linked items moved).', auth.uid());
  execute format('delete from public.%I where id = $1', p_kind) using drop_id;
  return jsonb_build_object('moved', moved, 'kept', keep_id);
end $$;
grant execute on function public.merge_people(text, uuid, uuid) to authenticated;
