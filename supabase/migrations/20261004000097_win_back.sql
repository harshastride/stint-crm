-- 097 · Win-back list: leads we already paid for that were lost (Not interested) or went quiet come back after a
-- cooling period, with why they were lost, so a telecaller can send a message that answers that reason and put them
-- back into calling with one tap. Safe to re-run.
--
-- Privacy decision: the 30-day rule (048) hides closed leads and old notes from staff. Win-back needs exactly those
-- leads, so winback_list is a definer view (owned by postgres, row security of lead is not used) that applies the
-- lead's scope rule itself (lead_row_visible: own / team leads) and shows only what the list needs: name, course,
-- owner, reason, dates, a short note snippet with every number and email removed. Never mobile or email.
-- The lead becomes a normal visible lead again (and its contact can be revealed) only after "Back to calling".

-- 1. Settings
insert into public.setting (key, value) values ('winback_after_days', '60'), ('winback_max_tries', '2')
on conflict (key) do nothing;

-- 2. Page and default grants (Admin passes all)
insert into public.page (id, grp, title, sort) values ('winback', 'Telecalling', 'Win-back', 9) on conflict (id) do nothing;
select public.page_place('winback', 'recordings');   -- last under Telecalling
-- Grants for roles that exist (a fresh database gets them from seed.sql)
insert into public.role_page_access (role, page_id, mode)
select name, 'winback', 'w' from public.app_role where name in ('Telecaller', 'Sales')
union all select name, 'winback', 'r' from public.app_role where name = 'Marketing'
on conflict do nothing;

-- 3. Stage rule: a lost lead may go straight back to Callback (it still needs a next call time, which win-back sets).
--    Admin can switch this move off under Stage rules; win-back then uses Not interested → New if that is on.
insert into public.stage_transition (kind, from_stage, to_stage) values ('lead', 'Not interested', 'Callback') on conflict do nothing;

-- 4. Attempts: every Copy / Send / Back to calling / Not now on the list
create table if not exists public.winback_attempt (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.lead (id) on delete cascade,
  by_id uuid references public.staff (id) on delete set null default auth.uid(),
  message text check (message is null or length(message) <= 4000),
  channel text not null default 'none' check (channel in ('none', 'copy', 'whatsapp')),
  outcome text not null check (outcome in ('copied', 'sent', 'reopened', 'skipped')),
  lost_reason text,                       -- the reason at the time, kept because reopening clears it on the lead
  created_at timestamptz not null default now()
);
create index if not exists winback_attempt_lead_idx on public.winback_attempt (lead_id, created_at desc);
create index if not exists winback_attempt_month_idx on public.winback_attempt (created_at) where outcome = 'reopened';
create index if not exists message_lead_out_idx on public.message (lead_id, created_at desc) where direction = 'out';

-- Same digit/email removal as the server's scrub(), but stricter: every run of digits goes (phone, ID, account, amounts).
create or replace function public.winback_scrub(p text, p_max int default 160) returns text
language sql immutable set search_path = public as $$
  select nullif(left(regexp_replace(regexp_replace(regexp_replace(coalesce(p, ''),
           '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+', '[email]', 'g'),
           '\+?[0-9]([0-9 ().,/-]*[0-9])?', '[number]', 'g'),
           '\s+', ' ', 'g'), greatest(p_max, 20)), '')
$$;

