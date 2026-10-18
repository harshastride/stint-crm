-- Teams alerts: CRM events posted to Microsoft Teams channels, one channel per role (or one for everyone).
-- The Admin page "Teams alerts" stores each channel's Workflows link and which events go to which role.
-- Every event already lands in integration_event (the Activepieces outbox); a trigger there queues one
-- teams_message per matching role channel, and the app sends the queue (/api/teams/send, every minute).
-- Contact details (mobile, email) are stripped before anything is queued for Teams.

insert into public.page (id, grp, title, sort) values ('teams', 'Admin settings', 'Teams alerts', 45)
on conflict (id) do nothing;   -- Admin only (no grants: Admin sees all pages)

-- 1. Channels: one per audience (a role name, or 'Everyone'). The link is a secret: anyone holding it can post.
create table if not exists public.teams_channel (
  id uuid primary key default gen_random_uuid(),
  audience text not null unique,
  name text not null,                       -- what the Admin calls it, e.g. "Finance team"
  webhook_url_secret text not null,         -- Teams Workflows link ("secret" in the name keeps it out of the audit log)
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.teams_channel_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.audience <> 'Everyone' and not exists (select 1 from public.app_role where name = new.audience) then
    raise exception 'Unknown role for a Teams channel: %', new.audience using errcode = '22023';
  end if;
  if new.webhook_url_secret !~* '^https://[^/]+\.(logic\.azure\.com|powerplatform\.com|powerautomate\.com|webhook\.office\.com)(:443)?/' then
    raise exception 'This is not a Teams Workflows link' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists teams_channel_check on public.teams_channel;
create trigger teams_channel_check before insert or update on public.teams_channel for each row execute function public.teams_channel_check();

-- 2. Rules: which event goes to which audience's channel.
create table if not exists public.teams_rule (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  audience text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (event, audience)
);

insert into public.teams_rule (event, audience) values
  ('candidate.created', 'Admin'), ('candidate.created', 'Front desk'), ('candidate.created', 'HR / Counsellor'), ('candidate.created', 'Finance'),
  ('attendance.absent', 'Trainer'), ('resume.rejected', 'HR / Counsellor'), ('vendor_request.created', 'Placement'),
  ('placement.recorded', 'Admin'), ('placement.recorded', 'Placement'), ('placement.recorded', 'Everyone'),
  ('counselling.booked', 'Sales'), ('payment.recorded', 'Admin'), ('payment.recorded', 'Finance'),
  ('alert.high', 'Admin'), ('summary.weekly', 'Admin')
on conflict (event, audience) do nothing;

-- 3. The send queue and log: one row per event per channel.
create table if not exists public.teams_message (
  id uuid primary key default gen_random_uuid(),
  source_event_id uuid references public.integration_event (id) on delete set null,
  event text not null,
  audience text not null,
  channel_id uuid references public.teams_channel (id) on delete set null,   -- removing a channel keeps its history
  person_name text,
  payload jsonb not null,                   -- the event, without contact details
  status text not null default 'Pending' check (status in ('Pending', 'Sending', 'Sent', 'Failed')),
  attempts int not null default 0,
  next_try_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists teams_message_due_idx on public.teams_message (status, next_try_at);
create index if not exists teams_message_created_idx on public.teams_message (created_at desc);

-- Remove contact details from an event payload (lead and candidate briefs carry mobile/email for Activepieces).
create or replace function public.teams_safe(p jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select p #- '{data,lead,mobile}' #- '{data,lead,email}' #- '{data,lead,owner_email}'
           #- '{data,candidate,mobile}' #- '{data,candidate,email}' #- '{data,candidate,owner_email}'
           #- '{data,request}'
$$;

-- Queue: each new event (the main outbox row, not per-subscription copies) → one message per matching active channel.
create or replace function public.teams_queue() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.teams_message (source_event_id, event, audience, channel_id, person_name, payload)
  select new.id, new.event, r.audience, c.id, new.person_name, public.teams_safe(new.payload)
  from public.teams_rule r join public.teams_channel c on c.audience = r.audience and c.active
  where r.event = new.event and r.active;
  return null;
end $$;
revoke execute on function public.teams_queue() from public, anon, authenticated;
drop trigger if exists teams_queue on public.integration_event;
create trigger teams_queue after insert on public.integration_event for each row when (new.subscription_id is null)
  execute function public.teams_queue();

-- 4. Two new events: a student joins (any way), and a High priority alert.
create or replace function public.events_candidate_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.emit_event('candidate.created', 'candidate', new.id, new.full_name, jsonb_build_object(
    'candidate', public.candidate_brief(new.id), 'joined_on', new.joined_on, 'from_lead', new.lead_id is not null,
    'batch', (select code from public.batch where id = new.batch_id)));
  return null;
end $$;
drop trigger if exists candidate_created_events on public.candidate;
create trigger candidate_created_events after insert on public.candidate for each row execute function public.events_candidate_created();

create or replace function public.events_alert_high() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text := coalesce((select full_name from public.candidate where id = new.candidate_id), (select full_name from public.lead where id = new.lead_id));
begin
  perform public.emit_event('alert.high', 'alert', new.id, who, jsonb_build_object(
    'alert', jsonb_build_object('title', new.title, 'area', new.area, 'priority', new.priority, 'raised_at', new.raised_at,
      'lead_id', new.lead_id, 'candidate_id', new.candidate_id, 'owner', (select full_name from public.staff where id = new.owner_id))));
  return null;
end $$;
drop trigger if exists alert_high_events on public.alert;
create trigger alert_high_events after insert on public.alert for each row when (new.priority = 'High') execute function public.events_alert_high();
revoke execute on function public.events_candidate_created(), public.events_alert_high(), public.teams_channel_check() from public, anon, authenticated;

-- 5. Row security: only whoever may open the "Teams alerts" page (Admin by default).
alter table public.teams_channel enable row level security;
alter table public.teams_rule enable row level security;
alter table public.teams_message enable row level security;
drop policy if exists teams_channel_rw on public.teams_channel;
create policy teams_channel_rw on public.teams_channel for all to authenticated using (public.can_page('teams', 'w')) with check (public.can_page('teams', 'w'));
drop policy if exists teams_rule_read on public.teams_rule;
create policy teams_rule_read on public.teams_rule for select to authenticated using (public.can_page('teams', 'r'));
drop policy if exists teams_rule_write on public.teams_rule;
create policy teams_rule_write on public.teams_rule for all to authenticated using (public.can_page('teams', 'w')) with check (public.can_page('teams', 'w'));
drop policy if exists teams_message_read on public.teams_message;
create policy teams_message_read on public.teams_message for select to authenticated using (public.can_page('teams', 'r'));
drop policy if exists teams_message_retry on public.teams_message;
create policy teams_message_retry on public.teams_message for update to authenticated using (public.can_page('teams', 'w')) with check (public.can_page('teams', 'w'));
revoke insert, delete on public.teams_message from authenticated, anon;
revoke all on public.teams_channel, public.teams_rule, public.teams_message from anon;

-- Retry from the log: only the status fields may change (the content stays what the event said).
create or replace function public.teams_message_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and (new.payload is distinct from old.payload or new.event is distinct from old.event
     or new.channel_id is distinct from old.channel_id or new.audience is distinct from old.audience) then
    raise exception 'Only the send status can be changed' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists teams_message_guard on public.teams_message;
create trigger teams_message_guard before update on public.teams_message for each row execute function public.teams_message_guard();

-- 6. Audit trail and recycle bin for the settings (the message log is a log, like integration_event).
drop trigger if exists zz_audit on public.teams_channel;
create trigger zz_audit after insert or update or delete on public.teams_channel for each row execute function public.audit_row();
drop trigger if exists zz_audit on public.teams_rule;
create trigger zz_audit after insert or update or delete on public.teams_rule for each row execute function public.audit_row();
drop trigger if exists aa_bin on public.teams_channel;
create trigger aa_bin before delete on public.teams_channel for each row execute function public.bin_row();
drop trigger if exists aa_bin on public.teams_rule;
create trigger aa_bin before delete on public.teams_rule for each row execute function public.bin_row();

-- 7. Sender: every minute, only when something is waiting (same pattern as the message sender).
create or replace function public.call_teams_sender() returns bigint
language sql security definer set search_path = public, extensions as $$
  select net.http_post(
    url := (select value from public.integration_config where key = 'app_url') || '/api/teams/send',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.integration_config where key = 'cron_secret')))
  where exists (select 1 from public.teams_message where status = 'Pending' and next_try_at <= now())
     or exists (select 1 from public.teams_message where status = 'Sending' and next_try_at < now() - interval '5 minutes')
$$;
revoke all on function public.call_teams_sender() from public, anon, authenticated;
do $$
begin
  perform cron.unschedule('teams-sender') where exists (select 1 from cron.job where jobname = 'teams-sender');
  perform cron.schedule('teams-sender', '* * * * *', 'select public.call_teams_sender()');
exception when others then raise notice 'pg_cron not available: %', sqlerrm;
end $$;
