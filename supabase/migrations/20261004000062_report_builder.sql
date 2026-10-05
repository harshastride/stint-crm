-- Report builder: staff build their own reports from a whitelist. No SQL ever comes from the browser.
-- report_source / report_field are the only things run_report() will touch. Sensitive columns
-- (mobile, email, PAN, Aadhaar, bank) are not in any rb_* view, so they can never be picked.

insert into public.page (id, grp, title, sort) values ('reports_builder', 'Reports', 'Report builder', 37)
on conflict (id) do nothing;

-- 1. Report-friendly views (labels joined in). security_invoker, so the caller's row security applies.
create or replace view public.rb_leads with (security_invoker = true) as
select l.id, l.stage, l.city, p.name as program, s.name as source, c.name as campaign, o.full_name as owner,
       l.preferred_mode, (l.created_at at time zone 'Asia/Kolkata')::date as created_on
from public.lead_list l
left join public.program p on p.id = l.program_id
left join public.lead_source s on s.id = l.source_id
left join public.campaign c on c.id = l.campaign_id
left join public.staff o on o.id = l.owner_id;

create or replace view public.rb_candidates with (security_invoker = true) as
select c.id, c.stage, p.name as program, b.code as batch, o.full_name as poc, c.joined_on,
       (c.created_at at time zone 'Asia/Kolkata')::date as created_on
from public.candidate c
left join public.program p on p.id = c.program_id
left join public.batch b on b.id = c.batch_id
left join public.staff o on o.id = c.poc_id;

create or replace view public.rb_payments with (security_invoker = true) as
select f.id, f.amount, f.mode, f.status, f.label, f.due_on, f.paid_on, p.name as program
from public.fee_payment f
left join public.candidate c on c.id = f.candidate_id
left join public.program p on p.id = c.program_id;

create or replace view public.rb_placements with (security_invoker = true) as
select pl.id, co.name as company, pl.role, pl.ctc_lpa, pl.joining_on, pl.status, p.name as program
from public.placement pl
left join public.company co on co.id = pl.company_id
left join public.candidate c on c.id = pl.candidate_id
left join public.program p on p.id = c.program_id;

create or replace view public.rb_calls with (security_invoker = true) as
select k.id, s.full_name as caller, k.outcome, k.duration_sec, (k.called_at at time zone 'Asia/Kolkata')::date as called_on
from public.call_log k left join public.staff s on s.id = k.caller_id;

create or replace view public.rb_followups with (security_invoker = true) as
select f.id, s.full_name as owner, f.owner_role, f.status, (f.due_at at time zone 'Asia/Kolkata')::date as due_on,
       (f.created_at at time zone 'Asia/Kolkata')::date as created_on
from public.follow_up f left join public.staff s on s.id = f.owner_id;

create or replace view public.rb_attendance with (security_invoker = true) as
select a.id, b.code as batch, a.mark, a.day
from public.attendance a left join public.batch b on b.id = a.batch_id;

create or replace view public.rb_mocks with (security_invoker = true) as
select m.id, m.level, m.status, s.full_name as trainer, (m.scheduled_at at time zone 'Asia/Kolkata')::date as scheduled_on
from public.mock_session m left join public.staff s on s.id = m.trainer_id;

revoke all on public.rb_leads, public.rb_candidates, public.rb_payments, public.rb_placements, public.rb_calls,
  public.rb_followups, public.rb_attendance, public.rb_mocks from anon;
grant select on public.rb_leads, public.rb_candidates, public.rb_payments, public.rb_placements, public.rb_calls,
  public.rb_followups, public.rb_attendance, public.rb_mocks to authenticated;

-- 2. Catalogue
create table if not exists public.report_source (
  key text primary key,
  label text not null,
  view_name text not null,
  page_id text not null references public.page(id) on delete cascade,
  date_field text,
  sort int not null default 0
);
create table if not exists public.report_field (
  source_key text not null references public.report_source(key) on delete cascade,
  col text not null check (col ~ '^[a-z_][a-z0-9_]*$'),
  label text not null,
  type text not null check (type in ('text','number','money','date','stage')),
  groupable boolean not null default true,
  aggregatable boolean not null default false,
  sort int not null default 0,
  primary key (source_key, col)
);
alter table public.report_source enable row level security;
alter table public.report_field enable row level security;
drop policy if exists report_source_read on public.report_source;
create policy report_source_read on public.report_source for select to authenticated
  using (public.can_page('reports_builder') and public.can_page(page_id));
drop policy if exists report_field_read on public.report_field;
create policy report_field_read on public.report_field for select to authenticated
  using (exists (select 1 from public.report_source s where s.key = source_key));
revoke insert, update, delete on public.report_source, public.report_field from authenticated, anon;
grant select on public.report_source, public.report_field to authenticated;

-- On a fresh database the page rows come from seed.sql, which runs after migrations; make sure the ones
-- referenced below exist (seed.sql later sets their real group/title/sort).
insert into public.page (id, grp, title, sort) values
  ('lead', 'Telecalling', 'Leads', 0), ('candidate', 'Enrolment', 'Candidates', 0), ('payment', 'Finance', 'Payments', 0),
  ('placement', 'Placement', 'Placements', 0), ('call', 'Telecalling', 'Call logs', 0), ('followups', 'Home', 'My follow-ups', 1),
  ('attendance', 'Training', 'Attendance', 0), ('mock', 'Mocks', 'Mock interviews', 0)
