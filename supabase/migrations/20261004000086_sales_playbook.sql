-- Sales playbook: the facts, selling points and approved answers that Live help may use during a call.
-- Claude only suggests what is written here (plus what the lead said), so no fees, offers or placement
-- numbers are ever invented. Admin writes it; telecallers and sales can read it.

insert into public.page (id, grp, title, sort) values ('playbook', 'Sales', 'Sales playbook', 12)
on conflict (id) do nothing;
insert into public.role_page_access (role, page_id, mode) values ('Telecaller', 'playbook', 'r'), ('Sales', 'playbook', 'r')
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
