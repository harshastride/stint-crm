-- Stint CRM · QR check-in (optional). A trainer opens a check-in for today's class of a batch; the screen
-- shows a QR + 6-character code that changes every 30 seconds. A signed-in student scans it (or types the code)
-- and is marked Present in the normal attendance table. Nothing here runs unless a trainer opens a check-in.
--
-- Code = 6 characters from HMAC-SHA256(secret, session_id|window), window = 30-second slot. A code is accepted
-- in its own slot and the next one (30–60 s life). The secret never leaves the database.
-- A student can only ever mark themselves, only for the batch they belong to, only for the session's day.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.checkin_session (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batch (id) on delete cascade,
  day date not null,
  created_by uuid references public.staff (id),
  active boolean not null default true,
  secret bytea not null default extensions.gen_random_bytes(32),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists checkin_session_batch_day on public.checkin_session (batch_id, day) where active;

create table if not exists public.checkin_log (
  id bigint generated always as identity primary key,
  session_id uuid references public.checkin_session (id) on delete cascade,
  user_id uuid,
  candidate_id uuid references public.candidate (id) on delete cascade,
  ok boolean not null,
  reason text not null,
  at timestamptz not null default now()
);
create index if not exists checkin_log_user_at on public.checkin_log (user_id, at);
create index if not exists checkin_log_session on public.checkin_log (session_id) where ok;

alter table public.checkin_session enable row level security;
alter table public.checkin_log enable row level security;
-- Staff who can see attendance can see sessions and the log; the secret column is never granted.
revoke all on public.checkin_session, public.checkin_log from anon, authenticated;
grant select (id, batch_id, day, created_by, active, created_at, closed_at) on public.checkin_session to authenticated;
grant select on public.checkin_log to authenticated;
drop policy if exists checkin_session_read on public.checkin_session;
create policy checkin_session_read on public.checkin_session for select to authenticated using (public.can_page('attendance', 'r'));
drop policy if exists checkin_log_read on public.checkin_log;
create policy checkin_log_read on public.checkin_log for select to authenticated using (public.can_page('attendance', 'r'));

create or replace function public.checkin_today() returns date
language sql stable set search_path = public as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

create or replace function public.checkin_code(p_session uuid, p_window bigint) returns text
language sql stable security definer set search_path = public, extensions as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', get_byte(h, i) % 31 + 1, 1), '' order by i)
  from (select extensions.hmac(convert_to(s.id::text || '|' || p_window, 'UTF8'), s.secret, 'sha256') as h
        from public.checkin_session s where s.id = p_session) x, generate_series(0, 5) i
$$;
revoke all on function public.checkin_code(uuid, bigint) from public, anon, authenticated;

-- who may run a check-in for a batch: attendance write and (trainer of that batch, or Admin)
create or replace function public.checkin_can_run(p_batch uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_page('attendance', 'w')
     and (public.is_admin() or exists (select 1 from public.batch b where b.id = p_batch and b.trainer_id = auth.uid()))
$$;
revoke all on function public.checkin_can_run(uuid) from public, anon, authenticated;

create or replace function public.open_checkin(p_batch uuid) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare sid uuid;
begin
  if not public.checkin_can_run(p_batch) then raise exception 'Only the trainer of this batch can open a check-in' using errcode = '42501'; end if;
  update checkin_session set active = false, closed_at = now() where batch_id = p_batch and active;
  insert into checkin_session (batch_id, day, created_by) values (p_batch, public.checkin_today(), auth.uid()) returning id into sid;
  return sid;
end $$;

create or replace function public.close_checkin(p_session uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare b uuid;
begin
  select batch_id into b from checkin_session where id = p_session;
  if b is null or not public.checkin_can_run(b) then raise exception 'Not allowed' using errcode = '42501'; end if;
  update checkin_session set active = false, closed_at = now() where id = p_session and active;
end $$;

-- Live screen data for the trainer: current code, seconds left, count and arrivals.
create or replace function public.current_checkin_token(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s record; w bigint := floor(extract(epoch from now()) / 30);
begin
  select * into s from checkin_session where id = p_session;
  if s.id is null or not public.checkin_can_run(s.batch_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'active', s.active and s.day = public.checkin_today(),
    'code', case when s.active then public.checkin_code(s.id, w) end,
    'seconds_left', ((w + 1) * 30 - extract(epoch from now()))::int,
    'day', s.day,
    'total', (select count(*) from candidate c where c.batch_id = s.batch_id),
    'present', (select count(*) from attendance a join candidate c on c.id = a.candidate_id and c.batch_id = s.batch_id
                where a.batch_id = s.batch_id and a.day = s.day and a.mark in ('P', 'L')),
    -- one line per student who checked in by QR today and is still marked present or late
    'arrived', coalesce((select jsonb_agg(jsonb_build_object('name', y.full_name, 'at', y.at) order by y.at desc) from (
                select c.full_name, min(l.at) as at
                from checkin_log l join checkin_session x on x.id = l.session_id join candidate c on c.id = l.candidate_id
                join attendance a on a.candidate_id = l.candidate_id and a.day = x.day and a.mark in ('P', 'L')
                where x.batch_id = s.batch_id and x.day = s.day and l.ok group by c.id, c.full_name) y), '[]'::jsonb));
end $$;

-- The student's side. Returns {status: 'present' | 'already' | 'invalid', batch | message}.
create or replace function public.student_checkin(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare cid uuid := public.my_candidate(); cb uuid; bcode text; s record; code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  w bigint := floor(extract(epoch from now()) / 30); ins int;
begin
  if auth.uid() is null or cid is null then raise exception 'Sign in to the student portal to check in' using errcode = '42501'; end if;
  if (select count(*) from checkin_log where user_id = auth.uid() and not ok and at > now() - interval '5 minutes') >= 8 then
    raise exception 'Too many wrong codes. Wait 5 minutes and try again.' using errcode = 'P0001';
  end if;
  select c.batch_id, b.code into cb, bcode from candidate c left join batch b on b.id = c.batch_id where c.id = cid;
  -- only sessions of the student's own batch, for today, opened in the last 12 hours
  select * into s from checkin_session x
   where x.batch_id = cb and x.active and x.day = public.checkin_today() and x.created_at > now() - interval '12 hours'
     and code in (public.checkin_code(x.id, w), public.checkin_code(x.id, w - 1))
   order by x.created_at desc limit 1;
  if s.id is null then
    insert into checkin_log (user_id, candidate_id, ok, reason) values (auth.uid(), cid, false,
      case when cb is null then 'no batch' when length(code) <> 6 then 'bad format' else 'wrong or expired code' end);
    -- returned, not raised, so the failed try stays in the log and counts toward the rate limit
    return jsonb_build_object('status', 'invalid', 'message', 'That code is not valid for your class right now. Scan the QR again or type the code on the screen.');
  end if;
  insert into attendance (batch_id, candidate_id, day, mark) values (s.batch_id, cid, s.day, 'P')
    on conflict (candidate_id, day) do nothing;
  get diagnostics ins = row_count;
  if ins = 1 then insert into checkin_log (session_id, user_id, candidate_id, ok, reason) values (s.id, auth.uid(), cid, true, 'checked in'); end if;
  return jsonb_build_object('status', case when ins = 1 then 'present' else 'already' end, 'batch', bcode);
end $$;

revoke all on function public.open_checkin(uuid), public.close_checkin(uuid), public.current_checkin_token(uuid), public.student_checkin(text) from public, anon;
grant execute on function public.open_checkin(uuid), public.close_checkin(uuid), public.current_checkin_token(uuid), public.student_checkin(text) to authenticated;
