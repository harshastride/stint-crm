-- Stint CRM · report definitions fixed (069).
-- * Months and days are Asia/Kolkata calendar periods, not UTC.
-- * rep_roi counted a candidate once per fee plan (join fan-out) and showed 0% when a source had no leads;
--   it now follows each source's own leads (a cohort), counts distinct enrolled leads, and returns NULL
--   ("not enough data") for a zero denominator.
-- * rep_cash collected_pct is NULL when nothing is booked. rep_place gains candidates / placed_candidates
--   so a placement rate can be read with a stated denominator.
-- Views stay security_invoker, so each role only gets numbers from rows it can already read.

create or replace view public.rep_funnel with (security_invoker = true) as
with m as (
  select generate_series(date_trunc('month', now() at time zone 'Asia/Kolkata') - interval '5 months',
                         date_trunc('month', now() at time zone 'Asia/Kolkata'), interval '1 month') as month)
select m.month::date as month,
       (select count(*) from public.lead l where date_trunc('month', l.created_at at time zone 'Asia/Kolkata') = m.month) as leads,
       (select count(*) from public.candidate c where date_trunc('month', c.joined_on) = m.month) as enrolled,
       (select count(*) from public.placement p where date_trunc('month', p.created_at at time zone 'Asia/Kolkata') = m.month and p.status <> 'Dropped') as placed,
       (select coalesce(sum(f.amount), 0) from public.fee_payment f where f.status = 'Received' and date_trunc('month', f.paid_on) = m.month) as collected
from m order by m.month desc;

create or replace view public.rep_roi with (security_invoker = true) as
with l as (select source_id, count(*) as leads from public.lead group by source_id),
     e as (select l.source_id, count(distinct l.id) as enrolled
             from public.lead l where exists (select 1 from public.candidate c where c.lead_id = l.id) group by l.source_id),
     f as (select l.source_id, sum(fp.total) as fees
             from public.lead l join public.candidate c on c.lead_id = l.id join public.fee_plan fp on fp.candidate_id = c.id group by l.source_id)
select s.id, s.name as source, s.type,
       coalesce(l.leads, 0) as leads,
       coalesce(e.enrolled, 0) as enrolled,
       case when coalesce(l.leads, 0) > 0 then round(100.0 * coalesce(e.enrolled, 0) / l.leads, 1) end as enrol_pct,
       coalesce(f.fees, 0) as fees_booked
from public.lead_source s
left join l on l.source_id = s.id left join e on e.source_id = s.id left join f on f.source_id = s.id
order by coalesce(l.leads, 0) desc;

create or replace view public.rep_place with (security_invoker = true) as
select pr.id, pr.name as program,
       count(p.id) filter (where p.status <> 'Dropped') as placed,
       round(avg(p.ctc_lpa) filter (where p.status <> 'Dropped'), 1) as avg_ctc_lpa,
       round(avg(((p.created_at at time zone 'Asia/Kolkata')::date - c.joined_on)) filter (where p.status <> 'Dropped'), 0) as days_to_place,
       count(distinct c.id) as candidates,
       count(distinct c.id) filter (where p.status <> 'Dropped') as placed_candidates
from public.program pr
left join public.candidate c on c.program_id = pr.id
left join public.placement p on p.candidate_id = c.id
group by pr.id order by pr.name;

create or replace view public.rep_cash with (security_invoker = true) as
select pr.id, pr.name as program,
       coalesce(sum(s.total), 0) as booked,
       coalesce(sum(s.paid), 0) as collected,
       coalesce(sum(s.balance) filter (where s.overdue), 0) as overdue,
       case when coalesce(sum(s.total), 0) > 0 then round(100.0 * sum(s.paid) / sum(s.total), 0) end as collected_pct
from public.program pr left join public.fee_plan_summary s on s.program_id = pr.id
group by pr.id order by pr.name;

grant select on public.rep_funnel, public.rep_roi, public.rep_place, public.rep_cash to authenticated, service_role;