on conflict (id) do nothing;

insert into public.report_source (key, label, view_name, page_id, date_field, sort) values
  ('leads', 'Leads', 'rb_leads', 'lead', 'created_on', 1),
  ('candidates', 'Candidates', 'rb_candidates', 'candidate', 'created_on', 2),
  ('payments', 'Fee payments', 'rb_payments', 'payment', 'due_on', 3),
  ('placements', 'Placements', 'rb_placements', 'placement', 'joining_on', 4),
  ('calls', 'Calls', 'rb_calls', 'call', 'called_on', 5),
  ('followups', 'Follow-ups', 'rb_followups', 'followups', 'due_on', 6),
  ('attendance', 'Attendance', 'rb_attendance', 'attendance', 'day', 7),
  ('mocks', 'Mock interviews', 'rb_mocks', 'mock', 'scheduled_on', 8)
on conflict (key) do update set label = excluded.label, view_name = excluded.view_name, page_id = excluded.page_id, date_field = excluded.date_field, sort = excluded.sort;

insert into public.report_field (source_key, col, label, type, groupable, aggregatable, sort) values
  ('leads','stage','Stage','stage',true,false,1), ('leads','program','Program','text',true,false,2),
  ('leads','source','Lead source','text',true,false,3), ('leads','campaign','Campaign','text',true,false,4),
  ('leads','owner','Owner','text',true,false,5), ('leads','city','City','text',true,false,6),
  ('leads','preferred_mode','Preferred mode','text',true,false,7), ('leads','created_on','Created on','date',true,false,8),
  ('candidates','stage','Stage','stage',true,false,1), ('candidates','program','Program','text',true,false,2),
  ('candidates','batch','Batch','text',true,false,3), ('candidates','poc','Point of contact','text',true,false,4),
  ('candidates','joined_on','Joined on','date',true,false,5), ('candidates','created_on','Created on','date',true,false,6),
  ('payments','amount','Amount','money',false,true,1), ('payments','status','Status','stage',true,false,2),
  ('payments','mode','Payment mode','text',true,false,3), ('payments','label','Instalment','text',true,false,4),
  ('payments','program','Program','text',true,false,5), ('payments','due_on','Due on','date',true,false,6),
  ('payments','paid_on','Paid on','date',true,false,7),
  ('placements','company','Company','text',true,false,1), ('placements','role','Job role','text',true,false,2),
  ('placements','ctc_lpa','Salary (LPA)','number',false,true,3), ('placements','status','Status','stage',true,false,4),
  ('placements','program','Program','text',true,false,5), ('placements','joining_on','Joining on','date',true,false,6),
  ('calls','caller','Caller','text',true,false,1), ('calls','outcome','Outcome','stage',true,false,2),
  ('calls','duration_sec','Duration (sec)','number',false,true,3), ('calls','called_on','Called on','date',true,false,4),
  ('followups','owner','Owner','text',true,false,1), ('followups','owner_role','Team','text',true,false,2),
  ('followups','status','Status','stage',true,false,3), ('followups','due_on','Due on','date',true,false,4),
  ('followups','created_on','Created on','date',true,false,5),
  ('attendance','batch','Batch','text',true,false,1), ('attendance','mark','Mark','stage',true,false,2),
  ('attendance','day','Day','date',true,false,3),
  ('mocks','level','Level','text',true,false,1), ('mocks','status','Status','stage',true,false,2),
  ('mocks','trainer','Trainer','text',true,false,3), ('mocks','scheduled_on','Scheduled on','date',true,false,4)
on conflict (source_key, col) do update set label = excluded.label, type = excluded.type, groupable = excluded.groupable,
  aggregatable = excluded.aggregatable, sort = excluded.sort;

-- 3. run_report. SECURITY INVOKER: row security of the caller applies to every row read.
-- def: { source, columns:[col], group_by:[{field, bucket?: day|week|month}], measures:[{agg: count|sum|avg, field?}],
--        filters:[{field, op: eq|in|between|contains, value?, values?, from?, to?}], sort:{key, dir: asc|desc}, limit }
-- Identifiers only ever come from the catalogue and go through %I; values are bound parameters ($1 = the def).
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
  if public.my_role() is null or not public.can_page('reports_builder') then
    raise exception 'Report builder is not open to your role' using errcode = '42501';
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

-- 4. Saved reports
create table if not exists public.saved_report (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  def jsonb not null,
  owner uuid not null default auth.uid() references public.staff(id) on delete cascade,
  shared_with_roles text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.saved_report enable row level security;
drop policy if exists saved_report_read on public.saved_report;
create policy saved_report_read on public.saved_report for select to authenticated
  using (public.can_page('reports_builder') and (owner = auth.uid() or public.is_admin() or public.my_role() = any(shared_with_roles)));
drop policy if exists saved_report_ins on public.saved_report;
create policy saved_report_ins on public.saved_report for insert to authenticated
  with check (public.can_page('reports_builder') and owner = auth.uid());
drop policy if exists saved_report_upd on public.saved_report;
create policy saved_report_upd on public.saved_report for update to authenticated
  using (public.can_page('reports_builder') and owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists saved_report_del on public.saved_report;
create policy saved_report_del on public.saved_report for delete to authenticated
  using (public.can_page('reports_builder') and (owner = auth.uid() or public.is_admin()));
revoke all on public.saved_report from anon;
grant select, insert, update, delete on public.saved_report to authenticated;
