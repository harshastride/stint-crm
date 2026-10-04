-- Stint CRM · core: staff, roles, page access, dropdowns, settings
create extension if not exists pgcrypto;

create table public.app_role (
  name text primary key,
  sort int not null default 0
);

create table public.branch (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  city text,
  mode text not null default 'Hybrid',
  manager_id uuid,
  created_at timestamptz not null default now()
);

create table public.staff (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null unique,
  role text not null references public.app_role (name) on update cascade,
  level text not null default 'Junior' check (level in ('Junior', 'Head')),
  branch_id uuid references public.branch (id),
  status text not null default 'Active' check (status in ('Active', 'Invited', 'Disabled')),
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.branch add constraint branch_manager_fk foreign key (manager_id) references public.staff (id) on delete set null;

create table public.page (
  id text primary key,
  grp text not null,
  title text not null,
  sort int not null default 0
);

create table public.role_page_access (
  role text not null references public.app_role (name) on update cascade on delete cascade,
  page_id text not null references public.page (id) on delete cascade,
  mode text not null check (mode in ('r', 'w')),
  primary key (role, page_id)
);

-- Sensitive detail groups on a candidate: f = full, m = masked, h = hidden
create table public.role_field_access (
  role text not null references public.app_role (name) on update cascade on delete cascade,
  field_group text not null check (field_group in ('contact', 'family', 'identity', 'bank')),
  mode text not null check (mode in ('f', 'm', 'h')),
  primary key (role, field_group)
);

create table public.dropdown_list (
  id text primary key,
  name text not null,
  used_on text,
  updated_by uuid references public.staff (id),
  updated_at timestamptz not null default now()
);

create table public.dropdown_value (
  id uuid primary key default gen_random_uuid(),
  list_id text not null references public.dropdown_list (id) on delete cascade,
  value text not null,
  sort int not null default 0,
  active boolean not null default true,
  locked boolean not null default false,
  unique (list_id, value)
);

create table public.setting (
  key text primary key,
  value text,
  updated_by uuid references public.staff (id),
  updated_at timestamptz not null default now()
);

-- Who am I, and what may I open?  (security definer so policies can call them)
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.staff where id = auth.uid() and status = 'Active'
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'Admin', false)
$$;

create or replace function public.can_page(p text, need text default 'r') returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.my_role() is null then false
    when public.my_role() = 'Admin' then true
    else exists (
      select 1 from public.role_page_access a
      where a.role = public.my_role() and a.page_id = p and (need = 'r' or a.mode = 'w')
    )
  end
$$;

create or replace function public.field_mode(g text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when public.my_role() is null then 'h'
    when public.my_role() = 'Admin' then 'f'
    else coalesce((select mode from public.role_field_access where role = public.my_role() and field_group = g), 'h')
  end
$$;

-- Everything the app shell needs in one call
create or replace function public.my_session() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'staff', (select to_jsonb(s) from public.staff s where s.id = auth.uid()),
    'pages', (
      select coalesce(jsonb_object_agg(p.id, case when public.my_role() = 'Admin' then 'w' else a.mode end), '{}'::jsonb)
      from public.page p
      left join public.role_page_access a on a.page_id = p.id and a.role = public.my_role()
      where public.my_role() = 'Admin' or a.mode is not null
    ),
    'fields', (
      select jsonb_object_agg(g, public.field_mode(g))
      from unnest(array['contact', 'family', 'identity', 'bank']) g
    )
  )
$$;
