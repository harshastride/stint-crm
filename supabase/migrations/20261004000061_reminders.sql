-- 061: Automatic reminders. Rules pick records from real tables and queue rows in public.message
-- (status 'queued'); the sender (/api/messages/process, migration 060) delivers them.

-- Shared message contract (same definition as migration 060; whichever runs first creates it).
create table if not exists public.message (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('whatsapp','email')),
  direction text not null check (direction in ('out','in')),
  lead_id uuid null references public.lead(id) on delete cascade,
  candidate_id uuid null references public.candidate(id) on delete cascade,
  to_addr text,
  from_addr text,
  subject text,
  body text,
  template text,
  status text not null default 'queued' check (status in ('queued','sent','delivered','read','failed','received')),
  error text,
  provider_id text,
  send_after timestamptz default now(),
  created_by uuid,
  created_at timestamptz default now(),
  sent_at timestamptz
);
alter table public.message enable row level security;

-- Students can ask not to get automatic messages.
alter table public.candidate add column if not exists contact_opt_out boolean not null default false;

create table if not exists public.reminder_rule (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default false,
  trigger text not null check (trigger in ('fee_due','follow_up_due','class_tomorrow','mock_tomorrow','document_missing','lead_no_contact')),
  offset_days int not null default 0 check (offset_days between 0 and 60),
  send_time time not null default '09:00',            -- India time
  channel text not null default 'whatsapp' check (channel in ('whatsapp','email')),
  audience text not null default 'student' check (audience in ('student','staff_owner')),
  template_name text,                                  -- approved WhatsApp template name, if any
  body_template text not null default 'Hi {{first_name}}',
  quiet_hours boolean not null default true,           -- no sends 9pm to 8am
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.reminder_log (
  id bigint generated always as identity primary key,
  rule_id uuid not null references public.reminder_rule(id) on delete cascade,
  record_id uuid not null,
  person_id uuid not null,
  day date not null,
  message_id uuid references public.message(id) on delete set null,
  person_name text,
  created_at timestamptz not null default now(),
  unique (rule_id, person_id, day)                     -- max 1 per person per rule per day
);

alter table public.reminder_rule enable row level security;
alter table public.reminder_log enable row level security;
drop policy if exists reminder_rule_r on public.reminder_rule;
create policy reminder_rule_r on public.reminder_rule for select to authenticated using (public.can_page('reminders','r'));
drop policy if exists reminder_rule_w on public.reminder_rule;
create policy reminder_rule_w on public.reminder_rule for all to authenticated using (public.can_page('reminders','w')) with check (public.can_page('reminders','w'));
drop policy if exists reminder_log_r on public.reminder_log;
create policy reminder_log_r on public.reminder_log for select to authenticated using (public.can_page('reminders','r'));
grant select, insert, update, delete on public.reminder_rule to authenticated;
grant select on public.reminder_log to authenticated;

insert into public.page (id, grp, title, sort) values ('reminders', 'Admin settings', 'Reminders', 44) on conflict (id) do nothing;

create or replace function public.reminder_render(t text, v jsonb) returns text
language sql immutable set search_path = public as $$
  select replace(replace(replace(replace(replace(coalesce(t,''),
    '{{first_name}}', coalesce(v->>'first_name','')),
    '{{name}}', coalesce(v->>'name','')),
    '{{amount}}', coalesce(v->>'amount','')),
    '{{due_date}}', coalesce(v->>'due_date','')),
    '{{time}}', coalesce(v->>'time',''))
$$;

-- Who matches a rule on India day d. One row per (person, record).
create or replace function public.reminder_targets(r public.reminder_rule, d date)
returns table (record_id uuid, person_id uuid, person_name text, to_addr text, candidate_id uuid, lead_id uuid, opted_out boolean, vars jsonb)
language sql stable security definer set search_path = public as $$
  select * from (
  -- students
  with stu as (
    select c.id, c.full_name, c.contact_opt_out,
           case when r.channel = 'email' then p.contact->>'email' else p.contact->>'mobile' end as addr
    from candidate c left join candidate_private p on p.candidate_id = c.id
  )
  select fp.id, s.id, s.full_name, s.addr, s.id, null::uuid, s.contact_opt_out,
         jsonb_build_object('first_name', split_part(s.full_name,' ',1), 'name', s.full_name,
           'amount', '₹' || to_char(fp.amount, 'FM99,99,99,999'), 'due_date', to_char(fp.due_on, 'DD Mon'))
  from fee_payment fp join stu s on s.id = fp.candidate_id
  where r.trigger = 'fee_due' and r.audience = 'student' and fp.status in ('Due','Overdue') and fp.due_on = d + r.offset_days
  union all
  select b.id, s.id, s.full_name, s.addr, s.id, null, s.contact_opt_out,
         jsonb_build_object('first_name', split_part(s.full_name,' ',1), 'name', s.full_name,
           'due_date', to_char(d + r.offset_days, 'DD Mon'), 'time', to_char(b.class_start, 'HH12:MI AM'))
  from batch b join candidate c on c.batch_id = b.id join stu s on s.id = c.id
  where r.trigger = 'class_tomorrow' and r.audience = 'student' and b.class_start is not null
    and coalesce(b.status,'') not in ('Completed','Cancelled','Closed')
    and d + r.offset_days >= b.starts_on and d + r.offset_days <= coalesce(b.ends_on, d + r.offset_days)
    and extract(isodow from d + r.offset_days)::smallint = any (b.class_days)
  union all
  select m.id, s.id, s.full_name, s.addr, s.id, null, s.contact_opt_out,
         jsonb_build_object('first_name', split_part(s.full_name,' ',1), 'name', s.full_name,
           'due_date', to_char(m.scheduled_at at time zone 'Asia/Kolkata', 'DD Mon'), 'time', to_char(m.scheduled_at at time zone 'Asia/Kolkata', 'HH12:MI AM'))
  from mock_session m join stu s on s.id = m.candidate_id
  where r.trigger = 'mock_tomorrow' and r.audience = 'student' and m.status = 'Booked'
    and (m.scheduled_at at time zone 'Asia/Kolkata')::date = d + r.offset_days
  union all
  select c.id, s.id, s.full_name, s.addr, s.id, null, s.contact_opt_out,
         jsonb_build_object('first_name', split_part(s.full_name,' ',1), 'name', s.full_name)
  from candidate c join stu s on s.id = c.id
  where r.trigger = 'document_missing' and r.audience = 'student' and c.joined_on = d - r.offset_days
    and exists (select 1 from candidate_document cd where cd.candidate_id = c.id and cd.status = 'Missing')
  union all
  -- staff owners
  select f.id, st.id, st.full_name, st.email, f.candidate_id, f.lead_id, false,
         jsonb_build_object('first_name', split_part(st.full_name,' ',1), 'name', f.title,
           'due_date', to_char(f.due_at at time zone 'Asia/Kolkata', 'DD Mon'), 'time', to_char(f.due_at at time zone 'Asia/Kolkata', 'HH12:MI AM'))
  from follow_up f join staff st on st.id = f.owner_id
  where r.trigger = 'follow_up_due' and r.audience = 'staff_owner' and f.status = 'Open' and st.status is distinct from 'Inactive'
    and (f.due_at at time zone 'Asia/Kolkata')::date = d + r.offset_days
  union all
  select l.id, st.id, st.full_name, st.email, null, l.id, false,
         jsonb_build_object('first_name', split_part(st.full_name,' ',1), 'name', l.full_name,
           'due_date', to_char(l.created_at at time zone 'Asia/Kolkata', 'DD Mon'))
  from lead l join staff st on st.id = l.owner_id
  where r.trigger = 'lead_no_contact' and r.audience = 'staff_owner' and l.stage = 'New'
    and l.created_at <= now() - make_interval(days => greatest(r.offset_days,1))
    and l.created_at >  now() - make_interval(days => greatest(r.offset_days,1) + 1)
    and not exists (select 1 from call_log cl where cl.lead_id = l.id)
  ) x where current_user not in ('authenticated','anon')   -- only callable from the functions below, even if EXECUTE is granted
$$;
revoke all on function public.reminder_targets(public.reminder_rule, date) from public, anon, authenticated;

-- Core: p_dry = true returns who would get it and queues nothing.
create or replace function public.reminders_core(p_dry boolean, p_rule uuid default null, p_force boolean default false)
returns table (rule_id uuid, rule_name text, person_name text, body text, opted_out boolean, already_sent boolean, queued boolean)
language plpgsql security definer set search_path = public as $$
declare
  now_ist timestamp := now() at time zone 'Asia/Kolkata';
  d date := (now() at time zone 'Asia/Kolkata')::date;
  r public.reminder_rule;
  t record;
  txt text;
  mid uuid;
  logged boolean;
  seen uuid[];
begin
  -- Signed-in users may only dry-run, and only with access to the Reminders page (guards against broad EXECUTE grants).
  if coalesce(auth.role(),'') in ('authenticated','anon') and (not p_dry or not public.can_page('reminders','r')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  for r in select * from reminder_rule x where (p_rule is null or x.id = p_rule) and (p_dry or x.active) order by x.name loop
    if not p_dry and not p_force then
      continue when now_ist::time < r.send_time;
      continue when r.quiet_hours and (now_ist::time < '08:00' or now_ist::time >= '21:00');
    end if;
    seen := '{}';
    for t in select * from reminder_targets(r, d) loop
      continue when t.person_id = any (seen);            -- one per person per rule per run
      seen := seen || t.person_id;
      txt := reminder_render(r.body_template, t.vars);
      logged := exists (select 1 from reminder_log l where l.rule_id = r.id and l.person_id = t.person_id and l.day = d);
      rule_id := r.id; rule_name := r.name; person_name := t.person_name; body := txt;
      opted_out := t.opted_out; already_sent := logged; queued := false;
      if not p_dry and not logged and not t.opted_out and coalesce(t.to_addr,'') <> '' then
        insert into reminder_log (rule_id, record_id, person_id, day, person_name)
          values (r.id, t.record_id, t.person_id, d, t.person_name)
          on conflict do nothing;
        if found then
          insert into message (channel, direction, lead_id, candidate_id, to_addr, subject, body, template, status, send_after, created_by)
            values (r.channel, 'out', t.lead_id, t.candidate_id, t.to_addr,
                    case when r.channel = 'email' then 'Reminder: ' || r.name end,
                    txt, r.template_name, 'queued', now(), r.created_by)
            returning id into mid;
          update reminder_log set message_id = mid where reminder_log.rule_id = r.id and reminder_log.person_id = t.person_id and reminder_log.day = d;
          queued := true;
        end if;
      end if;
      return next;
    end loop;
  end loop;
end $$;
revoke all on function public.reminders_core(boolean, uuid, boolean) from public, anon, authenticated;
grant execute on function public.reminders_core(boolean, uuid, boolean) to service_role;

-- Scheduled job entry point (pg_cron / service role only).
create or replace function public.run_reminders() returns int
language sql security definer set search_path = public as $$
  select count(*)::int from public.reminders_core(false) where queued
$$;
revoke all on function public.run_reminders() from public, anon, authenticated;
grant execute on function public.run_reminders() to service_role;

-- Dry run for the Reminders page: names and text only, nothing is sent.
create or replace function public.preview_reminders(p_rule uuid default null)
returns table (rule_id uuid, rule_name text, person_name text, body text, opted_out boolean, already_sent boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_page('reminders','r') then raise exception 'not allowed' using errcode = '42501'; end if;
  return query select c.rule_id, c.rule_name, c.person_name, c.body, c.opted_out, c.already_sent from public.reminders_core(true, p_rule) c;
end $$;
revoke all on function public.preview_reminders(uuid) from public, anon;
grant execute on function public.preview_reminders(uuid) to authenticated;

-- Every 15 minutes.
do $$ begin
  perform cron.unschedule('stint-reminders') where exists (select 1 from cron.job where jobname = 'stint-reminders');
  perform cron.schedule('stint-reminders', '*/15 * * * *', 'select public.run_reminders()');
exception when others then raise notice 'pg_cron not available: %', sqlerrm;
end $$;
