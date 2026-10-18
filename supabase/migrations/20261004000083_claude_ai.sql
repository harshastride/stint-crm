-- Claude features: a usage log (what each AI call cost), saved AI briefs (daily call brief, weekly owner summary),
-- the numbers behind the weekly summary (counted here, never by the AI), and the Monday job that writes it.

-- 1. One row per Claude call. Written only by the server (service role); Admin reads it. Never holds the text sent or received.
create table if not exists public.ai_usage (
  id bigserial primary key,
  feature text not null,                -- call_summary, voice_note, call_brief, owner_week
  staff_id uuid references public.staff (id) on delete set null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(10, 5) not null default 0,
  ok boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_at_idx on public.ai_usage (created_at desc);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from public, anon, authenticated;
grant select on public.ai_usage to authenticated;
revoke usage on sequence public.ai_usage_id_seq from public, anon, authenticated;
drop policy if exists ai_usage_read on public.ai_usage;
create policy ai_usage_read on public.ai_usage for select to authenticated using (public.is_admin());

-- 2. Saved briefs. A call brief belongs to one staff member and one India day; the owner summary to one week.
--    Written only by the server; staff read their own call brief (if they may open Leads), Admin reads the owner summary.
create table if not exists public.ai_brief (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('call_brief', 'owner_week')),
  staff_id uuid references public.staff (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  body jsonb not null,                  -- what Claude wrote
  facts jsonb,                          -- the counted numbers it was given (owner summary), shown beside it
  model text not null,
  created_by uuid references public.staff (id) on delete set null,
  created_at timestamptz not null default now(),
  unique nulls not distinct (kind, staff_id, period_start)
);
alter table public.ai_brief enable row level security;
revoke all on public.ai_brief from public, anon, authenticated;
grant select on public.ai_brief to authenticated;
drop policy if exists ai_brief_read on public.ai_brief;
create policy ai_brief_read on public.ai_brief for select to authenticated using (
  (kind = 'call_brief' and staff_id = auth.uid() and public.can_page('lead', 'r'))
  or (kind = 'owner_week' and public.is_admin()));

-- 3. The numbers for the weekly owner summary: the 7 India days ending p_end, compared with the 7 days before.
--    Server only (service role). Every figure is a plain count or sum from the tables, so the summary can be checked.
create or replace function public.owner_week_facts(p_end date) returns jsonb
language sql stable security definer set search_path = public as $$
  with p as (select p_end - 6 as f, p_end as t, p_end - 13 as pf, p_end - 7 as pt),
  ist as (select (now() at time zone 'Asia/Kolkata')::date as today)
  select jsonb_build_object(
    'week', jsonb_build_object('from', p.f, 'to', p.t, 'previous_from', p.pf, 'previous_to', p.pt),
    'leads', jsonb_build_object(
      'new', (select count(*) from lead l where (l.created_at at time zone 'Asia/Kolkata')::date between p.f and p.t),
      'new_previous', (select count(*) from lead l where (l.created_at at time zone 'Asia/Kolkata')::date between p.pf and p.pt),
      'new_by_source', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
          select coalesce(s.name, 'No source') as source, count(*) as n from lead l left join lead_source s on s.id = l.source_id
          where (l.created_at at time zone 'Asia/Kolkata')::date between p.f and p.t group by 1 order by 2 desc limit 6) x),
      'open_by_stage', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
          select stage, count(*) as n from lead where stage not in ('Converted', 'Not interested') group by 1) x),
      'open_not_called_7_days', (select count(*) from lead l where l.stage not in ('Converted', 'Not interested')
          and l.created_at < now() - interval '7 days'
          and not exists (select 1 from call_log c where c.lead_id = l.id and c.called_at > now() - interval '7 days'))),
    'calls', jsonb_build_object(
      'made', (select count(*) from call_log c where (c.called_at at time zone 'Asia/Kolkata')::date between p.f and p.t),
      'made_previous', (select count(*) from call_log c where (c.called_at at time zone 'Asia/Kolkata')::date between p.pf and p.pt),
      'by_caller', (select coalesce(jsonb_agg(x order by x.calls desc), '[]') from (
          select s.full_name as name,
                 count(*) filter (where (c.called_at at time zone 'Asia/Kolkata')::date between p.f and p.t) as calls,
                 count(*) filter (where (c.called_at at time zone 'Asia/Kolkata')::date between p.pf and p.pt) as calls_previous
          from call_log c join staff s on s.id = c.caller_id
          where (c.called_at at time zone 'Asia/Kolkata')::date between p.pf and p.t group by 1 order by 2 desc limit 10) x),
      'outcomes', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
          select outcome, count(*) as n from call_log c where (c.called_at at time zone 'Asia/Kolkata')::date between p.f and p.t group by 1) x)),
    'counselling_booked', (select count(*) from counselling_session c where (c.created_at at time zone 'Asia/Kolkata')::date between p.f and p.t),
    'counselling_booked_previous', (select count(*) from counselling_session c where (c.created_at at time zone 'Asia/Kolkata')::date between p.pf and p.pt),
    'quotes_sent', (select count(*) from fee_quote q where (q.created_at at time zone 'Asia/Kolkata')::date between p.f and p.t),
    'quotes_waiting_approval', (select count(*) from fee_quote q where q.needs_approval and q.approved_by is null and q.status not in ('Accepted', 'Rejected', 'Expired')),
    'enrolments', jsonb_build_object(
      'new', (select count(*) from candidate c where (c.created_at at time zone 'Asia/Kolkata')::date between p.f and p.t),
      'new_previous', (select count(*) from candidate c where (c.created_at at time zone 'Asia/Kolkata')::date between p.pf and p.pt),
      'by_program', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
          select coalesce(g.name, 'No program') as program, count(*) as n from candidate c left join program g on g.id = c.program_id
          where (c.created_at at time zone 'Asia/Kolkata')::date between p.f and p.t group by 1) x)),
    'fees_inr', jsonb_build_object(
      'collected', (select coalesce(sum(amount), 0) from fee_payment where status = 'Received' and paid_on between p.f and p.t),
      'collected_previous', (select coalesce(sum(amount), 0) from fee_payment where status = 'Received' and paid_on between p.pf and p.pt),
      'overdue_amount', (select coalesce(sum(amount), 0) from fee_payment where status = 'Overdue'),
      'overdue_payments', (select count(*) from fee_payment where status = 'Overdue')),
    'placements', jsonb_build_object(
      'new', (select count(*) from placement x where (x.created_at at time zone 'Asia/Kolkata')::date between p.f and p.t),
      'new_previous', (select count(*) from placement x where (x.created_at at time zone 'Asia/Kolkata')::date between p.pf and p.pt),
      'joining_soon', (select count(*) from placement where status = 'Joining soon')),
    'follow_ups', jsonb_build_object(
      'overdue_open', (select count(*) from follow_up f, ist where f.status = 'Open' and (f.due_at at time zone 'Asia/Kolkata')::date < ist.today),
      'overdue_by_owner', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
          select coalesce(s.full_name, 'Team: ' || coalesce(f.owner_role, 'none')) as owner, count(*) as n
          from follow_up f cross join ist left join staff s on s.id = f.owner_id
          where f.status = 'Open' and (f.due_at at time zone 'Asia/Kolkata')::date < ist.today group by 1 order by 2 desc limit 6) x)),
    'alerts', jsonb_build_object(
      'open', (select count(*) from alert where status = 'Open'),
      'open_high', (select count(*) from alert where status = 'Open' and priority = 'High'),
      'open_by_kind', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
          select split_part(title, ':', 1) as kind, count(*) as n from alert where status = 'Open' group by 1 order by 2 desc limit 6) x))
  ) from p
$$;
revoke execute on function public.owner_week_facts(date) from public, anon, authenticated;

-- 4. Every Monday 08:00 India time (02:30 UTC) the app writes last week's owner summary (same pattern as the message sender).
create or replace function public.call_owner_weekly() returns bigint
language sql security definer set search_path = public, extensions as $$
  select net.http_post(
    url := (select value from public.integration_config where key = 'app_url') || '/api/ai/weekly',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.integration_config where key = 'cron_secret')))
$$;
revoke all on function public.call_owner_weekly() from public, anon, authenticated;
do $$
begin
  perform cron.unschedule('owner-weekly') where exists (select 1 from cron.job where jobname = 'owner-weekly');
  perform cron.schedule('owner-weekly', '30 2 * * 1', 'select public.call_owner_weekly()');
exception when others then raise notice 'pg_cron not available: %', sqlerrm;
end $$;

-- 5. The Connections page lists Claude instead of Gemini.
update public.connection set service = 'Claude', used_for = 'Summaries and briefs' where service = 'Gemini';