-- 5. The list. One row per lead the caller may work on, past the cooling period, not contacted since,
--    not tried too often, and not put aside ("Not now") or brought back within the cooling period.
drop view if exists public.winback_list;
create view public.winback_list with (security_invoker = false) as
with cfg as (
  -- settings read inline: staff may not call setting_int, and functions in a view run with the reader's rights
  select coalesce((select nullif(trim(value), '')::int from public.setting where key = 'winback_after_days'), 60) as d,
         coalesce((select nullif(trim(value), '')::int from public.setting where key = 'winback_max_tries'), 2) as t,
         (now() at time zone 'Asia/Kolkata')::date as today
), base as (
  select l.id, l.full_name, l.stage, l.lost_reason, l.program_id, l.course_other, l.owner_id, l.created_by,
         l.stage_changed_at, l.next_call_at, l.marketing_consent, l.created_at,
         c.last_call, c.last_outcome, nt.last_note_at, m.last_out, a.tries, a.last_hold, n.body as note_body,
         cfg.d, cfg.t, cfg.today
  from public.lead l
  cross join cfg
  left join lateral (select max(x.called_at) as last_call, (array_agg(x.outcome order by x.called_at desc))[1] as last_outcome
                     from public.call_log x where x.lead_id = l.id) c on true
  left join lateral (select max(x.created_at) as last_note_at from public.note x where x.lead_id = l.id) nt on true
  left join lateral (select max(x.created_at) as last_out from public.message x where x.lead_id = l.id and x.direction = 'out') m on true
  left join lateral (select count(*) filter (where x.outcome = 'reopened') as tries,
                            max(x.created_at) filter (where x.outcome in ('reopened', 'skipped')) as last_hold
                     from public.winback_attempt x where x.lead_id = l.id) a on true
  left join lateral (select y.body from (
                       select x.body, x.created_at from public.note x where x.lead_id = l.id and trim(coalesce(x.body, '')) <> ''
                       union all
                       select x.notes, x.called_at from public.call_log x where x.lead_id = l.id and trim(coalesce(x.notes, '')) <> ''
                     ) y order by y.created_at desc limit 1) n on true
  where public.can_page('winback', 'r')
    and l.stage in ('Not interested', 'New', 'Callback', 'Interested', 'Counselling')
    and l.stage_changed_at < now() - make_interval(days => cfg.d)
    and public.lead_row_visible(l.stage, l.owner_id, l.created_by)
), shaped as (
  select b.*,
         case when b.stage = 'Not interested' then 'Lost' else 'Went quiet' end as kind,
         case when b.stage = 'Not interested' then b.stage_changed_at
              else greatest(b.stage_changed_at, b.last_call, b.last_note_at, b.last_out) end as since_at,
         greatest(b.last_call, b.last_out) as last_contact_at
  from base b
)
select s.id as lead_id, s.full_name, split_part(trim(s.full_name), ' ', 1) as first_name, s.stage, s.kind,
       case when s.kind = 'Lost' then coalesce(nullif(trim(s.lost_reason), ''), 'No reason recorded') else 'Went quiet' end as reason_group,
       nullif(trim(s.lost_reason), '') as lost_reason,
       s.program_id, coalesce(p.name, nullif(trim(s.course_other), '')) as course,
       s.owner_id, o.full_name as owner_name,
       s.since_at, s.today - (s.since_at at time zone 'Asia/Kolkata')::date as days_since,
       s.last_contact_at, s.last_outcome,
       public.winback_scrub(s.note_body, 160) as last_note,
       s.tries::int as tries, s.t as max_tries, s.marketing_consent, s.created_at,
       case when s.kind = 'Lost' then
              format('Said not interested %s days ago (%s). Not contacted since.', s.today - (s.since_at at time zone 'Asia/Kolkata')::date,
                     coalesce(nullif(trim(s.lost_reason), ''), 'no reason recorded'))
            else
              format('No contact for %s days%s.', s.today - (s.since_at at time zone 'Asia/Kolkata')::date,
                     case when s.last_outcome is not null then '; last call: ' || s.last_outcome else '; never reached on a call' end)
       end
       || case when s.tries > 0 then format(' Brought back %s of %s times before.', s.tries, s.t) else '' end as why
