-- 2.4 Automatic alerts. raise_alerts() runs every 15 minutes (pg_cron) and can be run by hand.
-- One open alert per record and reason; an alert closes itself when its condition is gone.
create extension if not exists pg_cron;

alter table public.alert add column reason text;
alter table public.alert add column auto boolean not null default false;
create unique index alert_open_once on public.alert (reason, coalesce(candidate_id, lead_id)) where status = 'Open' and reason is not null;

create or replace function public.days_in_stage(ent text, eid uuid, since timestamptz) returns int
language sql stable security definer set search_path = public as $$
  select (current_date - coalesce((select max(at) from public.status_history h where h.entity = ent and h.entity_id = eid), since)::date)
$$;

create or replace function public.raise_alerts() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- payments past their due day become Overdue
  update public.fee_payment set status = 'Overdue' where status = 'Due' and due_on < current_date;

  create temp table want (reason text, title text, area text, lead_id uuid, candidate_id uuid, owner_id uuid, priority text) on commit drop;

  -- fee overdue: one alert per student, worded by the oldest due day
  insert into want
  select 'fee_overdue', 'Fee ' || (current_date - min(p.due_on)) || ' days overdue', 'Fees', null, p.candidate_id, null,
         case when current_date - min(p.due_on) > 14 then 'High' else 'Medium' end
  from public.fee_payment p where p.status = 'Overdue' group by p.candidate_id;

  -- follow-up missed: still open a day after it was due
  insert into want
  select distinct on (coalesce(f.candidate_id, f.lead_id)) 'followup_missed', 'Follow-up missed: ' || f.title,
         case when f.lead_id is not null then 'Telecalling' else 'Follow-ups' end, f.lead_id, f.candidate_id, f.owner_id, 'Medium'
  from public.follow_up f
  where f.status = 'Open' and f.due_at < now() - interval '1 day' and (f.lead_id is not null or f.candidate_id is not null)
  order by coalesce(f.candidate_id, f.lead_id), f.due_at;

  -- stuck: longer in a stage than follow_rule.stuck_after_days allows
  insert into want
  select 'stuck', 'Stuck in ' || l.stage || ' for ' || days_in_stage('lead', l.id, l.created_at) || ' days', 'Telecalling', l.id, null, l.owner_id, 'Medium'
  from public.lead l
  join public.follow_rule r on r.status = 'Live' and r.stuck_after_days is not null
       and ((r.stage = 'Calls' and l.stage in ('New', 'Callback')) or (r.stage = 'Counselling' and l.stage in ('Interested', 'Counselling')))
  where days_in_stage('lead', l.id, l.created_at) > r.stuck_after_days;
  insert into want
  select 'stuck', 'Stuck in ' || c.stage || ' for ' || days_in_stage('candidate', c.id, c.created_at) || ' days', 'Candidates', null, c.id, c.poc_id, 'Medium'
  from public.candidate c
  join public.follow_rule r on r.status = 'Live' and r.stuck_after_days is not null
       and ((r.stage = c.stage) or (r.stage = 'Resume + docs' and c.stage in ('Resume', 'Docs')) or (r.stage = 'Placement' and c.stage = 'Ready'))
  where days_in_stage('candidate', c.id, c.created_at) > r.stuck_after_days;

  -- mock failed twice / resume rejected twice
  insert into want
  select 'mock_failed_twice', 'Mock failed twice', 'Mocks', null, m.candidate_id, c.poc_id, 'Medium'
  from public.mock_session m join public.candidate c on c.id = m.candidate_id
  where m.status = 'Failed' group by m.candidate_id, c.poc_id having count(*) >= 2;
  insert into want
  select 'resume_rejected_twice', 'Resume rejected twice', 'Resume', null, rv.candidate_id, c.poc_id, 'High'
  from public.resume_version rv join public.candidate c on c.id = rv.candidate_id
  where rv.status = 'Rejected' group by rv.candidate_id, c.poc_id having count(*) >= 2;

  -- close what no longer applies, refresh wording, add what is new
  update public.alert a set status = 'Resolved', resolved_at = now()
  where a.auto and a.status = 'Open'
    and not exists (select 1 from want w where w.reason = a.reason and coalesce(w.candidate_id, w.lead_id) = coalesce(a.candidate_id, a.lead_id));
  update public.alert a set title = w.title, priority = w.priority
  from want w where a.auto and a.status = 'Open' and w.reason = a.reason and coalesce(w.candidate_id, w.lead_id) = coalesce(a.candidate_id, a.lead_id)
    and (a.title <> w.title or a.priority <> w.priority);
  insert into public.alert (reason, title, area, lead_id, candidate_id, owner_id, priority, auto)
  select reason, title, area, lead_id, candidate_id, owner_id, priority, true from want
  on conflict (reason, coalesce(candidate_id, lead_id)) where status = 'Open' and reason is not null do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.raise_alerts() from public, anon, authenticated;
grant execute on function public.raise_alerts() to service_role;

-- Admins can press "Check now" on the Alerts page
create or replace function public.raise_alerts_now() returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can run the alert check.' using errcode = '42501'; end if;
  return public.raise_alerts();
end $$;
grant execute on function public.raise_alerts_now() to authenticated;

select cron.schedule('raise-alerts', '*/15 * * * *', 'select public.raise_alerts()');
