-- Tags on leads and candidates (choices come from the "tag" dropdown list), the student's on-screen
-- signature from the portal, and a per-day activity count for the staff heatmap.
alter table public.lead add column tags text[] not null default '{}';
alter table public.candidate add column tags text[] not null default '{}';
create index lead_tags_idx on public.lead using gin (tags);
create index candidate_tags_idx on public.candidate using gin (tags);

insert into public.dropdown_list (id, name, used_on) values ('tag', 'Tags', 'Leads, Candidates') on conflict do nothing;
insert into public.dropdown_value (list_id, value, sort) values
  ('tag', 'Hot', 0), ('tag', 'Referral', 1), ('tag', 'Weekend batch', 2), ('tag', 'Working professional', 3), ('tag', 'Needs loan', 4)
on conflict do nothing;

alter table public.candidate add column signature_png text, add column signed_at timestamptz;
alter table public.candidate add constraint candidate_signature_size check (signature_png is null or length(signature_png) < 200000);

-- The student signs their fee agreement once; staff see it, it goes on receipts
create or replace function public.portal_sign(p_png text) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid := public.my_candidate();
begin
  if cid is null then raise exception 'Not a student account.' using errcode = '42501'; end if;
  if p_png is null or p_png not like 'data:image/png;base64,%' then raise exception 'Please sign in the box first.' using errcode = '22023'; end if;
  update candidate set signature_png = p_png, signed_at = now() where id = cid and signed_at is null;
  if not found then raise exception 'You have already signed.' using errcode = '42501'; end if;
  insert into note (candidate_id, kind, body) values (cid, 'Note', 'Student signed the fee agreement in the portal.');
end $$;
grant execute on function public.portal_sign(text) to authenticated;

create or replace function public.portal_signature() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('signed_at', signed_at) from candidate where id = public.my_candidate()
$$;
grant execute on function public.portal_signature() to authenticated;

-- Calls, notes and follow-ups done by one staff member per day (yourself, or anyone for Admin / Heads)
create or replace function public.staff_activity(p_staff uuid default null, p_days int default 182) returns table (day date, n int)
language plpgsql stable security definer set search_path = public as $$
declare who uuid := coalesce(p_staff, auth.uid());
begin
  if who <> auth.uid() and coalesce(public.my_role(), '') <> 'Admin' and coalesce(public.my_level(), '') <> 'Head' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return query
    select d::date, count(*)::int from (
      select called_at as d from call_log where caller_id = who and called_at > now() - make_interval(days => p_days)
      union all select created_at from note where by_id = who and created_at > now() - make_interval(days => p_days)
      union all select created_at from follow_up where created_by = who and created_at > now() - make_interval(days => p_days)
    ) x group by 1;
end $$;
grant execute on function public.staff_activity(uuid, int) to authenticated;
