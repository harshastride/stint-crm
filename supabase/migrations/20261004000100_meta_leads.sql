-- Meta lead forms, connected directly (no Activepieces): Admin saves the Meta app once, presses "Connect Facebook",
-- picks the page; Meta then sends every new lead to /api/meta/webhook. The CRM fetches the answers from Meta and
-- saves the lead through the same door as other incoming leads (dedupe, source, campaign, assignment, custom fields).
-- Secrets (app secret, page tokens) are never readable from the browser: column grants leave them out and only the
-- server (service role) uses them. The lead log keeps Meta ids only, never the person's answers.

insert into public.page (id, grp, title, sort) values ('meta', 'Admin settings', 'Meta lead forms', 44)
on conflict (id) do nothing;   -- Admin only (no grants: Admin sees all pages)

-- 1. The Meta app (one row)
create table if not exists public.meta_app (
  id int primary key default 1 check (id = 1),
  app_id text,
  app_secret text,                                   -- never granted to the browser
  login_config_id text,                              -- "Facebook Login for Business" configuration id, if the app uses one
  verify_token text not null default encode(extensions.gen_random_bytes(18), 'hex'),
  graph_version text not null default 'v25.0',
  webhook_ok boolean not null default false,
  webhook_error text,
  updated_at timestamptz not null default now()
);
insert into public.meta_app (id) values (1) on conflict (id) do nothing;

-- 2. Pages the Admin connected
create table if not exists public.meta_page (
  page_id text primary key,
  name text not null,
  access_token text,                                 -- page token; never granted to the browser
  receiving boolean not null default false,          -- subscribed to new leads
  connected_by uuid references public.staff (id) on delete set null,
  connected_at timestamptz not null default now(),
  last_error text,
  last_lead_at timestamptz
);

-- 3. Lead forms on those pages, with their questions
create table if not exists public.meta_form (
  form_id text primary key,
  page_id text not null references public.meta_page (page_id) on delete cascade,
  name text not null,
  status text,
  questions jsonb not null default '[]'::jsonb,      -- [{ key, label, type, options }]
  active boolean not null default true,              -- false = leads from this form are skipped
  course text,                                       -- optional: every lead from this form is for this course
  last_lead_at timestamptz,
  synced_at timestamptz not null default now()
);

-- 4. Where each form question goes: 'course', 'city', 'custom:<key>', 'notes' or 'ignore'
create table if not exists public.meta_field_map (
  form_id text not null references public.meta_form (form_id) on delete cascade,
  meta_key text not null,
  target text not null check (target in ('course', 'city', 'notes', 'ignore') or target like 'custom:%'),
  primary key (form_id, meta_key)
);

-- 5. Every lead Meta told us about (ids only), and what happened to it
create table if not exists public.meta_lead (
  leadgen_id text primary key,
  page_id text,
  form_id text,
  ad_id text,
  status text not null default 'Pending' check (status in ('Pending', 'Working', 'Done', 'Duplicate', 'Skipped', 'Failed')),
  attempts int not null default 0,
  next_try_at timestamptz not null default now(),
  lead_id uuid references public.lead (id) on delete set null,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists meta_lead_due_idx on public.meta_lead (status, next_try_at);
create index if not exists meta_lead_received_idx on public.meta_lead (received_at desc);

-- 6. Row security: only whoever may open "Meta lead forms" (Admin by default). Writes go through the server, except
--    the question mapping and the form switches, which the page edits directly.
alter table public.meta_app enable row level security;
alter table public.meta_page enable row level security;
alter table public.meta_form enable row level security;
alter table public.meta_field_map enable row level security;
alter table public.meta_lead enable row level security;
revoke all on public.meta_app, public.meta_page, public.meta_form, public.meta_field_map, public.meta_lead from public, anon, authenticated;

grant select (id, app_id, login_config_id, graph_version, webhook_ok, webhook_error, updated_at) on public.meta_app to authenticated;
drop policy if exists meta_app_read on public.meta_app;
create policy meta_app_read on public.meta_app for select to authenticated using (public.can_page('meta', 'r'));

grant select (page_id, name, receiving, connected_by, connected_at, last_error, last_lead_at) on public.meta_page to authenticated;
drop policy if exists meta_page_read on public.meta_page;
create policy meta_page_read on public.meta_page for select to authenticated using (public.can_page('meta', 'r'));

grant select on public.meta_form to authenticated;
grant update (active, course) on public.meta_form to authenticated;
drop policy if exists meta_form_read on public.meta_form;
create policy meta_form_read on public.meta_form for select to authenticated using (public.can_page('meta', 'r'));
drop policy if exists meta_form_edit on public.meta_form;
create policy meta_form_edit on public.meta_form for update to authenticated using (public.can_page('meta', 'w')) with check (public.can_page('meta', 'w'));

grant select, insert, update, delete on public.meta_field_map to authenticated;
drop policy if exists meta_field_map_rw on public.meta_field_map;
create policy meta_field_map_rw on public.meta_field_map for all to authenticated using (public.can_page('meta', 'w')) with check (public.can_page('meta', 'w'));
drop policy if exists meta_field_map_read on public.meta_field_map;
create policy meta_field_map_read on public.meta_field_map for select to authenticated using (public.can_page('meta', 'r'));

grant select on public.meta_lead to authenticated;
grant update (status, attempts, next_try_at, last_error) on public.meta_lead to authenticated;   -- Retry from the log
drop policy if exists meta_lead_read on public.meta_lead;
create policy meta_lead_read on public.meta_lead for select to authenticated using (public.can_page('meta', 'r'));
drop policy if exists meta_lead_retry on public.meta_lead;
create policy meta_lead_retry on public.meta_lead for update to authenticated using (public.can_page('meta', 'w')) with check (public.can_page('meta', 'w'));

-- 7. Audit trail for the settings ("secret" and "token" columns are masked in the audit log). Recycle bin for forms and
--    mappings only: the bin keeps whole rows and Admin can read it, so the app secret and page tokens must never go there
--    (a removed page is simply connected again).
do $$
declare t text;
begin
  foreach t in array array['meta_app', 'meta_page', 'meta_form', 'meta_field_map'] loop
    execute format('drop trigger if exists zz_audit on public.%I', t);
    execute format('create trigger zz_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
  foreach t in array array['meta_form', 'meta_field_map'] loop
    execute format('drop trigger if exists aa_bin on public.%I', t);
    execute format('create trigger aa_bin before delete on public.%I for each row execute function public.bin_row()', t);
  end loop;
end $$;

-- 8. Every minute, if a Meta lead is waiting (or stuck), ask the app to fetch and save it (same pattern as Teams)
create or replace function public.call_meta_processor() returns bigint
language sql security definer set search_path = public, extensions as $$
  select net.http_post(
    url := (select value from public.integration_config where key = 'app_url') || '/api/meta/process',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.integration_config where key = 'cron_secret')))
  where exists (select 1 from public.meta_lead where status = 'Pending' and next_try_at <= now())
     or exists (select 1 from public.meta_lead where status = 'Working' and next_try_at < now() - interval '5 minutes')
$$;
revoke all on function public.call_meta_processor() from public, anon, authenticated;
do $$
begin
  perform cron.unschedule('meta-leads') where exists (select 1 from cron.job where jobname = 'meta-leads');
  perform cron.schedule('meta-leads', '* * * * *', 'select public.call_meta_processor()');
exception when others then raise notice 'pg_cron not available: %', sqlerrm;
end $$;
