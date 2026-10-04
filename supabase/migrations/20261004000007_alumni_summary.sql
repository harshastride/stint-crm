-- Alumni page: one row per candidate in the Alumni stage (or with any check-in), with their latest check-in.
-- id is the latest check-in (null when nobody has checked in yet); key is the candidate.
create or replace view public.alumni_summary with (security_invoker = true) as
select f.id, c.id as key, c.id as candidate_id, c.full_name, c.stage,
       co.name as company, pl.role,
       f.note, f.contacted_on, f.by_id, s.full_name as by_name,
       coalesce(t.referrals, 0) as referrals, coalesce(t.checkins, 0) as checkins
from public.candidate c
left join lateral (select * from public.alumni_followup a where a.candidate_id = c.id order by a.contacted_on desc, a.id desc limit 1) f on true
left join lateral (select sum(referrals)::int as referrals, count(*)::int as checkins from public.alumni_followup a where a.candidate_id = c.id) t on true
left join lateral (select * from public.placement p where p.candidate_id = c.id order by p.created_at desc limit 1) pl on true
left join public.company co on co.id = pl.company_id
left join public.staff s on s.id = f.by_id
where c.stage = 'Alumni' or f.id is not null;

grant select on public.alumni_summary to authenticated, service_role;
