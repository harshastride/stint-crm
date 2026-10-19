-- Sales playbook: the facts, selling points and approved answers that Live help may use during a call.
-- Claude only suggests what is written here (plus what the lead said), so no fees, offers or placement
-- numbers are ever invented. Admin writes it; telecallers and sales can read it.

-- Sidebar placement for the pages added by migrations 086-097 (also called by seed.sql, so a fresh database and an
-- upgraded one end in the same order). Puts page p_id right after (or right before) page p_anchor and moves the pages
-- behind it down by one. Does nothing when it is already there, or before seed.sql has created the standard pages
-- (fresh database: seed.sql calls it again once they exist). Not callable by signed-in users.
create or replace function public.page_place(p_id text, p_anchor text, p_after boolean default true) returns void
language plpgsql set search_path = public as $$
declare a int; s int;
begin
  if not exists (select 1 from public.page where id = 'home') then return; end if;
  select sort into a from public.page where id = p_anchor;
  select sort into s from public.page where id = p_id;
  if a is null or s is null or p_id = p_anchor then return; end if;
  if p_after then
    if s = a + 1 and not exists (select 1 from public.page where sort = a + 1 and id <> p_id) then return; end if;
    update public.page set sort = sort + 1 where sort > a and id <> p_id;
    update public.page set sort = a + 1 where id = p_id;
  else
    if s = a - 1 and not exists (select 1 from public.page where sort = s and id <> p_id) then return; end if;
    update public.page set sort = sort + 1 where sort >= a and id <> p_id;
    update public.page set sort = a where id = p_id;
  end if;
end $$;
revoke all on function public.page_place(text, text, boolean) from public, anon, authenticated;

-- Page: last under Sales (after Sales targets). Grants for roles that exist (a fresh database gets them from seed.sql).
insert into public.page (id, grp, title, sort) values ('playbook', 'Sales', 'Sales playbook', 12)
on conflict (id) do nothing;
select public.page_place('playbook', 'target');
insert into public.role_page_access (role, page_id, mode)
select name, 'playbook', 'r' from public.app_role where name in ('Telecaller', 'Sales')
on conflict do nothing;

create table if not exists public.playbook_item (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('Selling point', 'Fact we can quote', 'Doubt and answer', 'Never say')),
  program_id uuid references public.program (id) on delete cascade,   -- empty = every course
  title text not null check (length(trim(title)) > 0),                -- the point, the fact, the doubt, or what never to say
  answer text,                                                        -- for "Doubt and answer": what to say back
  status text not null default 'Live' check (status in ('Live', 'Off')),
  created_by uuid references public.staff (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (kind <> 'Doubt and answer' or length(trim(coalesce(answer, ''))) > 0)
);
create index if not exists playbook_item_program_idx on public.playbook_item (program_id);

alter table public.playbook_item enable row level security;
revoke all on public.playbook_item from anon;
drop policy if exists playbook_read on public.playbook_item;
create policy playbook_read on public.playbook_item for select to authenticated using (public.can_page('playbook', 'r'));
drop policy if exists playbook_write on public.playbook_item;
create policy playbook_write on public.playbook_item for all to authenticated using (public.can_page('playbook', 'w')) with check (public.can_page('playbook', 'w'));

drop trigger if exists zz_audit on public.playbook_item;
create trigger zz_audit after insert or update or delete on public.playbook_item for each row execute function public.audit_row();
drop trigger if exists aa_bin on public.playbook_item;
create trigger aa_bin before delete on public.playbook_item for each row execute function public.bin_row();
