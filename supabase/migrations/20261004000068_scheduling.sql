-- Calendar scheduling: each calendar item now says which staff member it belongs to,
-- so the calendar can show "my day" and warn when one person has overlapping items.
-- Same rows and row security as before (security_invoker); only a staff_id column is added at the end.
create or replace view public.calendar_feed with (security_invoker = true) as
  select 'followup'::text as kind, f.id, f.title,
         coalesce(l.full_name, c.full_name, f.owner_role) as detail,
         f.due_at as starts_at, null::timestamptz as ends_at, false as all_day,
         case when f.lead_id is not null then 'lead' when f.candidate_id is not null then 'candidate' end as person_kind,
         coalesce(f.lead_id, f.candidate_id) as person_id,
         f.owner_id as staff_id
    from public.follow_up f
    left join public.lead l on l.id = f.lead_id
    left join public.candidate c on c.id = f.candidate_id
   where f.status = 'Open'
  union all
  select 'interview', m.id, 'Mock ' || m.level || ' · ' || coalesce(c.full_name, ''), m.status,
         m.scheduled_at, m.scheduled_at + interval '1 hour', false, 'candidate', m.candidate_id, m.trainer_id
    from public.mock_session m
    left join public.candidate c on c.id = m.candidate_id
   where m.scheduled_at is not null
  union all
  select 'counsel', cs.id, 'Counselling · ' || coalesce(l.full_name, ''), cs.status,
         cs.scheduled_at, cs.scheduled_at + interval '45 minutes', false, 'lead', cs.lead_id, cs.counsellor_id
    from public.counselling_session cs
    left join public.lead l on l.id = cs.lead_id
   where cs.scheduled_at is not null
  union all
  select 'class', b.id, 'Batch ' || b.code, p.name,
         (d::date + coalesce(b.class_start, '10:00'::time)) at time zone 'Asia/Kolkata',
         (d::date + coalesce(b.class_end, b.class_start + interval '2 hours', '12:00'::time)) at time zone 'Asia/Kolkata',
         false, null, null, b.trainer_id
    from public.batch b
    left join public.program p on p.id = b.program_id
    cross join lateral generate_series(greatest(b.starts_on, current_date - 120),
                                       least(coalesce(b.ends_on, current_date + 180), current_date + 180), interval '1 day') d
   where b.starts_on is not null and b.status not in ('Completed', 'Closed', 'Cancelled')
     and extract(isodow from d)::smallint = any (b.class_days);

comment on view public.calendar_feed is 'Calendar items with the responsible staff member; row security of follow_up, mock_session, counselling_session and batch applies (security_invoker).';
revoke all on public.calendar_feed from anon;
grant select on public.calendar_feed to authenticated;

-- Enrolment data sheet: staff-editable choices instead of free typing (CLAUDE.md rule 7).
insert into public.dropdown_list (id, name, used_on) values
  ('marital_status', 'Marital status', 'Enrolment form'),
  ('education_level', 'Education level', 'Enrolment form')
on conflict (id) do nothing;
insert into public.dropdown_value (list_id, value, sort) values
  ('marital_status', 'Single', 0), ('marital_status', 'Married', 1), ('marital_status', 'Other', 2),
  ('education_level', 'SSC / 10th', 0), ('education_level', 'Intermediate / 12th', 1), ('education_level', 'Diploma', 2),
  ('education_level', 'Graduation', 3), ('education_level', 'Post-graduation', 4), ('education_level', 'Other', 5)
on conflict (list_id, value) do nothing;
