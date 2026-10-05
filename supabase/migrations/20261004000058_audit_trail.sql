-- Audit trail: every insert/update/delete on business tables is written to audit_log.
-- audit_log can never be updated or deleted by anyone (revoke + RLS + trigger); only the
-- retention job (audit_purge, 2 years) removes old rows. Admin reads it via page 'audit'.

create table if not exists public.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid,                       -- auth.uid(); null = system (cron, service, migration)
  actor_role text,                  -- role name, or 'system'
  table_name text not null,
  row_id text,                      -- primary key value (uuid for most tables; text key for a few)
  row_label text,                   -- readable name of the row (full_name / name / title) at the time
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  changed jsonb not null default '{}'::jsonb,   -- {col: {old, new}}; sensitive columns show '[changed]'
  ip text,
  user_agent text
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_row_idx on public.audit_log (table_name, row_id);
create index if not exists audit_log_actor_idx on public.audit_log (actor, at desc);

-- page + Admin read (Admin sees every page anyway; the row makes it appear in the sidebar)
insert into public.page (id, grp, title, sort) values ('audit', 'Admin settings', 'Audit log', 46) on conflict (id) do nothing;

alter table public.audit_log enable row level security;
revoke all on public.audit_log from public, anon, authenticated;
grant select on public.audit_log to authenticated;
revoke usage on sequence public.audit_log_id_seq from public, anon, authenticated;
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log for select to authenticated using (public.is_admin() and public.can_page('audit', 'r'));
-- no insert/update/delete policies: only the definer trigger writes

-- Is a column sensitive? Values are replaced by '[changed]'.
create or replace function public.audit_is_sensitive(p_table text, p_col text) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select (p_table = 'candidate_private' and p_col in ('contact','family','identity','bank'))
      or p_col ~* '(mobile|phone|email|password|passwd|secret|token|api_?key|otp|pin_hash|aadhaar|pan_no|account_no|ifsc)'
      or (p_table in ('integration_config','setting') and p_col in ('value','config','secret','headers'))
$$;

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  diff jsonb := '{}'::jsonb;
  k text;
  hdr jsonb;
  uid uuid := auth.uid();
begin
  for k in select jsonb_object_keys(coalesce(n, o)) loop
    if tg_op = 'UPDATE' and (o -> k) is not distinct from (n -> k) then continue; end if;
    if k in ('updated_at', 'mobile_masked', 'email_masked') and tg_op = 'UPDATE' then continue; end if;
    if public.audit_is_sensitive(tg_table_name, k) then
      diff := diff || jsonb_build_object(k, jsonb_build_object('old', case when o is null then null else to_jsonb('[changed]'::text) end,
                                                                 'new', case when n is null then null else to_jsonb('[changed]'::text) end));
    else
      diff := diff || jsonb_build_object(k, jsonb_build_object('old', o -> k, 'new', n -> k));
    end if;
  end loop;
  if tg_op = 'UPDATE' and diff = '{}'::jsonb then return null; end if;
  begin hdr := nullif(current_setting('request.headers', true), '')::jsonb; exception when others then hdr := null; end;
  insert into public.audit_log (actor, actor_role, table_name, row_id, row_label, action, changed, ip, user_agent)
  values (uid, coalesce(case when uid is not null then public.my_role() end, 'system'), tg_table_name,
          coalesce(r ->> 'id', r ->> 'candidate_id', r ->> 'key', r ->> 'name', r ->> 'page_id'),
          left(coalesce(r ->> 'full_name', r ->> 'name', r ->> 'title', r ->> 'subject'), 120),
          tg_op, diff,
          nullif(trim(split_part(coalesce(hdr ->> 'x-forwarded-for', hdr ->> 'x-real-ip', ''), ',', 1)), ''),
          left(hdr ->> 'user-agent', 300));
  return null;
end $$;
revoke all on function public.audit_row() from public, anon, authenticated;

-- audit_log is append-only: block update/delete/truncate for everyone, except the retention purge
create or replace function public.audit_log_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' and current_setting('stint.audit_purge', true) = 'on' and old.at < now() - interval '2 years' then
    return old;
  end if;
  raise exception 'audit_log is append-only';
end $$;
drop trigger if exists audit_log_no_change on public.audit_log;
create trigger audit_log_no_change before update or delete on public.audit_log for each row execute function public.audit_log_guard();
drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate before truncate on public.audit_log for each statement execute function public.audit_log_guard();

create or replace function public.audit_purge() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  perform set_config('stint.audit_purge', 'on', true);
  delete from public.audit_log where at < now() - interval '2 years';
  get diagnostics n = row_count;
  perform set_config('stint.audit_purge', 'off', true);
  return n;
end $$;
revoke all on function public.audit_purge() from public, anon, authenticated;

select cron.unschedule('audit-retention') where exists (select 1 from cron.job where jobname = 'audit-retention');
select cron.schedule('audit-retention', '0 22 * * *', 'select public.audit_purge()');  -- 03:30 IST

-- Attach to every public business table except logs / high-volume tables
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind = 'r'
             and c.relname not in ('audit_log','data_access_log','viewing','notification','student_notification',
                                   'integration_event','status_history','alert','import_run','message','session','sessions')
  loop
    execute format('drop trigger if exists zz_audit on public.%I', t);
    execute format('create trigger zz_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- Readable feed for the Audit log page (Admin only through audit_log RLS)
create or replace view public.audit_feed with (security_invoker = true) as
  select a.*, s.full_name as actor_name
  from public.audit_log a left join public.staff s on s.id = a.actor;
grant select on public.audit_feed to authenticated;
