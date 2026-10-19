-- 096 Lead capture: no lost enquiries.
-- A WhatsApp message from a number the CRM does not know, or a missed call to the institute's tracking number,
-- lands in "New conversations" (page `inbox`). WhatsApp: either becomes a lead straight away (setting
-- capture_auto_create = 'on') or waits for a telecaller to press Make lead / Not a lead. Missed call: always a lead,
-- with a "Call back missed call" follow-up due now for the owner. Both get one friendly auto-reply per number per
-- 24 hours (queued in `message`; it goes out once WhatsApp is switched on).
-- Staff never see the full number: capture_conversation.number is not selectable; number_masked is.
-- All writes go through the functions below (rules live here, not in the screen). Safe to run again.

-- 1. Page and default grants
insert into public.page (id, grp, title, sort) values ('inbox', 'Telecalling', 'New conversations', 7)
on conflict (id) do nothing;
select public.page_place('inbox', 'lead');   -- right after Leads
-- Grants for roles that exist (a fresh database gets them from seed.sql)
insert into public.role_page_access (role, page_id, mode)
select name, 'inbox', 'w' from public.app_role where name in ('Telecaller', 'Sales', 'Front desk')
on conflict do nothing;

-- 2. Settings (Admin settings → Branding & limits lists every setting row)
insert into public.setting (key, value) values
  ('capture_auto_reply', 'Hi! Thanks for messaging {{institute}}. We teach {{courses}}. Tell us which course you are interested in and our team will call you back shortly.'),
  ('capture_auto_create', 'off'),
  ('capture_reply_template', '')
on conflict (key) do nothing;

-- 3. Lead sources and the "Not a lead" reasons (staff can change the reasons under Dropdowns)
insert into public.lead_source (name, type, connection) values
  ('WhatsApp enquiry', 'Organic', 'Not set up'), ('Missed call', 'Organic', 'Not set up')
on conflict (name) do nothing;
insert into public.dropdown_list (id, name, used_on) values ('capture_not_lead', 'Not a lead (reason)', 'New conversations')
on conflict (id) do nothing;
insert into public.dropdown_value (list_id, value, sort)
select 'capture_not_lead', v, s from (values ('Spam', 1), ('Personal', 2), ('Wrong number', 3)) x(v, s)
where not exists (select 1 from public.dropdown_value d where d.list_id = 'capture_not_lead');

