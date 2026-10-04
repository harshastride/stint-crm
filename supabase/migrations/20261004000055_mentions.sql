-- @mentions picked from the staff list are stored on the note (mentioned uuid[]).
-- A database trigger notifies them, so it cannot be skipped, and only staff who
-- can open that person's page (lead or candidate) are kept and notified.

alter table public.note add column if not exists mentioned uuid[] not null default '{}';

-- Same rule as can_page(), but for any staff member (not just the signed-in one)
create or replace function public.staff_can_page(sid uuid, p text, need text default 'r') returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff s
    where s.id = sid and s.status = 'Active'
      and (s.role = 'Admin' or exists (
        select 1 from public.role_page_access a
        where a.role = s.role and a.page_id = p and (need = 'r' or a.mode = 'w')))
  )
$$;
revoke execute on function public.staff_can_page(uuid, text, text) from anon, public;

-- Before saving: keep only real, active staff who can read the record (and not the author)
create or replace function public.note_mentions_clean() returns trigger
language plpgsql security definer set search_path = public as $$
declare pg text := case when new.lead_id is not null then 'lead' else 'candidate' end;
begin
  new.mentioned := coalesce((
    select array_agg(distinct m) from unnest(coalesce(new.mentioned, '{}')) m
    where m is distinct from new.by_id and public.staff_can_page(m, pg, 'r')
  ), '{}');
  return new;
end $$;
drop trigger if exists note_mentions_clean on public.note;
create trigger note_mentions_clean before insert or update of mentioned, lead_id, candidate_id on public.note
  for each row execute function public.note_mentions_clean();

-- After saving: one notification per mentioned person (picked chips + typed @FirstName), page access checked
create or replace function public.note_mentions() returns trigger
language plpgsql security definer set search_path = public as $$
declare person text; author text; pg text := case when new.lead_id is not null then 'lead' else 'candidate' end;
        prev uuid[] := case when tg_op = 'UPDATE' then coalesce(old.mentioned, '{}') else '{}' end;
begin
  select coalesce((select full_name from lead where id = new.lead_id), (select full_name from candidate where id = new.candidate_id)) into person;
  select full_name into author from staff where id = new.by_id;
  insert into notification (staff_id, kind, title, body, link, from_id)
  select distinct w.sid, 'mention', coalesce(author, 'Someone') || ' mentioned you on ' || coalesce(person, 'a record'), left(new.body, 280),
         person_link(new.lead_id, new.candidate_id), new.by_id
  from (
    select unnest(new.mentioned) as sid
    union
    select s.id from regexp_matches(new.body, '@([A-Za-z][A-Za-z.]*)', 'g') m(g)
    join staff s on s.status = 'Active' and (lower(split_part(s.full_name, ' ', 1)) = lower(m.g[1]) or lower(replace(s.full_name, ' ', '')) = lower(m.g[1]))
    where tg_op = 'INSERT'
  ) w
  where w.sid is distinct from new.by_id
    and not (w.sid = any (prev))
    and public.staff_can_page(w.sid, pg, 'r');
  return new;
end $$;
drop trigger if exists note_mentions on public.note;
create trigger note_mentions after insert or update of mentioned on public.note for each row execute function public.note_mentions();
