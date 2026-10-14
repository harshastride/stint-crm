-- Recycle bin: nothing is lost when a record is deleted. Just before any business row is deleted, a full copy goes to
-- recycle_bin. Rows deleted in the same action (a student and the fees, notes … removed with them) share one group (grp),
-- so Admin can restore the whole group at once. Only Admin can see or restore. Kept for setting bin_keep_days (365).

create table if not exists public.recycle_bin (
  id bigserial primary key,
  grp bigint not null default txid_current(),     -- one delete action = one group
  table_name text not null,
  row_id text,
  row_label text,
  data jsonb not null,                            -- the full row, including private columns (Admin-only table)
  deleted_by uuid default auth.uid(),
  deleted_role text default public.my_role(),
  deleted_at timestamptz not null default now(),
  restored_at timestamptz,
  restored_by uuid
);
create index if not exists recycle_bin_grp_idx on public.recycle_bin (grp, id);
create index if not exists recycle_bin_at_idx on public.recycle_bin (deleted_at desc);

alter table public.recycle_bin enable row level security;
revoke all on public.recycle_bin from public, anon, authenticated;
grant select on public.recycle_bin to authenticated;
revoke usage on sequence public.recycle_bin_id_seq from public, anon, authenticated;
drop policy if exists recycle_bin_read on public.recycle_bin;
create policy recycle_bin_read on public.recycle_bin for select to authenticated using (public.is_admin());

insert into public.page (id, grp, title, sort) values ('recycle', 'Admin settings', 'Recycle bin', 47) on conflict (id) do nothing;
insert into public.setting (key, value) values ('bin_keep_days', '365') on conflict (key) do nothing;

-- Copy a row into the bin just before it is deleted
create or replace function public.bin_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare d jsonb := to_jsonb(old);
begin
  if current_setting('stint.no_bin', true) = 'on' then return old; end if;
  insert into recycle_bin (table_name, row_id, row_label, data)
  values (tg_table_name, coalesce(d ->> 'id', d ->> 'key', d ->> 'candidate_id'),
          left(coalesce(d ->> 'full_name', d ->> 'name', d ->> 'title', d ->> 'doc_type', d ->> 'version', d ->> 'item', d ->> 'message'), 120), d);
  return old;
end $$;
revoke execute on function public.bin_row() from public, anon, authenticated;

-- Same business tables as the audit trail (migration 064), minus logs and the bin itself
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind = 'r'
             and c.relname not in ('audit_log','data_access_log','viewing','notification','student_notification',
                                   'integration_event','status_history','alert','import_run','message','session','sessions',
                                   'login_attempt','reminder_log','recycle_bin','saved_view')
  loop
    execute format('drop trigger if exists aa_bin on public.%I', t);
    execute format('create trigger aa_bin before delete on public.%I for each row execute function public.bin_row()', t);
  end loop;
end $$;

-- What the Recycle bin page lists: one line per delete action
create or replace view public.recycle_groups with (security_invoker = true) as
select b.grp, min(b.deleted_at) as deleted_at, count(*)::int as rows,
       (array_agg(b.table_name order by b.id))[1] as table_name,
       (array_agg(b.row_label order by b.id))[1] as row_label,
       (array_agg(b.deleted_by order by b.id))[1] as deleted_by,
       (array_agg(b.deleted_role order by b.id))[1] as deleted_role,
       max(b.restored_at) as restored_at,
       coalesce(jsonb_object_agg(b.table_name, 1) filter (where b.id <> (select min(id) from recycle_bin x where x.grp = b.grp)), '{}') as also
from public.recycle_bin b group by b.grp;
grant select on public.recycle_groups to authenticated;

-- Put a whole group back, in the order it was deleted (parents before their linked rows)
create or replace function public.restore_deleted(p_grp bigint) returns int
language plpgsql security definer set search_path = public as $$
declare r record; cols text; n int := 0;
begin
  if not public.is_admin() then raise exception 'Only an admin can restore from the Recycle bin.' using errcode = '42501'; end if;
  if not exists (select 1 from recycle_bin where grp = p_grp and restored_at is null) then
    raise exception 'Nothing to restore here (already restored or no longer in the bin).' using errcode = 'P0002';
  end if;
  perform set_config('stint.system_job', 'on', true);
  for r in select * from recycle_bin where grp = p_grp and restored_at is null order by id loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
      from pg_attribute a where a.attrelid = ('public.' || quote_ident(r.table_name))::regclass
       and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
    begin
      execute format('insert into public.%I (%s) overriding system value select %s from jsonb_populate_record(null::public.%I, $1)',
                     r.table_name, cols, cols, r.table_name) using r.data;
    exception when unique_violation then
      raise exception 'Cannot restore %: a record with the same details already exists (%).', coalesce(r.row_label, r.table_name), sqlerrm using errcode = '23505';
    when foreign_key_violation then
      raise exception 'Cannot restore %: something it belongs to is gone. Restore that first.', coalesce(r.row_label, r.table_name) using errcode = '23503';
    end;
    n := n + 1;
  end loop;
  update recycle_bin set restored_at = now(), restored_by = auth.uid() where grp = p_grp and restored_at is null;
  return n;
end $$;
revoke execute on function public.restore_deleted(bigint) from public, anon;
grant execute on function public.restore_deleted(bigint) to authenticated;

-- Clear out old bin entries every night (keeps the database small)
create or replace function public.bin_purge() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from recycle_bin where deleted_at < now() - make_interval(days => public.setting_int('bin_keep_days', 365));
  get diagnostics n = row_count; return n;
end $$;
revoke execute on function public.bin_purge() from public, anon, authenticated;
select cron.unschedule('bin-purge') where exists (select 1 from cron.job where jobname = 'bin-purge');
select cron.schedule('bin-purge', '15 21 * * *', 'select public.bin_purge()');
