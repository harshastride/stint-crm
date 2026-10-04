-- 047 · Time-limited access to personal contact details (contract: docs/privacy-contract.md)
--  * lead.mobile / lead.email can no longer be read by staff directly; lists use lead_list (masked).
--  * Full values only through reveal_contact (logged in data_access_log), and only while the
--    person is in one of the role's contact stages, not Alumni-locked, and (leads) not idle.
--  * candidate_private_get always masks contact for non-Admin and hides everything when locked.
-- Safe to re-run.

-- Settings
insert into public.setting(key, value) values
  ('old_data_days', '30'), ('alumni_lock_days', '10'), ('idle_signout_minutes', '30'), ('reveal_seconds', '60')
on conflict (key) do nothing;

create or replace function public.setting_int(p_key text, p_fallback int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(trim(value), '')::int from setting where key = p_key), p_fallback)
$$;

create or replace function public.lead_last_activity(p_lead uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select greatest(
    (select stage_changed_at from lead where id = p_lead),
    (select max(called_at) from call_log where lead_id = p_lead),
    (select max(created_at) from note where lead_id = p_lead))
$$;

-- Contact stages per role (null = any stage). Defaults set only when the columns are first added.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_role' and column_name = 'contact_lead_stages') then
    alter table public.app_role add column contact_lead_stages text[];
    alter table public.app_role add column contact_candidate_stages text[];
    update public.app_role set contact_lead_stages = '{New,Callback,Interested}' where name = 'Telecaller';
    update public.app_role set contact_lead_stages = '{Interested,Counselling}' where name = 'Sales';
    update public.app_role set contact_candidate_stages = '{Enrolled}' where name = 'Front desk';
    update public.app_role set contact_candidate_stages = '{Ready,Placed}' where name = 'Placement';
    update public.app_role set contact_candidate_stages = '{Enrolled,Training,Mocks,Resume,Docs,Ready}' where name = 'HR / Counsellor';
  end if;
end $$;

-- Masked copies on lead
alter table public.lead add column if not exists mobile_masked text
  generated always as (case when mobile is null or mobile = '' then mobile else '•••••' || right(mobile, 4) end) stored;
alter table public.lead add column if not exists email_masked text
  generated always as (case when email is null or email = '' then email
                            else left(email, 1) || '•••@' || split_part(email, '@', 2) end) stored;

-- Column-level read access: everything except mobile and email.
-- NOTE: a column added to public.lead later is NOT readable by staff until a migration grants it:
--   grant select (new_col) on public.lead to authenticated;
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'lead' and column_name not in ('mobile', 'email');
  execute 'revoke select on public.lead from authenticated, anon';
  execute format('grant select (%s) on public.lead to authenticated', cols);
end $$;

-- Lead list view: every column except mobile/email (masked ones included). RLS of lead applies.
do $$
declare cols text;
begin
  select string_agg('l.' || quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'lead' and column_name not in ('mobile', 'email');
  execute 'drop view if exists public.lead_list';
  execute format('create view public.lead_list with (security_invoker = true) as select %s from public.lead l', cols);
end $$;
grant select on public.lead_list to authenticated, service_role;

-- Access log
create table if not exists public.data_access_log (
  id bigint generated always as identity primary key,
  staff_id uuid default auth.uid() references public.staff (id) on delete set null,
  kind text not null check (kind in ('lead', 'candidate')),
  entity_id uuid not null,
  field text not null,
  at timestamptz not null default now()
);
create index if not exists data_access_log_at_idx on public.data_access_log (at desc);
alter table public.data_access_log enable row level security;
drop policy if exists data_access_log_sel on public.data_access_log;
create policy data_access_log_sel on public.data_access_log for select to authenticated using (public.is_admin());
revoke all on public.data_access_log from anon, authenticated;
grant select on public.data_access_log to authenticated;
grant all on public.data_access_log to service_role;

insert into public.page (id, grp, title, sort) values ('accesslog', 'Admin settings', 'Data access log', 43) on conflict (id) do nothing;

-- Alumni lock helper
create or replace function public.alumni_locked(p_stage text, p_changed timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select p_stage = 'Alumni' and p_changed < now() - make_interval(days => public.setting_int('alumni_lock_days', 10))
$$;

create or replace function public.stage_words(a text[]) returns text
language sql immutable as $$
  select case when cardinality(a) = 0 then 'no stage'
              when cardinality(a) = 1 then a[1]
              else array_to_string(a[1:cardinality(a) - 1], ', ') || ' or ' || a[cardinality(a)] end
$$;

-- Why the caller may not see this person's contact details (null = allowed). Admin is always allowed.
create or replace function public.contact_block_reason(p_kind text, p_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare l public.lead; c public.candidate; st text[]; days int;
begin
  if public.my_role() is null then return 'Not allowed'; end if;
  if p_kind = 'lead' then
    select * into l from public.lead where id = p_id;
    if l.id is null then return 'Not found'; end if;
    if public.is_admin() then return null; end if;
    if not (public.can_page('lead', 'r') or public.can_page('enquiry', 'r'))
       or not public.lead_row_visible(l.stage, l.owner_id, l.created_by)
       or not (l.stage not in ('Not interested', 'Converted') or public.recent_enough(l.stage_changed_at)) then
      return 'Not allowed';
    end if;
    if public.field_mode('contact') <> 'f' then return 'Your role cannot see contact details'; end if;
    select contact_lead_stages into st from public.app_role where name = public.my_role();
    if st is not null and not (l.stage = any(st)) then
      return 'Only while the lead is in ' || public.stage_words(st);
    end if;
    days := public.setting_int('old_data_days', 30);
    if public.lead_last_activity(l.id) < now() - make_interval(days => days) then
      return 'No activity for ' || days || ' days';
    end if;
    return null;
  elsif p_kind = 'candidate' then
    select * into c from public.candidate where id = p_id;
    if c.id is null then return 'Not found'; end if;
    if public.is_admin() then return null; end if;
    if not (public.can_page('candidate', 'r') or public.can_page('enrolform', 'r')) or not public.candidate_in_scope(c.id) then
      return 'Not allowed';
    end if;
    if public.field_mode('contact') <> 'f' then return 'Your role cannot see contact details'; end if;
    if public.alumni_locked(c.stage, c.stage_changed_at) then
      return 'Details locked: Alumni for more than ' || public.setting_int('alumni_lock_days', 10) || ' days';
    end if;
    select contact_candidate_stages into st from public.app_role where name = public.my_role();
    if st is not null and not (c.stage = any(st)) then
      return 'Only while the student is in ' || public.stage_words(st);
    end if;
    return null;
  end if;
  return 'Unknown kind';
end $$;
revoke execute on function public.contact_block_reason(text, uuid) from public, anon;

create or replace function public.contact_status(p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r text := public.contact_block_reason(p_kind, p_id);
begin
  return jsonb_build_object('allowed', r is null, 'reason', r, 'seconds', public.setting_int('reveal_seconds', 60));
end $$;

create or replace function public.reveal_contact(p_kind text, p_id uuid, p_field text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare r text := public.contact_block_reason(p_kind, p_id); v text;
begin
  if r is not null then raise exception '%', r using errcode = '42501'; end if;
  if p_kind = 'lead' then
    if p_field = 'mobile' then select mobile into v from public.lead where id = p_id;
    elsif p_field = 'email' then select email into v from public.lead where id = p_id;
    else raise exception 'Unknown field' using errcode = '22023'; end if;
  else
    if p_field is null or p_field = '' then raise exception 'Unknown field' using errcode = '22023'; end if;
    select contact ->> p_field into v from public.candidate_private where candidate_id = p_id;
  end if;
  insert into public.data_access_log (staff_id, kind, entity_id, field) values (auth.uid(), p_kind, p_id, p_field);
  return v;
end $$;

-- Find people by name or mobile digits; mobile always comes back masked.
create or replace function public.search_people(p_kind text, p_term text, p_limit int default 8) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t text := trim(coalesce(p_term, '')); d text; pat text; lim int := least(greatest(coalesce(p_limit, 8), 1), 50); out jsonb;
begin
  if public.my_role() is null or t = '' then return '[]'::jsonb; end if;
  d := regexp_replace(t, '\D', '', 'g');
  pat := '%' || replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  if p_kind = 'lead' then
    if not (public.can_page('lead', 'r') or public.can_page('enquiry', 'r')) then return '[]'::jsonb; end if;
    select coalesce(jsonb_agg(x), '[]'::jsonb) into out from (
      select l.id, l.full_name, l.mobile_masked, l.stage
      from public.lead l
      where (l.full_name ilike pat or (length(d) >= 3 and l.mobile like '%' || d || '%'))
        and public.lead_row_visible(l.stage, l.owner_id, l.created_by)
        and (l.stage not in ('Not interested', 'Converted') or public.recent_enough(l.stage_changed_at))
      order by l.created_at desc limit lim) x;
  elsif p_kind = 'candidate' then
    if not (public.can_page('candidate', 'r') or public.can_page('enrolform', 'r')) then return '[]'::jsonb; end if;
    select coalesce(jsonb_agg(x), '[]'::jsonb) into out from (
      select c.id, c.full_name, public.mask_text(p.contact ->> 'mobile') as mobile_masked, c.stage, c.code
      from public.candidate c left join public.candidate_private p on p.candidate_id = c.id
      where (c.full_name ilike pat or c.code ilike pat
             or (length(d) >= 3 and regexp_replace(coalesce(p.contact ->> 'mobile', ''), '\D', '', 'g') like '%' || d || '%'))
        and public.candidate_in_scope(c.id)
      order by c.created_at desc limit lim) x;
  else
    return '[]'::jsonb;
  end if;
  return out;
end $$;

-- Candidate private details: contact always masked for non-Admin; everything hidden when locked.
create or replace function public.candidate_private_get(cid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.candidate_private; c public.candidate; adm boolean := public.is_admin(); lock text; m jsonb;
begin
  if not (public.can_page('candidate', 'r') or public.can_page('enrolform', 'r')) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into p from public.candidate_private where candidate_id = cid;
  select * into c from public.candidate where id = cid;
  if not adm and c.id is not null then
    if public.alumni_locked(c.stage, c.stage_changed_at) then
      lock := 'Details locked: Alumni for more than ' || public.setting_int('alumni_lock_days', 10) || ' days';
    elsif exists (select 1 from public.app_role r where r.name = public.my_role()
                  and r.contact_candidate_stages is not null and not (c.stage = any(r.contact_candidate_stages))) then
      lock := 'Only while the student is in ' || public.stage_words((select contact_candidate_stages from public.app_role where name = public.my_role()));
    end if;
  end if;
  if lock is not null then
    m := jsonb_build_object('contact', 'h', 'family', 'h', 'identity', 'h', 'bank', 'h');
  else
    m := jsonb_build_object('contact', public.field_mode('contact'), 'family', public.field_mode('family'),
                            'identity', public.field_mode('identity'), 'bank', public.field_mode('bank'));
  end if;
  return jsonb_build_object(
    'contact', public.mask_group(coalesce(p.contact, '{}'::jsonb), case when adm then 'f' when m->>'contact' = 'h' then 'h' else 'm' end),
    'family', public.mask_group(coalesce(p.family, '{}'::jsonb), m->>'family'),
    'identity', public.mask_group(coalesce(p.identity, '{}'::jsonb), m->>'identity'),
    'bank', public.mask_group(coalesce(p.bank, '{}'::jsonb), m->>'bank'),
    'modes', m,
    'locked', lock
  );
end $$;

grant execute on function public.contact_status(text, uuid), public.reveal_contact(text, uuid, text),
  public.search_people(text, text, int), public.candidate_private_get(uuid) to authenticated;
revoke execute on function public.contact_status(text, uuid), public.reveal_contact(text, uuid, text),
  public.search_people(text, text, int) from public, anon;
