-- Ask the CRM: staff type a plain question and get a table plus one sentence.
-- The AI never writes SQL. It only fills a request that maps onto the report builder catalogue
-- (report_source / report_field, migration 062); the server checks every name again and then calls
-- run_report() AS THE CALLER, so row security and page rights apply exactly as in the Report builder.
-- Safe to run again.

-- 1. The page: first under Reports (right before the Lead funnel report; page_place, migration 086).
insert into public.page (id, grp, title, sort) values ('ask', 'Reports', 'Ask the CRM', 32)
on conflict (id) do update set grp = excluded.grp, title = excluded.title;
select public.page_place('ask', 'rep_funnel', false);   -- right before the Lead funnel report

-- Default access: every role that can already open a report (owner's decision 5 Oct 2026: Finance and Sales),
-- read only. Admin sees every page. More roles can be added in Roles & permissions.
insert into public.role_page_access (role, page_id, mode)
select distinct a.role, 'ask', 'r'
from public.role_page_access a join public.page p on p.id = a.page_id
where p.grp = 'Reports' and p.id not in ('ask', 'scorecard') and a.role <> 'Admin'   -- the scorecard is not a report
on conflict do nothing;
insert into public.role_page_access (role, page_id, mode)
select name, 'ask', 'r' from public.app_role where name in ('Finance', 'Sales')
on conflict do nothing;

-- 2. The catalogue is readable with the Report builder OR Ask the CRM (still only sources whose page you can open).
drop policy if exists report_source_read on public.report_source;
create policy report_source_read on public.report_source for select to authenticated
  using ((public.can_page('reports_builder') or public.can_page('ask')) and public.can_page(page_id));

-- 3. run_report: unchanged from migration 062 except the gate, which now also lets Ask the CRM users in.
--    SECURITY INVOKER: row security of the caller applies to every row read.
create or replace function public.run_report(p_def jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  src public.report_source;
  f public.report_field;
  sel text[] := '{}'; grp text[] := '{}'; whr text[] := '{}'; outs text[] := '{}';
  e jsonb; i int; expr text; alias text; agg text; bucket text; op text;
  sort_key text; sort_dir text; lim int; q text; res jsonb;
  cast_to text;
begin
  if public.my_role() is null or not (public.can_page('reports_builder') or public.can_page('ask')) then
    raise exception 'Reports are not open to your role' using errcode = '42501';
  end if;
  if jsonb_typeof(p_def) is distinct from 'object' then raise exception 'Bad report definition' using errcode = '22023'; end if;
  select * into src from public.report_source where key = p_def->>'source';
  if not found or not public.can_page(src.page_id) then
    raise exception 'Unknown report source or not open to your role' using errcode = '42501';
  end if;

  -- group by (max 2)
  if jsonb_typeof(coalesce(p_def->'group_by', '[]')) <> 'array' or jsonb_array_length(coalesce(p_def->'group_by', '[]')) > 2 then
    raise exception 'Group by up to 2 fields' using errcode = '22023';
  end if;
  for e in select * from jsonb_array_elements(coalesce(p_def->'group_by', '[]')) loop
    select * into f from public.report_field where source_key = src.key and col = e->>'field' and groupable;
    if not found then raise exception 'Field not allowed: %', left(e->>'field', 40) using errcode = '22023'; end if;
    bucket := e->>'bucket';
    if bucket is not null then
      if f.type <> 'date' or bucket not in ('day','week','month') then raise exception 'Bad date bucket' using errcode = '22023'; end if;
      expr := format('date_trunc(%L, %I)::date', bucket, f.col);
    else expr := format('%I', f.col); end if;
    alias := f.col;
    if alias = any(outs) then raise exception 'Field used twice' using errcode = '22023'; end if;
    sel := sel || format('%s as %I', expr, alias); grp := grp || expr; outs := outs || alias;
  end loop;

  if cardinality(grp) > 0 then
    if jsonb_typeof(coalesce(p_def->'measures', '[]')) <> 'array' then raise exception 'Bad measures' using errcode = '22023'; end if;
    for e in select * from jsonb_array_elements(coalesce(p_def->'measures', '[{"agg":"count"}]')) loop
      agg := e->>'agg';
      if agg = 'count' and e->>'field' is null then
        sel := sel || 'count(*)::bigint as "count"'::text; alias := 'count';
      elsif agg in ('sum','avg') then
        select * into f from public.report_field where source_key = src.key and col = e->>'field' and aggregatable;
        if not found then raise exception 'Field not allowed: %', left(e->>'field', 40) using errcode = '22023'; end if;
        alias := agg || '_' || f.col;
        sel := sel || format('round(%s(%I)::numeric, 2) as %I', agg, f.col, alias);
      else raise exception 'Measure not allowed' using errcode = '22023'; end if;
      if alias = any(outs) then raise exception 'Measure used twice' using errcode = '22023'; end if;
      outs := outs || alias;
    end loop;
    if cardinality(outs) = cardinality(grp) then sel := sel || 'count(*)::bigint as "count"'::text; outs := outs || 'count'::text; end if;
  else
    if jsonb_typeof(coalesce(p_def->'columns', '[]')) <> 'array' or jsonb_array_length(coalesce(p_def->'columns', '[]')) = 0
       or jsonb_array_length(p_def->'columns') > 20 then
      raise exception 'Pick 1 to 20 columns' using errcode = '22023';
    end if;
    for e in select * from jsonb_array_elements(p_def->'columns') loop
      select * into f from public.report_field where source_key = src.key and col = e #>> '{}';
      if not found then raise exception 'Field not allowed: %', left(e #>> '{}', 40) using errcode = '22023'; end if;
      if f.col = any(outs) then continue; end if;
      sel := sel || format('%I', f.col); outs := outs || f.col;
    end loop;
  end if;

  -- filters: values referenced as parameters from $1 (the def), never spliced into the text
  if jsonb_typeof(coalesce(p_def->'filters', '[]')) <> 'array' or jsonb_array_length(coalesce(p_def->'filters', '[]')) > 20 then
    raise exception 'Bad filters' using errcode = '22023';
  end if;
  i := 0;
  for e in select * from jsonb_array_elements(coalesce(p_def->'filters', '[]')) loop
    select * into f from public.report_field where source_key = src.key and col = e->>'field';
    if not found then raise exception 'Field not allowed: %', left(e->>'field', 40) using errcode = '22023'; end if;
    op := e->>'op';
    cast_to := case f.type when 'date' then 'date' when 'number' then 'numeric' when 'money' then 'numeric' else 'text' end;
    if op = 'eq' then
      whr := whr || format('%I = ($1->''filters''->%s->>''value'')::%s', f.col, i, cast_to);
    elsif op = 'in' then
      if jsonb_typeof(e->'values') <> 'array' then raise exception 'Bad filter values' using errcode = '22023'; end if;
      whr := whr || format('%I::text in (select jsonb_array_elements_text($1->''filters''->%s->''values''))', f.col, i);
    elsif op = 'between' and f.type in ('date','number','money') then
      whr := whr || format('(($1->''filters''->%1$s->>''from'') is null or %2$I >= ($1->''filters''->%1$s->>''from'')::%3$s)', i, f.col, cast_to);
      whr := whr || format('(($1->''filters''->%1$s->>''to'') is null or %2$I <= ($1->''filters''->%1$s->>''to'')::%3$s)', i, f.col, cast_to);
    elsif op = 'contains' and f.type in ('text','stage') then
      whr := whr || format('%I ilike ''%%'' || ($1->''filters''->%s->>''value'') || ''%%''', f.col, i);
    else raise exception 'Operator not allowed' using errcode = '22023'; end if;
    i := i + 1;
  end loop;

  sort_key := p_def->'sort'->>'key';
  sort_dir := lower(coalesce(p_def->'sort'->>'dir', 'asc'));
  if sort_key is not null and not (sort_key = any(outs)) then raise exception 'Sort not allowed' using errcode = '22023'; end if;
  if sort_dir not in ('asc','desc') then raise exception 'Sort not allowed' using errcode = '22023'; end if;
  lim := least(greatest(coalesce((p_def->>'limit')::int, 500), 1), 5000);

  q := format('select %s from public.%I', array_to_string(sel, ', '), src.view_name);
  if cardinality(whr) > 0 then q := q || ' where ' || array_to_string(whr, ' and '); end if;
  if cardinality(grp) > 0 then q := q || ' group by ' || array_to_string(grp, ', '); end if;
  if sort_key is not null then q := q || format(' order by %I %s nulls last', sort_key, sort_dir);
  elsif cardinality(grp) > 0 then q := q || ' order by 1'; end if;
  q := q || format(' limit %s', lim);

  execute format('select coalesce(jsonb_agg(to_jsonb(r)), ''[]''::jsonb) from (%s) r', q) into res using p_def;
  return jsonb_build_object('columns', to_jsonb(outs), 'rows', res);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  raise exception 'A filter value is not valid for its field' using errcode = '22023';
end $$;
revoke all on function public.run_report(jsonb) from public, anon;
grant execute on function public.run_report(jsonb) to authenticated;

-- 4. Question log, to improve the suggestions. Written only by the server (service role); Admin reads it.
--    Holds the question (phone numbers and emails removed) and the checked request; never the answer rows.
create table if not exists public.ask_log (
  id bigserial primary key,
  staff_id uuid references public.staff (id) on delete set null,
  question text not null check (length(question) <= 400),
  spec jsonb,
  ok boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ask_log_at_idx on public.ask_log (created_at desc);
alter table public.ask_log enable row level security;
revoke all on public.ask_log from public, anon, authenticated;
grant select on public.ask_log to authenticated;
revoke usage on sequence public.ask_log_id_seq from public, anon, authenticated;
drop policy if exists ask_log_read on public.ask_log;
create policy ask_log_read on public.ask_log for select to authenticated using (public.is_admin() and public.can_page('ask'));
