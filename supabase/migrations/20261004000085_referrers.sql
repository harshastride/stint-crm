-- Referrals on the New enquiry form: look the referrer up among students, alumni, past enquiries, staff and
-- earlier referrers; if they are not there, save a new referrer with name, mobile and city.
-- The lead keeps referred_by (the name, as before) plus a link to who referred them.
-- Mobiles are never readable by staff: search results show only the last 4 digits.

-- 1. People who referred someone but are not otherwise in the CRM
create table if not exists public.referrer (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) > 0),
  mobile text not null unique check (mobile ~ '^[6-9][0-9]{9}$'),
  city text not null check (length(trim(city)) > 0),
  created_by uuid references public.staff (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.referrer enable row level security;
revoke all on public.referrer from public, anon, authenticated;
grant select (id, full_name, city, created_by, created_at) on public.referrer to authenticated;   -- never the mobile
drop policy if exists referrer_read on public.referrer;
create policy referrer_read on public.referrer for select to authenticated
  using (public.can_page('lead', 'r') or public.can_page('enquiry', 'r'));
drop policy if exists referrer_admin on public.referrer;
create policy referrer_admin on public.referrer for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant update (full_name, city) on public.referrer to authenticated;

drop trigger if exists zz_audit on public.referrer;
create trigger zz_audit after insert or update or delete on public.referrer for each row execute function public.audit_row();
drop trigger if exists aa_bin on public.referrer;
create trigger aa_bin before delete on public.referrer for each row execute function public.bin_row();

-- 2. Who referred a lead (referred_by keeps the name for lists, reports and Activepieces)
alter table public.lead add column if not exists referrer_kind text check (referrer_kind in ('candidate', 'lead', 'staff', 'referrer'));
alter table public.lead add column if not exists referrer_id uuid;
alter table public.lead drop constraint if exists lead_referrer_pair;
alter table public.lead add constraint lead_referrer_pair check ((referrer_kind is null) = (referrer_id is null));
create index if not exists lead_referrer_idx on public.lead (referrer_kind, referrer_id) where referrer_id is not null;
grant select (referrer_kind, referrer_id) on public.lead to authenticated;  -- lead reads are column-level since 047

-- 3. Who may look referrers up: the New enquiry page (Front desk and Admin by default).
--    A mobile only matches when all 10 digits are given (no partial-number searching), last-4 digits are shown
--    only where the caller may see that person's contact, and enquiries follow the usual lead visibility rules.
create or replace function public.referrer_mobile10(t text) returns text
language sql immutable set search_path = public as $$
  select case when d ~ '^(91|0)?[6-9][0-9]{9}$' then right(d, 10) end from (select regexp_replace(coalesce(t, ''), '\D', '', 'g') as d) x
$$;

create or replace function public.referrer_last4(m text) returns text
language sql immutable set search_path = public as $$
  select case when length(regexp_replace(coalesce(m, ''), '\D', '', 'g')) >= 4
              then '••••••' || right(regexp_replace(m, '\D', '', 'g'), 4) end
$$;

create or replace function public.referrer_search(p_term text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t text := trim(coalesce(p_term, '')); m text := public.referrer_mobile10(p_term); pat text; out jsonb;
begin
  if not public.can_page('enquiry', 'w') then return '[]'::jsonb; end if;
  if length(t) < 2 then return '[]'::jsonb; end if;
  pat := '%' || replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select coalesce(jsonb_agg(x order by x.rank, x.name), '[]'::jsonb) into out from (
    (select 'candidate' as kind, c.id, c.full_name as name, 1 as rank,
            case when c.stage = 'Alumni' then 'Alumni' else 'Student' end
              || coalesce(' · ' || g.name, '') || coalesce(' · ' || c.code, '') as detail,
            case when public.contact_block_reason('candidate', c.id) is null then public.referrer_last4(p.contact ->> 'mobile') end as mobile_last4
     from candidate c left join program g on g.id = c.program_id left join candidate_private p on p.candidate_id = c.id
     where c.full_name ilike pat or c.code ilike pat
        or (m is not null and public.referrer_mobile10(p.contact ->> 'mobile') = m)
     order by c.created_at desc limit 6)
    union all
    (select 'referrer', r.id, r.full_name, 2, 'Referred before · ' || r.city, public.referrer_last4(r.mobile)
     from referrer r where r.full_name ilike pat or (m is not null and r.mobile = m)
     order by r.created_at desc limit 4)
    union all
    (select 'staff', s.id, s.full_name, 3, 'Staff · ' || s.role, null
     from staff s where s.status = 'Active' and s.full_name ilike pat limit 3)
    union all
    (select 'lead', l.id, l.full_name, 4, 'Enquiry · ' || l.stage,
            case when public.contact_block_reason('lead', l.id) is null then public.referrer_last4(l.mobile) end
     from lead l
     where (l.full_name ilike pat or (m is not null and l.mobile = m))
       and l.stage <> 'Converted'                                   -- converted enquiries are already listed as students
       and public.lead_row_visible(l.stage, l.owner_id, l.created_by)
       and (l.stage <> 'Not interested' or public.recent_enough(l.stage_changed_at))
     order by l.created_at desc limit 4)
  ) x;
  return out;
end $$;

-- 4. Add a new referrer (name, 10-digit mobile, city). If that mobile is already a student or enquiry whose contact the
--    caller may see, or an earlier referrer, link that person instead. A match the caller may not see is never revealed:
--    the referrer is simply saved on its own.
create or replace function public.referrer_add(p_name text, p_mobile text, p_city text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m text := public.referrer_mobile10(p_mobile); hit jsonb; rid uuid;
begin
  if not public.can_page('enquiry', 'w') then raise exception 'Not allowed' using errcode = '42501'; end if;
  if trim(coalesce(p_name, '')) = '' then raise exception 'Enter the referrer''s name.' using errcode = '22023'; end if;
  if m is null then raise exception 'Use a 10-digit mobile starting with 6–9.' using errcode = '22023'; end if;
  if trim(coalesce(p_city, '')) = '' then raise exception 'Enter the referrer''s city or area.' using errcode = '22023'; end if;

  select jsonb_build_object('kind', 'referrer', 'id', r.id, 'name', r.full_name, 'existing', true) into hit from referrer r where r.mobile = m;
  if hit is null then
    select jsonb_build_object('kind', 'candidate', 'id', c.id, 'name', c.full_name, 'existing', true) into hit
    from candidate c join candidate_private p on p.candidate_id = c.id
    where public.referrer_mobile10(p.contact ->> 'mobile') = m and public.contact_block_reason('candidate', c.id) is null limit 1;
  end if;
  if hit is null then
    select jsonb_build_object('kind', 'lead', 'id', l.id, 'name', l.full_name, 'existing', true) into hit
    from lead l where l.mobile = m and l.stage <> 'Converted'
      and public.lead_row_visible(l.stage, l.owner_id, l.created_by) and public.contact_block_reason('lead', l.id) is null limit 1;
  end if;
  if hit is not null then return hit; end if;

  insert into referrer (full_name, mobile, city) values (trim(p_name), m, trim(p_city)) returning id into rid;
  return jsonb_build_object('kind', 'referrer', 'id', rid, 'name', trim(p_name), 'existing', false);
end $$;
revoke execute on function public.referrer_search(text), public.referrer_add(text, text, text) from public, anon;
grant execute on function public.referrer_search(text), public.referrer_add(text, text, text) to authenticated;

-- 5. The database checks the link: the referrer must exist, a lead cannot refer itself, and referred_by is set from
--    the linked person (so the name always matches the link).
create or replace function public.lead_referrer_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if new.referrer_id is null then return new; end if;
  if new.referrer_kind = 'lead' and new.referrer_id = new.id then raise exception 'A lead cannot refer itself' using errcode = '22023'; end if;
  who := case new.referrer_kind
    when 'candidate' then (select full_name from candidate where id = new.referrer_id)
    when 'lead' then (select full_name from lead where id = new.referrer_id)
    when 'staff' then (select full_name from staff where id = new.referrer_id)
    when 'referrer' then (select full_name from referrer where id = new.referrer_id) end;
  if who is null then raise exception 'The referrer was not found' using errcode = '23503'; end if;
  new.referred_by := who;
  return new;
end $$;
revoke execute on function public.lead_referrer_check() from public, anon, authenticated;
drop trigger if exists lead_referrer_check on public.lead;
create trigger lead_referrer_check before insert or update of referrer_kind, referrer_id on public.lead
  for each row execute function public.lead_referrer_check();
