-- Data migration from the old CRM: which old record became which new one (used by the copy script and the file copy,
-- and to re-run safely). Admin-only; nobody writes it from the app. Plus tags the old CRM used as statuses.
create table if not exists public.legacy_map (
  kind text not null,              -- 'user', 'candidate', 'enquiry', 'resume', 'payment', …
  old_id text not null,
  new_id uuid not null,
  note text,
  created_at timestamptz not null default now(),
  primary key (kind, old_id)
);
alter table public.legacy_map enable row level security;
revoke all on public.legacy_map from public, anon, authenticated;
grant select on public.legacy_map to authenticated;
drop policy if exists legacy_map_read on public.legacy_map;
create policy legacy_map_read on public.legacy_map for select to authenticated using (public.is_admin());

insert into public.dropdown_value (list_id, value, sort) values ('tag', 'Dropped', 10), ('tag', 'On hold', 11), ('tag', 'Withdrawn', 12)
on conflict do nothing;
