-- Calling queue: "Start my calls". One lead at a time for a telecaller or sales person, in the order they should call today.
-- Safe to run again.
--
-- Who is in my list for a day (India time):
--   * my open follow-ups on a lead, due before the end of that day (the same rule as the daily call brief)
--   * leads I own whose "next call" is before the end of that day
--   * new leads I own that nobody has called yet
--   * leads I already called that day (shown as done, so "7 of 18 done" counts them)
-- Order: overdue first, then Hot → Warm → Cold (lead_signal, migration 090), then those inside their usual answering hours,
-- then the earliest due. Done ones last.
-- Reads lead_list (masked view), never mobile or email. Runs as the caller, so lead, follow-up and call row security apply.

-- 1. The page: first under Telecalling (right before Leads). Pages after it move down one, only the first time
--    (page_place, migration 086; seed.sql places it again on a fresh database).
insert into public.page (id, grp, title, sort) values ('queue', 'Telecalling', 'Start my calls', 6)
on conflict (id) do nothing;
select public.page_place('queue', 'lead', false);
-- Grants for roles that exist (on a fresh database the roles come later from seed.sql, which grants them too)
insert into public.role_page_access (role, page_id, mode)
select name, 'queue', 'w' from public.app_role where name in ('Telecaller', 'Sales')
on conflict do nothing;

-- 2. The list
drop function if exists public.my_call_queue(date);
create or replace function public.my_call_queue(p_day date default null)
returns table (
  lead_id uuid, full_name text, stage text, program text,
  due_at timestamptz, due_kind text, overdue boolean, done_today boolean,
  follow_up_id uuid, follow_up_title text,
  band text, score int, reasons text[], best_label text, best_from int, best_to int, in_window boolean,
  called_today_at timestamptz, last_contact_at timestamptz, pos int
)
language plpgsql stable security invoker set search_path = public as $$
declare
  me uuid := auth.uid();
  d date := coalesce(p_day, (now() at time zone 'Asia/Kolkata')::date);
  d0 timestamptz := d::timestamp at time zone 'Asia/Kolkata';
  d1 timestamptz := (d + 1)::timestamp at time zone 'Asia/Kolkata';
  h int := extract(hour from now() at time zone 'Asia/Kolkata')::int;
  sig text;
begin
  if me is null or not public.can_page('queue', 'r') then return; end if;
  -- Lead signals come from migration 090. If that view is not there yet, the list still works, without bands.
  sig := case when to_regclass('public.lead_signal') is not null
    then 'left join public.lead_signal sg on sg.lead_id = l.id'
    else 'left join (select null::uuid lead_id, null::int score, null::text band, null::text[] reasons, null::int best_from, null::int best_to, null::text best_label, null::timestamptz last_contact_at) sg on false'
  end;
  return query execute format($q$
    with fu as (                       -- my earliest open follow-up per lead, due by the end of the day
      select distinct on (f.lead_id) f.lead_id, f.id, f.title, f.due_at
      from public.follow_up f
      where f.status = 'Open' and f.lead_id is not null and f.owner_id = $1 and f.due_at < $3
      order by f.lead_id, f.due_at, f.created_at
    ),
    mine as (                          -- my calls on that day
      select c.lead_id, max(c.called_at) as at from public.call_log c
      where c.caller_id = $1 and c.called_at >= $2 and c.called_at < $3 group by c.lead_id
    ),
    ids as (
      select fu.lead_id from fu
      union select l.id from public.lead_list l
        where l.owner_id = $1 and l.next_call_at < $3 and l.stage not in ('Converted', 'Not interested')
      union select l.id from public.lead_list l
        where l.owner_id = $1 and l.stage = 'New' and l.next_call_at is null and l.created_at < $3
          and not exists (select 1 from public.call_log c where c.lead_id = l.id)
      union select mine.lead_id from mine
    ),
    rows as (
      select l.id, l.full_name, l.stage, p.name as program, fu.id as fu_id, fu.title as fu_title, mine.at as called_at,
             sg.band, sg.score, sg.reasons, sg.best_label, sg.best_from, sg.best_to, sg.last_contact_at,
             l.stage in ('Converted', 'Not interested') as closed,
             case when fu.due_at is not null and (l.next_call_at is null or l.next_call_at >= $3 or fu.due_at <= l.next_call_at) then fu.due_at
                  when l.next_call_at < $3 then l.next_call_at
                  when l.stage = 'New' and l.next_call_at is null and not exists (select 1 from public.call_log c where c.lead_id = l.id) then l.created_at
             end as due,
             case when fu.due_at is not null and (l.next_call_at is null or l.next_call_at >= $3 or fu.due_at <= l.next_call_at) then 'follow_up'
                  when l.next_call_at < $3 then 'next_call'
                  when l.stage = 'New' and l.next_call_at is null then 'new_lead'
             end as kind
      from ids
      join public.lead_list l on l.id = ids.lead_id          -- row security on leads: only leads I can see
      left join public.program p on p.id = l.program_id
      left join fu on fu.lead_id = l.id
      left join mine on mine.lead_id = l.id
      %s
    ),
    judged as (
      select r.*,
             -- done: I called on that day at or after it was due, or the lead is closed, or nothing is due any more
             (r.called_at is not null and (r.due is null or r.closed or r.due <= r.called_at)) as done,
             case when r.best_from is null or r.best_to is null then false
                  when r.best_from = r.best_to then $4 = r.best_from
                  when r.best_from < r.best_to then $4 >= r.best_from and $4 < r.best_to
                  else $4 >= r.best_from or $4 < r.best_to end as win
      from rows r
      where r.called_at is not null or (not r.closed and r.due is not null)
    )
    select j.id, j.full_name, j.stage, j.program,
           case when j.done then null else j.due end, case when j.done then 'done' else j.kind end,
           (not j.done and j.due < now()), j.done,
           case when j.done then null else j.fu_id end, case when j.done then null else j.fu_title end,
           j.band, j.score, j.reasons, j.best_label, j.best_from, j.best_to, j.win,
           j.called_at, j.last_contact_at,
           (row_number() over (order by j.done, (j.due < now()) desc,
              case j.band when 'Hot' then 0 when 'Warm' then 1 when 'Cold' then 2 else 3 end,
              j.win desc, j.due nulls last, j.full_name, j.id))::int
    from judged j
    order by 20
    limit 500
  $q$, sig) using me, d0, d1, h;
end $$;

revoke all on function public.my_call_queue(date) from public, anon;
grant execute on function public.my_call_queue(date) to authenticated;
comment on function public.my_call_queue(date) is 'Start my calls: my leads to call on a day (India time), in calling order. No contact details.';
