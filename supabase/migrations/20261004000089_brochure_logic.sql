-- Course brochures, part 2 (tables are in 088): private PDF storage, recording opens from the public link,
-- the "call now" alert for the lead's owner, and two read views for the screens. Idempotent: safe to run again.
--
-- How opens are counted (shown to staff as "Opened 2×"):
--   one "open" = a reading visit. A new visit starts when the link is viewed and nothing was read for 30 minutes before.
--   Every visit (first and later ones) sends the lead's owner a notification and a 'brochure.opened' event (Teams/automations).
--   Seconds are time with the page visible, sent by the viewer every 15 s; the database caps them to the real time that
--   passed, so a tampered viewer cannot inflate them. Staff opening the link while signed in are not counted (checked
--   by the server before it calls brochure_track).

-- 1. Private bucket for brochure PDFs (20 MB, PDF only). Leads never read it directly: the server makes a short-lived link.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brochures', 'brochures', false, 20971520, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Upload / replace / delete: Admin and roles with write on the Brochures page. Read: the same people (needed to preview
-- and to delete an object); everyone else, and every lead, gets the file only through a link the server signs.
drop policy if exists brochures_read on storage.objects;
drop policy if exists brochures_ins on storage.objects;
drop policy if exists brochures_upd on storage.objects;
drop policy if exists brochures_del on storage.objects;
create policy brochures_read on storage.objects for select to authenticated using (bucket_id = 'brochures' and public.can_page('brochures', 'w'));
create policy brochures_ins on storage.objects for insert to authenticated with check (bucket_id = 'brochures' and public.can_page('brochures', 'w'));
create policy brochures_upd on storage.objects for update to authenticated using (bucket_id = 'brochures' and public.can_page('brochures', 'w'));
create policy brochures_del on storage.objects for delete to authenticated using (bucket_id = 'brochures' and public.can_page('brochures', 'w'));

-- The stored path must be a PDF in the brochures bucket layout "<random folder>/<name>.pdf" (no "..", no other bucket).
alter table public.brochure drop constraint if exists brochure_file_path_ok;
alter table public.brochure add constraint brochure_file_path_ok
  check (file_path is null or (file_path ~ '^[A-Za-z0-9_-]{8,64}/[A-Za-z0-9 ._()-]{1,120}\.pdf$' and file_path !~ '\.\.'));

-- Institute WhatsApp number for the "Questions? Reply on WhatsApp" button on the brochure page (Admin → Branding).
-- Empty = no button.
insert into public.setting (key, value) values ('institute_whatsapp', '') on conflict (key) do nothing;

