-- Stint CRM · reports.  Views run with the caller's own permissions, so only roles that can read the tables get numbers.
create or replace view public.rep_funnel with (security_invoker = true) as
with m as (select generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') as month)
select m.month::date as month,
       (select count(*) from public.lead l where date_trunc('month', l.created_at) = m.month) as leads,
       (select count(*) from public.candidate c where date_trunc('month', c.joined_on) = m.month) as enrolled,
       (select count(*) from public.placement p where date_trunc('month', p.created_at) = m.month and p.status <> 'Dropped') as placed,
       (select coalesce(sum(f.amount), 0) from public.fee_payment f where f.status = 'Received' and date_trunc('month', f.paid_on) = m.month) as collected
from m order by m.month desc;

create or replace view public.rep_roi with (security_invoker = true) as
select s.id, s.name as source, s.type,
       count(l.id) as leads,
       count(c.id) as enrolled,
       case when count(l.id) > 0 then round(100.0 * count(c.id) / count(l.id), 1) else 0 end as enrol_pct,
       coalesce(sum(fp.total), 0) as fees_booked
from public.lead_source s
left join public.lead l on l.source_id = s.id
left join public.candidate c on c.lead_id = l.id
left join public.fee_plan fp on fp.candidate_id = c.id
group by s.id order by count(l.id) desc;

create or replace view public.rep_batch with (security_invoker = true) as
select b.id, b.code as batch, st.full_name as trainer,
       (select count(*) from public.candidate c where c.batch_id = b.id) as students,
       (select round(100.0 * count(*) filter (where a.mark = 'P') / nullif(count(*), 0), 0) from public.attendance a where a.batch_id = b.id) as attendance_pct,
       (select round(100.0 * count(*) filter (where m.status = 'Passed') / nullif(count(*) filter (where m.status in ('Passed', 'Failed')), 0), 0)
          from public.mock_session m join public.candidate c on c.id = m.candidate_id where c.batch_id = b.id) as mock_pass_pct
from public.batch b left join public.staff st on st.id = b.trainer_id order by b.code;

create or replace view public.rep_place with (security_invoker = true) as
select pr.id, pr.name as program,
       count(p.id) filter (where p.status <> 'Dropped') as placed,
       round(avg(p.ctc_lpa) filter (where p.status <> 'Dropped'), 1) as avg_ctc_lpa,
       round(avg(extract(day from p.created_at - c.joined_on::timestamptz)) filter (where p.status <> 'Dropped'), 0) as days_to_place
from public.program pr
left join public.candidate c on c.program_id = pr.id
left join public.placement p on p.candidate_id = c.id
group by pr.id order by pr.name;

create or replace view public.rep_cash with (security_invoker = true) as
select pr.id, pr.name as program,
       coalesce(sum(s.total), 0) as booked,
       coalesce(sum(s.paid), 0) as collected,
       coalesce(sum(s.balance) filter (where s.overdue), 0) as overdue,
       case when coalesce(sum(s.total), 0) > 0 then round(100.0 * sum(s.paid) / sum(s.total), 0) else 0 end as collected_pct
from public.program pr left join public.fee_plan_summary s on s.program_id = pr.id
group by pr.id order by pr.name;

grant select on public.rep_funnel, public.rep_roi, public.rep_batch, public.rep_place, public.rep_cash, public.fee_plan_summary to authenticated, service_role;
