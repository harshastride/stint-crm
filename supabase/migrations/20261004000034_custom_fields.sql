-- Custom fields: an admin adds fields to leads, students, placements, batches and companies from settings.
-- Values live in a `custom` jsonb column on each of those tables, keyed by the field's key.
insert into public.page (id, grp, title, sort) values ('fields', 'Admin settings', 'Custom fields', 41) on conflict (id) do nothing;

create table public.custom_field (
  id uuid primary key default gen_random_uuid(),
  page_id text not null check (page_id in ('lead', 'candidate', 'placement', 'batch', 'company')),
  label text not null check (length(trim(label)) between 1 and 60),
  key text not null,
  type text not null default 'Text' check (type in ('Text', 'Number', 'Date', 'Yes / No', 'Choice')),
  options text,               -- for Choice: comma-separated
  in_list text not null default 'No' check (in_list in ('Yes', 'No')),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (page_id, key)
);
alter table public.custom_field enable row level security;
create policy custom_field_read on public.custom_field for select to authenticated using (public.my_role() is not null);
create policy custom_field_ins on public.custom_field for insert to authenticated with check (public.can_page('fields', 'w'));
create policy custom_field_upd on public.custom_field for update to authenticated using (public.can_page('fields', 'w')) with check (public.can_page('fields', 'w'));
create policy custom_field_del on public.custom_field for delete to authenticated using (public.can_page('fields', 'w'));
grant select, insert, update, delete on public.custom_field to authenticated;

-- the key is made from the label (and kept when the label changes later, so stored values stay attached)
create or replace function public.custom_field_key() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.key is null or new.key = '' then
    new.key := coalesce(nullif(regexp_replace(lower(trim(new.label)), '[^a-z0-9]+', '_', 'g'), ''), 'field');
    new.key := trim(both '_' from new.key);
  else new.key := old.key; end if;
  return new;
end $$;
create trigger custom_field_key before insert or update on public.custom_field for each row execute function public.custom_field_key();

alter table public.lead add column custom jsonb not null default '{}'::jsonb;
alter table public.candidate add column custom jsonb not null default '{}'::jsonb;
alter table public.placement add column custom jsonb not null default '{}'::jsonb;
alter table public.batch add column custom jsonb not null default '{}'::jsonb;
alter table public.company add column custom jsonb not null default '{}'::jsonb;
