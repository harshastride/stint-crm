-- The lead list view was built in migration 047 from the lead columns that existed then, so columns added later
-- (lost_reason from 073, referrer_kind / referrer_id from 085) were missing: the edit form could not show a saved
-- "Reason not interested". Rebuild it with every lead column staff may read (never mobile or email), in table order,
-- so existing columns keep their place and new ones are added at the end. Row security of lead still applies.
-- Safe to re-run; run again whenever a readable column is added to lead.
do $$
declare cols text;
begin
  select string_agg('l.' || quote_ident(c.column_name), ', ' order by c.ordinal_position) into cols
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'lead' and c.column_name not in ('mobile', 'email')
    and has_column_privilege('authenticated', 'public.lead', c.column_name, 'select');
  execute format('create or replace view public.lead_list with (security_invoker = true) as select %s from public.lead l', cols);
end $$;
grant select on public.lead_list to authenticated, service_role;