from shaped s
left join public.program p on p.id = s.program_id
left join public.staff o on o.id = s.owner_id
where s.since_at < now() - make_interval(days => s.d)
  and (s.kind = 'Went quiet' or (coalesce(s.last_call, '-infinity') < s.stage_changed_at and coalesce(s.last_out, '-infinity') < s.stage_changed_at))
  and (s.kind = 'Lost' or s.next_call_at is null or s.next_call_at < now() - make_interval(days => s.d))
  and (s.kind = 'Lost' or not exists (select 1 from public.follow_up f where f.lead_id = s.id and f.status = 'Open' and f.due_at >= now()))
  and s.tries < s.t
  and (s.last_hold is null or s.last_hold < now() - make_interval(days => s.d));

comment on view public.winback_list is 'Win-back list (097). Definer view: applies can_page(winback) and lead_row_visible itself; never mobile/email; note snippet has numbers and emails removed.';
revoke all on public.winback_list from anon, public;
grant select on public.winback_list to authenticated, service_role;

-- 6. Who may act on a lead from Win-back: it is on their list, or it is a lead they can see anyway (same rule as reading a lead).
create or replace function public.winback_can_see(p_lead uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_lead is not null and public.my_role() is not null and (
       public.is_admin()
    or (public.can_page('winback', 'r') and exists (select 1 from public.winback_list w where w.lead_id = p_lead))
    or exists (select 1 from public.lead l where l.id = p_lead
                 and (public.can_page('lead', 'r') or public.can_page('enquiry', 'r'))
                 and public.lead_row_visible(l.stage, l.owner_id, l.created_by)
                 and (l.stage not in ('Not interested', 'Converted') or public.recent_enough(l.stage_changed_at))))
$$;
revoke all on function public.winback_can_see(uuid) from public, anon;
grant execute on function public.winback_can_see(uuid) to authenticated;

alter table public.winback_attempt enable row level security;
revoke all on public.winback_attempt from anon;
grant select, insert, delete on public.winback_attempt to authenticated;
revoke update on public.winback_attempt from authenticated;

drop policy if exists winback_attempt_read on public.winback_attempt;
create policy winback_attempt_read on public.winback_attempt for select to authenticated
  using (public.can_page('winback', 'r') and (public.is_admin() or by_id = auth.uid() or public.winback_can_see(lead_id)));
-- Staff log Copy / Sent / Not now as themselves, for leads they can see. "Back to calling" is written by winback_reopen only.
drop policy if exists winback_attempt_ins on public.winback_attempt;
create policy winback_attempt_ins on public.winback_attempt for insert to authenticated
  with check (public.can_page('winback', 'w') and by_id = auth.uid() and outcome in ('copied', 'sent', 'skipped')
              and public.winback_can_see(lead_id));
-- Undo of "Not now" for a few minutes; Admin can remove any row (it goes to the Recycle bin).
drop policy if exists winback_attempt_del on public.winback_attempt;
create policy winback_attempt_del on public.winback_attempt for delete to authenticated
  using (public.is_admin() or (by_id = auth.uid() and outcome = 'skipped' and created_at > now() - interval '10 minutes'));

drop trigger if exists aa_bin on public.winback_attempt;
create trigger aa_bin before delete on public.winback_attempt for each row execute function public.bin_row();
drop trigger if exists zz_audit on public.winback_attempt;
create trigger zz_audit after insert or update or delete on public.winback_attempt for each row execute function public.audit_row();

-- 7. What the message writer needs (server calls this as the signed-in staff member): reason, course, last notes
--    with numbers and emails removed, and earlier win-back messages so it does not repeat itself. Never contact details.
create or replace function public.winback_context(p_lead uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare w_kind text; w_reason text; w_days int; w_outcome text; l record; out jsonb;
begin
  if not public.can_page('winback', 'r') or not public.winback_can_see(p_lead) then
    raise exception 'You can’t see this lead.' using errcode = '42501';
  end if;
  select kind, reason_group, days_since, last_outcome into w_kind, w_reason, w_days, w_outcome from public.winback_list where lead_id = p_lead;
  select x.full_name, x.stage, x.lost_reason, x.program_id, coalesce(p.name, nullif(trim(x.course_other), '')) as course,
         x.currently, x.preferred_mode, x.preferred_start
    into l from public.lead x left join public.program p on p.id = x.program_id where x.id = p_lead;
  if l.full_name is null then raise exception 'Lead not found.' using errcode = 'P0002'; end if;
  select jsonb_build_object(
    'first_name', split_part(trim(l.full_name), ' ', 1),
    'stage', l.stage, 'kind', w_kind, 'reason', coalesce(w_reason, nullif(trim(l.lost_reason), '')),
    'days_since', w_days, 'last_outcome', w_outcome,
    'program_id', l.program_id, 'course', l.course,
    'currently', public.winback_scrub(l.currently, 80), 'preferred_mode', l.preferred_mode, 'preferred_start', public.winback_scrub(l.preferred_start, 60),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('on', to_char(y.at at time zone 'Asia/Kolkata', 'DD Mon YYYY'), 'what', y.what, 'text', public.winback_scrub(y.body, 300)) order by y.at desc)
                         from (select * from (
                                 select x.created_at as at, x.kind as what, x.body from public.note x where x.lead_id = p_lead and trim(coalesce(x.body, '')) <> ''
                                 union all
                                 select x.called_at, 'Call: ' || x.outcome, coalesce(x.notes, '') from public.call_log x where x.lead_id = p_lead
                               ) z order by z.at desc limit 6) y), '[]'::jsonb),
    'earlier_messages', coalesce((select jsonb_agg(public.winback_scrub(a.message, 400) order by a.created_at desc)
                                    from (select message, created_at from public.winback_attempt
                                          where lead_id = p_lead and message is not null order by created_at desc limit 2) a), '[]'::jsonb)
  ) into out;
  return out;