-- 4. One row per number that reached us through capture
create table if not exists public.capture_conversation (
  id uuid primary key default gen_random_uuid(),
  number text not null unique check (number ~ '^\d{8,15}$'),           -- digits, international form (91…); never readable by staff
  number_masked text generated always as ('•••••' || right(number, 4)) stored,
  channel text not null check (channel in ('whatsapp', 'missed_call')), -- how they first reached us
  profile_name text,                                                    -- the name on their WhatsApp profile, if any
  status text not null default 'New' check (status in ('New', 'Lead', 'Not a lead')),
  reason text,                                                          -- Not a lead: Spam / Personal / …
  lead_id uuid references public.lead (id) on delete set null,
  auto_created boolean not null default false,                          -- made a lead by the CRM, not by a person
  taken_by uuid references public.staff (id) on delete set null,
  taken_at timestamptz,
  closed_by uuid references public.staff (id) on delete set null,
  closed_at timestamptz,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  last_text text,
  message_count int not null default 0,
  missed_calls int not null default 0,
  last_missed_call_at timestamptz,
  auto_replied_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists capture_conversation_status_idx on public.capture_conversation (status, last_at desc);
create index if not exists capture_conversation_lead_idx on public.capture_conversation (lead_id);

alter table public.capture_conversation enable row level security;
drop policy if exists capture_read on public.capture_conversation;
create policy capture_read on public.capture_conversation for select to authenticated
  using (public.can_page('inbox', 'r') and (status = 'New' or public.recent_enough(coalesce(closed_at, last_at))));
-- No insert/update/delete policies: the functions below change rows.
revoke all on public.capture_conversation from anon, authenticated;
grant select (id, number_masked, channel, profile_name, status, reason, lead_id, auto_created, taken_by, taken_at, closed_by, closed_at,
  first_at, last_at, last_text, message_count, missed_calls, last_missed_call_at, auto_replied_at, created_at)
  on public.capture_conversation to authenticated;

drop trigger if exists zz_audit on public.capture_conversation;
create trigger zz_audit after insert or update or delete on public.capture_conversation for each row execute function public.audit_row();
drop trigger if exists aa_bin on public.capture_conversation;
create trigger aa_bin before delete on public.capture_conversation for each row execute function public.bin_row();

-- 5. Messages of a conversation live in `message` (so they follow the person into the lead's chat once made a lead)
alter table public.message add column if not exists conversation_id uuid references public.capture_conversation (id) on delete set null;
create index if not exists message_conversation_idx on public.message (conversation_id, created_at) where conversation_id is not null;

-- 6. The auto-reply text: {{courses}} = active course names, {{institute}} = institute name, {{first_name}} = WhatsApp first name or "there"
create or replace function public.capture_reply_text(p_first text) returns text
language plpgsql stable security definer set search_path = public as $$
declare t text; c text; i text;
begin
  t := coalesce(nullif(trim((select value from public.setting where key = 'capture_auto_reply')), ''),
       'Hi! Thanks for messaging {{institute}}. Our team will call you back shortly.');
  c := coalesce((select string_agg(name, ', ' order by name) from public.program where active), 'our courses');
  i := coalesce(nullif(trim((select value from public.setting where key = 'institute_name')), ''), 'Stint Academy');
  t := regexp_replace(t, '\{\{\s*courses\s*\}\}', c, 'g');
  t := regexp_replace(t, '\{\{\s*institute\s*\}\}', i, 'g');
  t := regexp_replace(t, '\{\{\s*(first_name|name)\s*\}\}', coalesce(nullif(trim(p_first), ''), 'there'), 'g');
  return left(regexp_replace(t, '\{\{\s*\w+\s*\}\}', '', 'g'), 1000);
end $$;

-- Create a lead for a captured number (the lead_assign trigger picks the owner unless one is given).
create or replace function public.capture_new_lead(p_conv public.capture_conversation, p_name text, p_source text, p_program uuid, p_owner uuid, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_mobile text := case when length(p_conv.number) = 12 and left(p_conv.number, 2) = '91' then right(p_conv.number, 10) else p_conv.number end;
        v_src uuid; v_id uuid;
begin
  select id into v_src from public.lead_source where name = p_source;
  select id into v_id from public.lead where mobile = v_mobile or mobile like '%' || right(p_conv.number, 10) limit 1;
  if v_id is not null then return v_id; end if;   -- already there (another path got there first)
  begin
    insert into public.lead (full_name, mobile, source_id, program_id, owner_id, notes)
    values (left(trim(p_name), 120), v_mobile, v_src, p_program, p_owner, '[' || p_source || '] ' || p_note)
    returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.lead where mobile = v_mobile;
  end;
  if v_src is not null then update public.lead_source set last_lead_at = now() where id = v_src; end if;
  update public.message set lead_id = v_id where conversation_id = p_conv.id and lead_id is null and candidate_id is null;
  return v_id;
end $$;

-- 7. Inbound: the WhatsApp webhook and the missed-call endpoint (service role only) call this.
-- Returns { kind: 'lead'|'candidate'|'conversation'|'ignored', lead_id, candidate_id, conversation_id, created, duplicate, reply_id }.
-- reply_id is a queued `message` row the server should try to send now.
create or replace function public.capture_inbound(p_channel text, p_number text, p_body text default null, p_provider_id text default null,
  p_profile_name text default null, p_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d text := regexp_replace(coalesce(p_number, ''), '\D', '', 'g');
  d10 text; v_at timestamptz := least(coalesce(p_at, now()), now()); v_lead uuid; v_cand uuid; v_owner uuid; v_role text;
  c public.capture_conversation; v_new boolean := false; v_created boolean := false; v_dup boolean := false;
  v_reply uuid; v_body text := left(coalesce(nullif(trim(p_body), ''), ''), 4000); v_prev_call timestamptz;
  v_profile text := left(nullif(trim(p_profile_name), ''), 80); v_auto boolean;
  v_tpl text := nullif(trim((select value from public.setting where key = 'capture_reply_template')), '');
begin
  if p_channel not in ('whatsapp', 'missed_call') then raise exception 'Unknown channel.' using errcode = '22023'; end if;
  if length(d) = 11 and left(d, 1) = '0' then d := substr(d, 2); end if;
  if length(d) = 10 then d := '91' || d; end if;
  if length(d) < 8 or length(d) > 15 then raise exception 'That is not a phone number.' using errcode = '22023'; end if;
  d10 := right(d, 10);
  if p_provider_id is not null and exists (select 1 from public.message where provider_id = p_provider_id) then
    return jsonb_build_object('kind', 'ignored', 'duplicate', true);   -- WhatsApp retries the same message: store it once
  end if;

  select id, owner_id into v_lead, v_owner from public.lead where mobile = d10 or mobile = d or mobile like '%' || d10 order by created_at limit 1;
  if v_lead is null then
    select candidate_id into v_cand from public.candidate_private where contact ->> 'mobile' like '%' || d10 limit 1;
  end if;

  -- A student (candidate) we already know: keep the message on the student; a missed call gets a follow-up for their POC.
  if v_cand is not null then
    if p_channel = 'whatsapp' then
      insert into public.message (channel, direction, status, candidate_id, from_addr, body, provider_id, sent_at, created_at)
      values ('whatsapp', 'in', 'received', v_cand, d, coalesce(nullif(v_body, ''), '[message]'), p_provider_id, v_at, v_at);
    else
      select poc_id into v_owner from public.candidate where id = v_cand;
      if not exists (select 1 from public.follow_up where candidate_id = v_cand and title = 'Call back missed call' and status = 'Open') then
        select role into v_role from public.staff where id = v_owner;
        insert into public.follow_up (title, candidate_id, owner_id, owner_role, due_at) values ('Call back missed call', v_cand, v_owner, v_role, now());
      else v_dup := true; end if;
    end if;
    return jsonb_build_object('kind', 'candidate', 'candidate_id', v_cand, 'duplicate', v_dup);
  end if;

  -- A lead we already know, writing on WhatsApp: same as before (message on the lead, owner notified). No auto-reply.
  if v_lead is not null and p_channel = 'whatsapp' then
    insert into public.message (channel, direction, status, lead_id, conversation_id, from_addr, body, provider_id, sent_at, created_at)
    values ('whatsapp', 'in', 'received', v_lead, (select id from public.capture_conversation where number = d), d,
            coalesce(nullif(v_body, ''), '[message]'), p_provider_id, v_at, v_at);
    update public.capture_conversation set last_at = v_at, last_text = left(coalesce(nullif(v_body, ''), '[message]'), 200),
      message_count = message_count + 1 where number = d;
    return jsonb_build_object('kind', 'lead', 'lead_id', v_lead);
  end if;

  -- Everyone else (and every missed call): the conversation row for this number
  insert into public.capture_conversation (number, channel, profile_name, first_at, last_at, status, lead_id)
  values (d, p_channel, v_profile, v_at, v_at, case when v_lead is null then 'New' else 'Lead' end, v_lead)
  on conflict (number) do nothing
  returning * into c;
  v_new := c.id is not null;
  if not v_new then select * into c from public.capture_conversation where number = d for update; end if;
  v_prev_call := c.last_missed_call_at;

  -- The lead was deleted since: start again
  if c.status = 'Lead' and c.lead_id is null and v_lead is null then
    update public.capture_conversation set status = 'New', reason = null, closed_by = null, closed_at = null, auto_created = false where id = c.id returning * into c;
  end if;
  if v_lead is not null and c.lead_id is distinct from v_lead then
    update public.capture_conversation set lead_id = v_lead, status = 'Lead' where id = c.id returning * into c;
  end if;

  if p_channel = 'whatsapp' then
    update public.capture_conversation set last_at = greatest(last_at, v_at), last_text = left(coalesce(nullif(v_body, ''), '[message]'), 200),
      message_count = message_count + 1, profile_name = coalesce(v_profile, profile_name) where id = c.id returning * into c;
    insert into public.message (channel, direction, status, lead_id, conversation_id, from_addr, body, provider_id, sent_at, created_at)
    values ('whatsapp', 'in', 'received', c.lead_id, c.id, d, coalesce(nullif(v_body, ''), '[message]'), p_provider_id, v_at, v_at);
    v_auto := coalesce((select lower(trim(value)) from public.setting where key = 'capture_auto_create'), 'off') in ('on', 'yes', 'true');
    if c.status = 'New' and v_auto then
      v_lead := public.capture_new_lead(c, coalesce(c.profile_name, 'WhatsApp enquiry'), 'WhatsApp enquiry', null, null, 'Sent a WhatsApp message to the institute.');
      update public.capture_conversation set status = 'Lead', lead_id = v_lead, auto_created = true, closed_at = now() where id = c.id returning * into c;
      v_created := true;
    elsif v_new and c.status = 'New' then
      -- tell the people who work this page that a new number wrote in
      insert into public.notification (staff_id, kind, title, body, link)
      select s.id, 'message', 'New WhatsApp from a new number', left(coalesce(nullif(v_body, ''), 'A new message'), 140), '/p/inbox'
      from public.staff s join public.role_page_access a on a.role = s.role and a.page_id = 'inbox' and a.mode = 'w'
      where s.status = 'Active';
      perform public.emit_event('conversation.new', 'conversation', c.id, coalesce(c.profile_name, 'New number'),
        jsonb_build_object('channel', 'WhatsApp', 'received_at', v_at));
    end if;
  else
    -- Missed call: one lead, one call-back, one reply per number per 24 hours
    update public.capture_conversation set last_at = greatest(last_at, v_at), last_text = 'Missed call', missed_calls = missed_calls + 1,
      last_missed_call_at = v_at where id = c.id returning * into c;
    if c.status = 'Not a lead' then
      return jsonb_build_object('kind', 'ignored', 'conversation_id', c.id, 'duplicate', false);   -- marked spam/personal by staff
    end if;
    v_dup := not v_new and v_prev_call is not null and v_prev_call > v_at - interval '24 hours' and c.lead_id is not null;
    if c.lead_id is null then
      v_lead := public.capture_new_lead(c, 'Missed call enquiry', 'Missed call', null, null, 'Gave a missed call to the institute number.');
      update public.capture_conversation set status = 'Lead', lead_id = v_lead, auto_created = true, closed_at = now() where id = c.id returning * into c;
      v_created := true;
    end if;
    v_lead := c.lead_id;
    if not v_dup then
      insert into public.note (lead_id, kind, body) values (v_lead, 'Missed call (inbound)', 'Gave a missed call to the institute number. Call them back.');
      if not exists (select 1 from public.follow_up where lead_id = v_lead and title = 'Call back missed call' and status = 'Open') then
        select owner_id into v_owner from public.lead where id = v_lead;
        select role into v_role from public.staff where id = v_owner;
        insert into public.follow_up (title, lead_id, owner_id, owner_role, due_at) values ('Call back missed call', v_lead, v_owner, coalesce(v_role, 'Telecaller'), now());
      end if;
    end if;
  end if;

  -- One friendly auto-reply per number per 24 hours (not to numbers marked Not a lead)
  if c.status <> 'Not a lead' and (c.auto_replied_at is null or c.auto_replied_at < now() - interval '24 hours') then
    insert into public.message (channel, direction, status, lead_id, conversation_id, body, template, send_after)
    values ('whatsapp', 'out', 'queued', c.lead_id, c.id, public.capture_reply_text(split_part(coalesce(c.profile_name, ''), ' ', 1)),
            case when p_channel = 'missed_call' then v_tpl end, now())
    returning id into v_reply;
    update public.capture_conversation set auto_replied_at = now() where id = c.id;
  end if;

  return jsonb_build_object('kind', case when c.lead_id is null then 'conversation' else 'lead' end, 'lead_id', c.lead_id,
    'conversation_id', c.id, 'created', v_created, 'duplicate', v_dup, 'reply_id', v_reply);
end $$;
revoke execute on function public.capture_inbound(text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.capture_inbound(text, text, text, text, text, timestamptz) to service_role;
revoke execute on function public.capture_new_lead(public.capture_conversation, text, text, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.capture_reply_text(text) from public, anon, authenticated;   -- used only inside capture_inbound

-- 8. Staff actions (row rules checked here; the screen only hides buttons)
create or replace function public.capture_take(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.capture_conversation;
begin
  if not public.can_page('inbox', 'w') then raise exception 'Your role can’t work on new conversations.' using errcode = '42501'; end if;
  select * into c from public.capture_conversation where id = p_id for update;
  if not found then raise exception 'This conversation was not found.' using errcode = 'P0002'; end if;
  if c.status <> 'New' then raise exception 'This conversation is already done.' using errcode = '22023'; end if;
  if c.taken_by is not null and c.taken_by <> auth.uid() and not public.is_admin() then
    raise exception '% is already on this conversation.', public.staff_name(c.taken_by) using errcode = '42501';
  end if;
  update public.capture_conversation set taken_by = auth.uid(), taken_at = now() where id = p_id;
end $$;

create or replace function public.capture_make_lead(p_id uuid, p_name text, p_program uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.capture_conversation; v_lead uuid; v_owner uuid;
begin
  if not public.can_page('inbox', 'w') then raise exception 'Your role can’t make leads from new conversations.' using errcode = '42501'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Type their name first.' using errcode = '22023'; end if;
  if p_program is not null and not exists (select 1 from public.program where id = p_program) then raise exception 'Pick a course from the list.' using errcode = '22023'; end if;
  select * into c from public.capture_conversation where id = p_id for update;
  if not found then raise exception 'This conversation was not found.' using errcode = 'P0002'; end if;
  if c.status <> 'New' then raise exception 'Someone already handled this conversation.' using errcode = '22023'; end if;
  -- the person who makes it keeps it, if they work leads; otherwise the assignment rule decides
  v_owner := case when public.my_role() in ('Telecaller', 'Sales') then auth.uid() end;
  v_lead := public.capture_new_lead(c, p_name, case when c.channel = 'missed_call' then 'Missed call' else 'WhatsApp enquiry' end, p_program, v_owner,
    case when c.channel = 'missed_call' then 'Gave a missed call to the institute number.' else 'Sent a WhatsApp message to the institute.' end);
  update public.capture_conversation set status = 'Lead', lead_id = v_lead, closed_by = auth.uid(), closed_at = now(),
    taken_by = coalesce(taken_by, auth.uid()) where id = p_id;
  return jsonb_build_object('lead_id', v_lead, 'owner', (select s.full_name from public.lead l join public.staff s on s.id = l.owner_id where l.id = v_lead));
end $$;

create or replace function public.capture_not_lead(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.capture_conversation;
begin
  if not public.can_page('inbox', 'w') then raise exception 'Your role can’t close new conversations.' using errcode = '42501'; end if;
  if not exists (select 1 from public.dropdown_value where list_id = 'capture_not_lead' and value = p_reason and active) then
    raise exception 'Pick a reason from the list.' using errcode = '22023';
  end if;
  select * into c from public.capture_conversation where id = p_id for update;
  if not found then raise exception 'This conversation was not found.' using errcode = 'P0002'; end if;
  if c.status <> 'New' then raise exception 'Someone already handled this conversation.' using errcode = '22023'; end if;
  update public.capture_conversation set status = 'Not a lead', reason = p_reason, closed_by = auth.uid(), closed_at = now() where id = p_id;
end $$;

-- Undo "Not a lead" (a mistake, or they wrote back with a real enquiry)
create or replace function public.capture_reopen(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_page('inbox', 'w') then raise exception 'Your role can’t change new conversations.' using errcode = '42501'; end if;
  update public.capture_conversation set status = 'New', reason = null, closed_by = null, closed_at = null
  where id = p_id and status = 'Not a lead';
  if not found then raise exception 'Only conversations marked Not a lead can be put back.' using errcode = '22023'; end if;
end $$;

-- The messages of one conversation (no numbers). auto = sent by the CRM.
create or replace function public.capture_thread(p_id uuid)
returns table (id uuid, direction text, body text, status text, error text, created_at timestamptz, auto boolean, by_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_page('inbox', 'r') then raise exception 'Your role can’t open new conversations.' using errcode = '42501'; end if;
  if not exists (select 1 from public.capture_conversation c where c.id = p_id and (c.status = 'New' or public.recent_enough(coalesce(c.closed_at, c.last_at)))) then
    raise exception 'This conversation was not found.' using errcode = 'P0002';
  end if;
  return query
    select m.id, m.direction, m.body, m.status, m.error, m.created_at, (m.direction = 'out' and m.created_by is null), s.full_name
    from public.message m left join public.staff s on s.id = m.created_by
    where m.conversation_id = p_id
    order by m.created_at limit 300;
end $$;

-- Counts for the page tabs and the dashboard (India time for "today")
create or replace function public.capture_counts() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'new', count(*) filter (where status = 'New'),
    'mine', count(*) filter (where status = 'New' and taken_by = auth.uid()),
    'unclaimed', count(*) filter (where status = 'New' and taken_by is null),
    'today', count(*) filter (where (first_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date))
  from public.capture_conversation
$$;

revoke execute on function public.capture_take(uuid), public.capture_make_lead(uuid, text, uuid), public.capture_not_lead(uuid, text),
  public.capture_reopen(uuid), public.capture_thread(uuid), public.capture_counts() from public, anon;
grant execute on function public.capture_take(uuid), public.capture_make_lead(uuid, text, uuid), public.capture_not_lead(uuid, text),
  public.capture_reopen(uuid), public.capture_thread(uuid), public.capture_counts() to authenticated;
