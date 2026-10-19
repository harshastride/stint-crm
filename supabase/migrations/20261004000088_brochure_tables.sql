-- Course brochures with open tracking: the tables only (logic, storage and alerts are in migration 089).
-- A brochure is a course PDF. Sending it to a lead creates a private link (brochure_send.token); every view of that
-- link is recorded (brochure_view) so the telecaller knows who is reading, which page, and for how long.

insert into public.page (id, grp, title, sort) values ('brochures', 'Sales', 'Brochures', 13)
on conflict (id) do nothing;
select public.page_place('brochures', 'playbook');   -- after Sales playbook (migration 086)
-- Grants for roles that exist (a fresh database gets them from seed.sql)
insert into public.role_page_access (role, page_id, mode)
select name, 'brochures', 'r' from public.app_role where name in ('Telecaller', 'Sales', 'Front desk', 'Marketing')
on conflict do nothing;

create table if not exists public.brochure (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references public.program (id) on delete set null,   -- empty = for every course
  title text not null check (length(trim(title)) > 0),
  file_path text,                                                      -- PDF in the private "brochures" storage bucket
  status text not null default 'Live' check (status in ('Live', 'Off')),
  created_by uuid references public.staff (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.brochure_send (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  brochure_id uuid not null references public.brochure (id) on delete cascade,
  lead_id uuid not null references public.lead (id) on delete cascade,
  sent_by uuid references public.staff (id) on delete set null default auth.uid(),
  intro jsonb,                              -- the personal first page written for this lead
  sent_at timestamptz not null default now(),
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  open_count int not null default 0,
  total_seconds int not null default 0
);
create index if not exists brochure_send_lead_idx on public.brochure_send (lead_id, sent_at desc);

create table if not exists public.brochure_view (
  id bigserial primary key,
  send_id uuid not null references public.brochure_send (id) on delete cascade,
  lead_id uuid not null references public.lead (id) on delete cascade,
  opened_at timestamptz not null default now(),
  page int not null default 1,
  seconds int not null default 0 check (seconds between 0 and 3600)
);
create index if not exists brochure_view_lead_idx on public.brochure_view (lead_id, opened_at desc);

alter table public.brochure enable row level security;
alter table public.brochure_send enable row level security;
alter table public.brochure_view enable row level security;
revoke all on public.brochure, public.brochure_send, public.brochure_view from anon;

drop policy if exists brochure_read on public.brochure;
create policy brochure_read on public.brochure for select to authenticated using (public.can_page('brochures', 'r'));
drop policy if exists brochure_write on public.brochure;
create policy brochure_write on public.brochure for all to authenticated using (public.can_page('brochures', 'w')) with check (public.can_page('brochures', 'w'));

-- Sends and views: visible with the lead (same rule as the lead itself); sends are created by the server
drop policy if exists brochure_send_read on public.brochure_send;
create policy brochure_send_read on public.brochure_send for select to authenticated
  using (exists (select 1 from public.lead_list l where l.id = brochure_send.lead_id));
drop policy if exists brochure_view_read on public.brochure_view;
create policy brochure_view_read on public.brochure_view for select to authenticated
  using (exists (select 1 from public.lead_list l where l.id = brochure_view.lead_id));
revoke insert, update, delete on public.brochure_send, public.brochure_view from authenticated;
revoke usage on sequence public.brochure_view_id_seq from authenticated, anon;

drop trigger if exists zz_audit on public.brochure;
create trigger zz_audit after insert or update or delete on public.brochure for each row execute function public.audit_row();
drop trigger if exists aa_bin on public.brochure;
create trigger aa_bin before delete on public.brochure for each row execute function public.bin_row();