-- 2. Record a batch of views from the public link. Server only (service role): the public /api/brochures/track route
--    rate-limits per address and link, then calls this. Unknown or switched-off links change nothing.
create or replace function public.brochure_track(p_token text, p_events jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s record;
  v_new boolean;
  v_allowed int;
  v_sum int;
  v_factor numeric := 1;
  v_count int;
  v_to uuid;
  v_first text;
  v_ev jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' then return jsonb_build_object('ok', false); end if;

  select bs.id, bs.lead_id, bs.sent_by, bs.last_opened_at, bs.open_count, b.title, b.status, l.full_name, l.owner_id
    into s
  from brochure_send bs join brochure b on b.id = bs.brochure_id join lead l on l.id = bs.lead_id
  where bs.token = p_token
  for update of bs;
  if not found or s.status <> 'Live' then return jsonb_build_object('ok', false); end if;

  -- at most 40 events a call; page 0 = the personal first page, 1.. = PDF pages; seconds 0–120 each
  select coalesce(jsonb_agg(jsonb_build_object(
           'page', greatest(0, least(999, coalesce((e->>'page')::numeric, 0)::int)),
           'seconds', greatest(0, least(120, coalesce((e->>'seconds')::numeric, 0)::int)))), '[]'::jsonb)
    into v_ev
  from jsonb_array_elements(case when jsonb_typeof(p_events) = 'array' then p_events else '[]'::jsonb end) with ordinality t(e, n)
  where jsonb_typeof(e) = 'object' and n <= 40
    and coalesce(e->>'page', '0') ~ '^\d{1,6}(\.\d+)?$' and coalesce(e->>'seconds', '0') ~ '^\d{1,6}(\.\d+)?$';
  if jsonb_array_length(v_ev) = 0 then v_ev := '[{"page": 0, "seconds": 0}]'; end if;

  v_new := s.last_opened_at is null or now() - s.last_opened_at > interval '30 minutes';
  -- seconds can't be more than the time that really passed since the last heartbeat (plus a little slack)
  v_allowed := case when v_new then 30 else least(300, ceil(extract(epoch from now() - s.last_opened_at))::int + 5) end;
  select coalesce(sum((x->>'seconds')::int), 0) into v_sum from jsonb_array_elements(v_ev) x;
  if v_sum > v_allowed then v_factor := v_allowed::numeric / v_sum; end if;

  insert into brochure_view (send_id, lead_id, page, seconds)
  select s.id, s.lead_id, (x->>'page')::int, floor((x->>'seconds')::int * v_factor)::int from jsonb_array_elements(v_ev) x;

  update brochure_send set
    open_count = open_count + case when v_new then 1 else 0 end,
    first_opened_at = coalesce(first_opened_at, now()),
    last_opened_at = now(),
    total_seconds = least(2000000000, total_seconds + floor(least(v_sum, v_allowed))::int)
  where id = s.id
  returning open_count into v_count;

  if v_new then
    v_first := coalesce(nullif(split_part(trim(s.full_name), ' ', 1), ''), 'Your lead');
    -- the lead's owner; if nobody owns the lead, whoever sent the brochure (only active staff)
    select id into v_to from staff where id = coalesce(s.owner_id, s.sent_by) and status = 'Active';
    if v_to is not null then
      insert into notification (staff_id, kind, title, body, link)
      values (v_to, 'brochure',
              v_first || ' is reading the brochure now — call now',
              s.title || case when v_count > 1 then ' · opened ' || v_count || ' times' else ' · first time opened' end,
              person_link(s.lead_id, null));
    end if;
    perform public.emit_event('brochure.opened', 'lead', s.lead_id, s.full_name,
      jsonb_build_object('lead', public.lead_brief(s.lead_id), 'brochure', s.title, 'open_count', v_count));
  end if;

  return jsonb_build_object('ok', true, 'opened', v_new);
end $$;
revoke execute on function public.brochure_track(text, jsonb) from public, anon, authenticated;
grant execute on function public.brochure_track(text, jsonb) to service_role;

-- Teams alerts: by default a brochure open goes to the Telecaller and Sales channels (lib/teams-events.ts defaults).
insert into public.teams_rule (event, audience) values ('brochure.opened', 'Telecaller'), ('brochure.opened', 'Sales')
on conflict (event, audience) do nothing;

-- 3. Read views (security_invoker: the caller's row security on leads, sends and views applies).
-- One row per send, for the lead panel and the Brochures page "Recent opens".
create or replace view public.brochure_send_list with (security_invoker = true) as
select bs.id, bs.token, bs.brochure_id, b.title as brochure_title, bs.lead_id, l.full_name as lead_name, l.owner_id,
       bs.sent_by, st.full_name as sent_by_name, bs.sent_at, bs.intro,
       bs.open_count, bs.first_opened_at, bs.last_opened_at, bs.total_seconds,
       coalesce(v.pages_seen, 0) as pages_seen, v.last_page,
       (bs.last_opened_at is not null and bs.last_opened_at > now() - interval '2 minutes') as reading_now
from public.brochure_send bs
join public.lead_list l on l.id = bs.lead_id
left join public.brochure b on b.id = bs.brochure_id
left join public.staff st on st.id = bs.sent_by
left join lateral (
  select count(distinct bv.page) filter (where bv.page > 0)::int as pages_seen,
         (array_agg(bv.page order by bv.opened_at desc, bv.id desc))[1] as last_page
  from public.brochure_view bv where bv.send_id = bs.id
) v on true;
revoke all on public.brochure_send_list from anon;
grant select on public.brochure_send_list to authenticated;

-- One row per brochure with its send and open counts (all time, sends the caller can see).
create or replace view public.brochure_summary with (security_invoker = true) as
select b.id, b.title, b.program_id, p.name as program_name, b.file_path, b.status, b.created_at,
       count(bs.id)::int as sends,
       count(bs.id) filter (where bs.open_count > 0)::int as opened,
       max(bs.last_opened_at) as last_opened_at
from public.brochure b
left join public.program p on p.id = b.program_id
left join public.brochure_send bs on bs.brochure_id = b.id and exists (select 1 from public.lead_list l where l.id = bs.lead_id)
group by b.id, p.name;
revoke all on public.brochure_summary from anon;
grant select on public.brochure_summary to authenticated;

create index if not exists brochure_view_send_idx on public.brochure_view (send_id, opened_at desc);
create index if not exists brochure_send_opened_idx on public.brochure_send (last_opened_at desc) where last_opened_at is not null;