end $$;
revoke all on function public.winback_context(uuid) from public, anon;
grant execute on function public.winback_context(uuid) to authenticated;

-- 8. Back to calling: lost leads move to Callback (stage rules still apply: the trigger checks the move and the
--    next call time), quiet leads keep their stage (New moves to Callback when the rules allow). A next call is set,
--    and a follow-up is made for the lead's owner (the follow-up trigger tells them). The reason is kept on the attempt.
create or replace function public.winback_reopen(p_lead uuid, p_message text default null, p_channel text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  l public.lead; w_reason text; w_days int; found_it boolean; target text; nxt timestamptz; ist timestamp; own uuid; own_role text; own_name text; fid uuid;
  reason text; ch text := coalesce(nullif(p_channel, ''), 'none');
begin
  if not public.can_page('winback', 'w') then raise exception 'Your role can’t bring leads back to calling.' using errcode = '42501'; end if;
  if ch not in ('none', 'copy', 'whatsapp') then raise exception 'Unknown channel.' using errcode = '22023'; end if;
  select reason_group, days_since, true into w_reason, w_days, found_it from public.winback_list where lead_id = p_lead;
  if found_it is null then
    if public.winback_can_see(p_lead) then raise exception 'This lead is no longer on the win-back list.' using errcode = '23514'; end if;
    raise exception 'You can’t see this lead.' using errcode = '42501';
  end if;
  select * into l from public.lead where id = p_lead for update;
  reason := w_reason;

  -- next call: in 30 minutes during 9 am – 6 pm India time, otherwise 10 am the next working morning
  ist := now() at time zone 'Asia/Kolkata';
  nxt := case when extract(hour from ist) >= 9 and extract(hour from ist) < 18 then now() + interval '30 minutes'
              when extract(hour from ist) < 9 then (date_trunc('day', ist) + interval '10 hours') at time zone 'Asia/Kolkata'
              else (date_trunc('day', ist) + interval '1 day 10 hours') at time zone 'Asia/Kolkata' end;

  -- the owner stays, unless there is none or they have left: then the person bringing the lead back
  own := l.owner_id;
  if own is null or not exists (select 1 from public.staff s where s.id = own and s.status = 'Active') then own := auth.uid(); end if;
  select s.role, s.full_name into own_role, own_name from public.staff s where s.id = own;

  if l.stage = 'Not interested' then
    target := case when exists (select 1 from public.stage_transition where kind = 'lead' and from_stage = 'Not interested' and to_stage = 'Callback' and active) then 'Callback'
                   when exists (select 1 from public.stage_transition where kind = 'lead' and from_stage = 'Not interested' and to_stage = 'New' and active) then 'New'
                   else 'Callback' end;   -- the stage guard explains which moves are allowed
  elsif l.stage = 'New' and jsonb_array_length(public.stage_unmet('lead', l.id, 'New', 'Callback',
            jsonb_build_object('id', l.id, 'next_call_at', nxt, 'lost_reason', l.lost_reason))) = 0 then
    target := 'Callback';
  else
    target := l.stage;
  end if;

  if target is distinct from l.stage then
    update public.lead set stage = target, next_call_at = nxt, owner_id = own, lost_reason = null where id = p_lead;
  else
    update public.lead set next_call_at = nxt, owner_id = own where id = p_lead;
  end if;

  if not exists (select 1 from public.follow_up where lead_id = p_lead and status = 'Open' and title like 'Win-back call%') then
    insert into public.follow_up (title, lead_id, owner_id, owner_role, due_at, created_by)
    values (left('Win-back call: ' || reason, 120), p_lead, own, own_role, nxt, auth.uid())
    returning id into fid;
  end if;

  insert into public.winback_attempt (lead_id, by_id, message, channel, outcome, lost_reason)
  values (p_lead, auth.uid(), nullif(left(trim(coalesce(p_message, '')), 4000), ''), ch, 'reopened', l.lost_reason);

  insert into public.note (lead_id, kind, body, by_id)
  values (p_lead, 'Note', format('Back to calling from the Win-back list (%s, %s days).', reason, w_days), auth.uid());

  perform public.emit_event('lead.won_back', 'lead', p_lead, l.full_name,
    jsonb_build_object('lead', public.lead_brief(p_lead), 'reason', reason, 'days_since', w_days, 'by', (select full_name from public.staff where id = auth.uid())));

  return jsonb_build_object('stage', target, 'next_call_at', nxt, 'owner_id', own, 'owner_name', own_name, 'follow_up_id', fid);
end $$;
revoke all on function public.winback_reopen(uuid, text, text) from public, anon;
grant execute on function public.winback_reopen(uuid, text, text) to authenticated;

-- 9. Top of the page: how many can be won back now, and how many came back this month (India time) and moved on since.
create or replace function public.winback_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m0 timestamptz := (date_trunc('month', now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata'; out jsonb;
begin
  if not public.can_page('winback', 'r') then raise exception 'Not allowed' using errcode = '42501'; end if;
  with back as (
    select distinct a.lead_id from public.winback_attempt a join public.lead l on l.id = a.lead_id
     where a.outcome = 'reopened' and a.created_at >= m0
       and (public.is_admin() or a.by_id = auth.uid() or public.lead_row_visible(l.stage, l.owner_id, l.created_by))
  )
  select jsonb_build_object(
    'can_win_back', (select count(*) from public.winback_list),
    'back_this_month', (select count(*) from back),
    'moved_on_this_month', (select count(*) from back b join public.lead l on l.id = b.lead_id where l.stage in ('Interested', 'Counselling', 'Converted')),
    'joined_this_month', (select count(*) from back b join public.lead l on l.id = b.lead_id where l.stage = 'Converted'),
    'month_start', (m0 at time zone 'Asia/Kolkata')::date,
    'after_days', public.setting_int('winback_after_days', 60),
    'max_tries', public.setting_int('winback_max_tries', 2)
  ) into out;
  return out;
end $$;
revoke all on function public.winback_summary() from public, anon;
grant execute on function public.winback_summary() to authenticated;
