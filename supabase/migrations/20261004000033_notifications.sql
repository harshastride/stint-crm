-- In-app notifications: @mentions in notes, and follow-ups someone else gives you.
create table public.notification (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id) on delete cascade,
  kind text not null default 'mention',
  title text not null,
  body text,
  link text,
  from_id uuid references public.staff (id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notification_staff_idx on public.notification (staff_id, created_at desc);
alter table public.notification enable row level security;
create policy notification_own on public.notification for select to authenticated using (staff_id = auth.uid());
create policy notification_read on public.notification for update to authenticated using (staff_id = auth.uid()) with check (staff_id = auth.uid());
create policy notification_del on public.notification for delete to authenticated using (staff_id = auth.uid());
grant select, update, delete on public.notification to authenticated;

create or replace function public.person_link(lid uuid, cid uuid) returns text language sql immutable as $$
  select case when lid is not null then '/p/lead?person=lead:' || lid when cid is not null then '/p/candidate?person=candidate:' || cid end
$$;

-- @Name in a note: notify every active staff member whose first name (or full name without spaces) matches
create or replace function public.note_mentions() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; person text; author text;
begin
  select coalesce((select full_name from lead where id = new.lead_id), (select full_name from candidate where id = new.candidate_id)) into person;
  select full_name into author from staff where id = new.by_id;
  insert into notification (staff_id, kind, title, body, link, from_id)
  select distinct s.id, 'mention', coalesce(author, 'Someone') || ' mentioned you on ' || coalesce(person, 'a record'), left(new.body, 280),
         person_link(new.lead_id, new.candidate_id), new.by_id
  from regexp_matches(new.body, '@([A-Za-z][A-Za-z.]*)', 'g') m(g)
  join staff s on s.status = 'Active' and (lower(split_part(s.full_name, ' ', 1)) = lower(m.g[1]) or lower(replace(s.full_name, ' ', '')) = lower(m.g[1]))
  where s.id is distinct from new.by_id;
  return new;
end $$;
create trigger note_mentions after insert on public.note for each row execute function public.note_mentions();

-- A follow-up given to someone by someone else
create or replace function public.follow_up_assigned() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is not null and new.owner_id is distinct from auth.uid()
     and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id) and new.status = 'Open' then
    insert into notification (staff_id, kind, title, body, link, from_id)
    values (new.owner_id, 'follow_up', 'New follow-up for you: ' || new.title,
            coalesce((select full_name from lead where id = new.lead_id), (select full_name from candidate where id = new.candidate_id)),
            coalesce(person_link(new.lead_id, new.candidate_id), '/p/followups'), auth.uid());
  end if;
  return new;
end $$;
create trigger follow_up_assigned after insert or update of owner_id on public.follow_up for each row execute function public.follow_up_assigned();
