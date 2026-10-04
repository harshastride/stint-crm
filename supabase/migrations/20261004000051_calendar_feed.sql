-- Week calendar: one feed of follow-ups, batch class timings, mock interviews and counselling.
-- security_invoker: the source tables' row security decides what each person gets back.

-- Batch class timings (days are ISO weekdays: 1 = Mon … 7 = Sun)
alter table public.batch add column if not exists class_days smallint[] not null default '{1,2,3,4,5}';
alter table public.batch add column if not exists class_start time default '10:00';
alter table public.batch add column if not exists class_end time default '12:00';
alter table public.batch add column if not exists ends_on date;
alter table public.batch drop constraint if exists batch_class_days_ok;
alter table public.batch add constraint batch_class_days_ok check (class_days <@ '{1,2,3,4,5,6,7}'::smallint[]);
alter table public.batch drop constraint if exists batch_class_time_ok;
alter table public.batch add constraint batch_class_time_ok check (class_end is null or class_start is null or class_end > class_start);

-- The page itself (also created by migration 030; repeated so this file stands alone)
insert into public.page (id, grp, title, sort) values ('calendar', 'Home', 'Calendar', 2) on conflict (id) do nothing;
insert into public.role_page_access (role, page_id, mode)
select name, 'calendar', 'r' from public.app_role where name <> 'Admin' on conflict do nothing;

drop view if exists public.calendar_feed;
create view public.calendar_feed with (security_invoker = true) as
  -- open follow-ups
  select 'followup'::text as kind, f.id, f.title,
         coalesce(l.full_name, c.full_name, f.owner_role) as detail,
         f.due_at as starts_at, null::timestamptz as ends_at, false as all_day,
         case when f.lead_id is not null then 'lead' when f.candidate_id is not null then 'candidate' end as person_kind,
         coalesce(f.lead_id, f.candidate_id) as person_id
    from public.follow_up f
    left join public.lead l on l.id = f.lead_id
    left join public.candidate c on c.id = f.candidate_id
   where f.status = 'Open'
  union all
  -- mock interviews
  select 'interview', m.id, 'Mock ' || m.level || ' · ' || coalesce(c.full_name, ''), m.status,
         m.scheduled_at, m.scheduled_at + interval '1 hour', false, 'candidate', m.candidate_id
    from public.mock_session m
    left join public.candidate c on c.id = m.candidate_id
   where m.scheduled_at is not null
  union all
  -- counselling sessions
  select 'counsel', cs.id, 'Counselling · ' || coalesce(l.full_name, ''), cs.status,
         cs.scheduled_at, cs.scheduled_at + interval '45 minutes', false, 'lead', cs.lead_id
    from public.counselling_session cs
    left join public.lead l on l.id = cs.lead_id
   where cs.scheduled_at is not null
  union all
  -- batch classes, one row per class day (from 120 days back to 180 days ahead)
  select 'class', b.id, 'Batch ' || b.code, p.name,
         (d::date + coalesce(b.class_start, '10:00'::time)) at time zone 'Asia/Kolkata',
         (d::date + coalesce(b.class_end, b.class_start + interval '2 hours', '12:00'::time)) at time zone 'Asia/Kolkata',
         false, null, null
    from public.batch b
    left join public.program p on p.id = b.program_id
    cross join lateral generate_series(greatest(b.starts_on, current_date - 120),
                                       least(coalesce(b.ends_on, current_date + 180), current_date + 180), interval '1 day') d
   where b.starts_on is not null and b.status not in ('Completed', 'Closed', 'Cancelled')
     and extract(isodow from d)::smallint = any (b.class_days);

comment on view public.calendar_feed is 'Week calendar items; row security of follow_up, mock_session, counselling_session and batch applies (security_invoker).';
revoke all on public.calendar_feed from anon;
grant select on public.calendar_feed to authenticated;
