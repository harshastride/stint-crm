-- Internal discussion threads on a lead or candidate, with Resolve / Reopen.
-- Visibility = same as notes: you can read and reply if you can open that lead or candidate
-- (page access AND the record's own row security, checked by selecting it as the caller).
-- Rules enforced here, not in React:
--   * a reply author may edit their own reply for 15 minutes; the thread starter likewise for the first message
--   * resolve / reopen: thread starter, anyone mentioned in the thread, or Admin
--   * no hard deletes; Admin can hide (soft delete) a thread or reply
--   * @mentions are cleaned (only active staff who can open the record) and notified; replies notify participants

create table if not exists public.thread (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.lead (id) on delete cascade,
  candidate_id uuid references public.candidate (id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 2000),
  mentioned uuid[] not null default '{}',
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by uuid references public.staff (id) on delete set null,
  resolved_at timestamptz,
  created_by uuid not null default auth.uid() references public.staff (id),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  check ((lead_id is null) <> (candidate_id is null))
);
create index if not exists thread_lead_idx on public.thread (lead_id) where lead_id is not null;
create index if not exists thread_candidate_idx on public.thread (candidate_id) where candidate_id is not null;
create index if not exists thread_mentioned_idx on public.thread using gin (mentioned);

create table if not exists public.thread_reply (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.thread (id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 2000),
  mentioned uuid[] not null default '{}',
  created_by uuid not null default auth.uid() references public.staff (id),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create index if not exists thread_reply_thread_idx on public.thread_reply (thread_id, created_at);

-- Can the signed-in user open this lead / candidate? (runs as the caller, so the record's RLS applies)
create or replace function public.thread_record_visible(p_lead uuid, p_cand uuid) returns boolean
language sql stable security invoker set search_path = public as $$
  select case
    when p_lead is not null then public.can_page('lead', 'r') and exists (select 1 from public.lead where id = p_lead)
    when p_cand is not null then public.can_page('candidate', 'r') and exists (select 1 from public.candidate where id = p_cand)
    else false end
$$;
grant execute on function public.thread_record_visible(uuid, uuid) to authenticated;

-- Thread starter, anyone mentioned in it, or Admin
create or replace function public.thread_is_participant(p_thread uuid, sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.thread t where t.id = p_thread and (t.created_by = sid or sid = any (t.mentioned)))
      or exists (select 1 from public.thread_reply r where r.thread_id = p_thread and sid = any (r.mentioned))
$$;
revoke execute on function public.thread_is_participant(uuid, uuid) from public, anon;
grant execute on function public.thread_is_participant(uuid, uuid) to authenticated;

alter table public.thread enable row level security;
alter table public.thread_reply enable row level security;
revoke all on public.thread, public.thread_reply from anon;
grant select, insert, update on public.thread, public.thread_reply to authenticated;
revoke delete on public.thread, public.thread_reply from authenticated;

drop policy if exists thread_read on public.thread;
create policy thread_read on public.thread for select to authenticated
  using ((deleted_at is null or public.is_admin()) and public.thread_record_visible(lead_id, candidate_id));
drop policy if exists thread_ins on public.thread;
create policy thread_ins on public.thread for insert to authenticated
  with check (created_by = auth.uid() and status = 'open' and deleted_at is null and public.thread_record_visible(lead_id, candidate_id));
drop policy if exists thread_upd on public.thread;
create policy thread_upd on public.thread for update to authenticated
  using (public.thread_record_visible(lead_id, candidate_id) and (public.is_admin() or public.thread_is_participant(id, auth.uid())))
  with check (public.thread_record_visible(lead_id, candidate_id));

drop policy if exists thread_reply_read on public.thread_reply;
create policy thread_reply_read on public.thread_reply for select to authenticated
  using ((deleted_at is null or public.is_admin()) and exists (select 1 from public.thread t where t.id = thread_id));
drop policy if exists thread_reply_ins on public.thread_reply;
create policy thread_reply_ins on public.thread_reply for insert to authenticated
  with check (created_by = auth.uid() and deleted_at is null and exists (select 1 from public.thread t where t.id = thread_id and t.deleted_at is null));
drop policy if exists thread_reply_upd on public.thread_reply;
create policy thread_reply_upd on public.thread_reply for update to authenticated
  using ((created_by = auth.uid() or public.is_admin()) and exists (select 1 from public.thread t where t.id = thread_id))
  with check (exists (select 1 from public.thread t where t.id = thread_id));

-- Column rules on update (who may change what). auth.uid() is null for service scripts: allowed.
create or replace function public.thread_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); adm boolean := public.is_admin();
begin
  if me is null then return new; end if;
  if new.id <> old.id or new.created_by <> old.created_by or new.created_at <> old.created_at
     or new.lead_id is distinct from old.lead_id or new.candidate_id is distinct from old.candidate_id then
    raise exception 'These details cannot be changed';
  end if;
  if new.body <> old.body or new.mentioned <> old.mentioned then
    if old.created_by <> me or old.created_at < now() - interval '15 minutes' then
      raise exception 'Messages can be edited by their author for 15 minutes only';
    end if;
    new.edited_at := now();
  end if;
  if new.deleted_at is distinct from old.deleted_at and not adm then
    raise exception 'Only an Admin can remove a discussion';
  end if;
  if new.status <> old.status then
    if not (adm or public.thread_is_participant(old.id, me)) then
      raise exception 'Only the starter, people mentioned, or an Admin can resolve or reopen';
    end if;
    if new.status = 'resolved' then new.resolved_by := me; new.resolved_at := now();
    else new.resolved_by := null; new.resolved_at := null; end if;
  elsif new.resolved_by is distinct from old.resolved_by or new.resolved_at is distinct from old.resolved_at then
    raise exception 'These details cannot be changed';
  end if;
  return new;
end $$;
drop trigger if exists thread_guard on public.thread;
create trigger thread_guard before update on public.thread for each row execute function public.thread_guard();

create or replace function public.thread_reply_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then return new; end if;
  if new.id <> old.id or new.thread_id <> old.thread_id or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'These details cannot be changed';
  end if;
  if new.body <> old.body or new.mentioned <> old.mentioned then
    if old.created_by <> me or old.created_at < now() - interval '15 minutes' then
      raise exception 'Messages can be edited by their author for 15 minutes only';
    end if;
    new.edited_at := now();
  end if;
  if new.deleted_at is distinct from old.deleted_at and not public.is_admin() then
    raise exception 'Only an Admin can remove a reply';
  end if;
  return new;
end $$;
drop trigger if exists thread_reply_guard on public.thread_reply;
create trigger thread_reply_guard before update on public.thread_reply for each row execute function public.thread_reply_guard();

-- Mention cleaning (same rule as notes, migration 055): active staff who can open the record, not the author
create or replace function public.thread_mentions_clean() returns trigger
language plpgsql security definer set search_path = public as $$
declare pg text; lid uuid; cid uuid;
begin
  if tg_table_name = 'thread' then lid := new.lead_id; cid := new.candidate_id;
  else select t.lead_id, t.candidate_id into lid, cid from public.thread t where t.id = new.thread_id; end if;
  pg := case when lid is not null then 'lead' else 'candidate' end;
  new.mentioned := coalesce((
    select array_agg(distinct m) from unnest(coalesce(new.mentioned, '{}')) m
    where m is distinct from new.created_by and public.staff_can_page(m, pg, 'r')
  ), '{}');
  return new;
end $$;
drop trigger if exists thread_mentions_clean on public.thread;
create trigger thread_mentions_clean before insert or update of mentioned on public.thread for each row execute function public.thread_mentions_clean();
drop trigger if exists thread_reply_mentions_clean on public.thread_reply;
create trigger thread_reply_mentions_clean before insert or update of mentioned on public.thread_reply for each row execute function public.thread_mentions_clean();

-- Notifications: new mentions get "mentioned you in a discussion"; other participants get "replied"
create or replace function public.thread_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare t public.thread; person text; author text; pg text;
        prev uuid[] := case when tg_op = 'UPDATE' then coalesce(old.mentioned, '{}') else '{}' end;
begin
  if tg_table_name = 'thread' then t := new; else select * into t from public.thread where id = new.thread_id; end if;
  pg := case when t.lead_id is not null then 'lead' else 'candidate' end;
  select coalesce((select full_name from lead where id = t.lead_id), (select full_name from candidate where id = t.candidate_id)) into person;
  select full_name into author from staff where id = new.created_by;
  insert into notification (staff_id, kind, title, body, link, from_id)
  select distinct m, 'mention', coalesce(author, 'Someone') || ' mentioned you in a discussion on ' || coalesce(person, 'a record'),
         left(new.body, 280), person_link(t.lead_id, t.candidate_id), new.created_by
  from unnest(new.mentioned) m
  where m is distinct from new.created_by and not (m = any (prev)) and public.staff_can_page(m, pg, 'r');
  if tg_table_name = 'thread_reply' and tg_op = 'INSERT' then
    insert into notification (staff_id, kind, title, body, link, from_id)
    select distinct p, 'thread', coalesce(author, 'Someone') || ' replied in a discussion on ' || coalesce(person, 'a record'),
           left(new.body, 280), person_link(t.lead_id, t.candidate_id), new.created_by
    from (
      select t.created_by as p union select unnest(t.mentioned)
      union select r.created_by from thread_reply r where r.thread_id = t.id and r.id <> new.id
      union select unnest(r.mentioned) from thread_reply r where r.thread_id = t.id and r.id <> new.id
    ) x
    where p is distinct from new.created_by and not (p = any (new.mentioned)) and public.staff_can_page(p, pg, 'r');
  end if;
  return new;
end $$;
drop trigger if exists thread_notify on public.thread;
create trigger thread_notify after insert or update of mentioned on public.thread for each row execute function public.thread_notify();
drop trigger if exists thread_reply_notify on public.thread_reply;
create trigger thread_reply_notify after insert or update of mentioned on public.thread_reply for each row execute function public.thread_notify();

-- Readable list for the screens (security_invoker: row security of thread / reply / staff applies)
create or replace view public.thread_feed with (security_invoker = true) as
  select t.*, s.full_name as by_name, rs.full_name as resolved_by_name,
         (select count(*) from public.thread_reply r where r.thread_id = t.id and r.deleted_at is null) as replies,
         (auth.uid() = any (t.mentioned) or exists (select 1 from public.thread_reply r where r.thread_id = t.id and auth.uid() = any (r.mentioned))) as mentions_me
  from public.thread t
  left join public.staff s on s.id = t.created_by
  left join public.staff rs on rs.id = t.resolved_by;
grant select on public.thread_feed to authenticated;

-- Audit trail (058): attach the same trigger to the new tables
do $$
declare t text;
begin
  foreach t in array array['thread', 'thread_reply'] loop
    execute format('drop trigger if exists zz_audit on public.%I', t);
    execute format('create trigger zz_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- Trigger functions are never called directly
revoke all on function public.thread_guard(), public.thread_reply_guard(), public.thread_mentions_clean(), public.thread_notify() from public, anon, authenticated;
