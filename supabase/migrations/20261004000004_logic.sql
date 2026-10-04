-- Stint CRM · business logic that must never be skipped, so it lives in the database

-- 1. Status history: one row every time a stage or status changes
create or replace function public.log_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  col text := tg_argv[0];
  what text := tg_argv[1];
  old_v text; new_v text; who text;
begin
  execute format('select ($1).%I::text, ($2).%I::text', col, col) into old_v, new_v using old, new;
  if old_v is distinct from new_v then
    if tg_table_name in ('lead', 'candidate') then
      who := new.full_name;
    elsif to_jsonb(new) ? 'candidate_id' then
      select full_name into who from public.candidate where id = (to_jsonb(new) ->> 'candidate_id')::uuid;
    elsif to_jsonb(new) ? 'lead_id' then
      select full_name into who from public.lead where id = (to_jsonb(new) ->> 'lead_id')::uuid;
    end if;
    insert into public.status_history (entity, entity_id, person_name, what, from_value, to_value, by_id)
    values (tg_table_name, new.id, who, what, old_v, new_v, auth.uid());
  end if;
  return new;
end $$;

create trigger lead_stage_history after update of stage on public.lead for each row execute function public.log_status_change('stage', 'Lead stage');
create trigger candidate_stage_history after update of stage on public.candidate for each row execute function public.log_status_change('stage', 'Candidate stage');
create trigger resume_status_history after update of status on public.resume_version for each row execute function public.log_status_change('status', 'Resume status');
create trigger mock_status_history after update of status on public.mock_session for each row execute function public.log_status_change('status', 'Mock result');
create trigger payment_status_history after update of status on public.fee_payment for each row execute function public.log_status_change('status', 'Fee payment');
create trigger quote_status_history after update of status on public.fee_quote for each row execute function public.log_status_change('status', 'Fee quote');

create or replace function public.touch_stage_changed() returns trigger
language plpgsql as $$
begin
  if new.stage is distinct from old.stage then new.stage_changed_at := now(); end if;
  return new;
end $$;
create trigger lead_stage_touch before update of stage on public.lead for each row execute function public.touch_stage_changed();
create trigger candidate_stage_touch before update of stage on public.candidate for each row execute function public.touch_stage_changed();

-- 2. New lead with no owner: give it to the active telecaller with the fewest open leads
create or replace function public.assign_lead_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is null then new.created_by := auth.uid(); end if;
  if new.owner_id is null then
    select s.id into new.owner_id
    from public.staff s
    left join public.lead l on l.owner_id = s.id and l.stage not in ('Converted', 'Not interested')
    where s.role = 'Telecaller' and s.status = 'Active'
    group by s.id
    order by count(l.id), min(s.full_name)
    limit 1;
  end if;
  return new;
end $$;
create trigger lead_assign before insert on public.lead for each row execute function public.assign_lead_owner();

-- 3. Lead marked Converted: create the candidate, carry the contact details, start the fee plan
create sequence if not exists public.candidate_code_seq start 413;

create or replace function public.convert_lead() returns trigger
language plpgsql security definer set search_path = public as $$
declare cid uuid; q record;
begin
  if new.stage = 'Converted' and old.stage is distinct from 'Converted'
     and not exists (select 1 from public.candidate where lead_id = new.id) then
    insert into public.candidate (code, full_name, lead_id, program_id, stage, poc_id, profile)
    values ('STA-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.candidate_code_seq')::text, 4, '0'),
            new.full_name, new.id, new.program_id, 'Enrolled', null,
            jsonb_strip_nulls(jsonb_build_object('referred_by', new.referred_by)))
    returning id into cid;
    insert into public.candidate_private (candidate_id, contact)
    values (cid, jsonb_strip_nulls(jsonb_build_object('mobile', new.mobile, 'email', new.email, 'city', new.city)));
    select * into q from public.fee_quote where lead_id = new.id and status = 'Accepted' order by created_at desc limit 1;
    if found then
      insert into public.fee_plan (candidate_id, total, plan) values (cid, q.amount, q.plan);
    end if;
    insert into public.follow_up (title, candidate_id, owner_role, due_at) values
      ('Finish the data sheet', cid, 'Front desk', now()),
      ('Assign a batch', cid, 'HR / Counsellor', now()),
      ('Record the first payment', cid, 'Finance', now());
  end if;
  return new;
end $$;
create trigger lead_convert after update of stage on public.lead for each row execute function public.convert_lead();

-- 4. A discount above the limit needs the Sales head before it counts as sent
create or replace function public.quote_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim numeric := coalesce((select value::numeric from public.setting where key = 'discount_approval_limit_pct'), 10);
begin
  new.amount := round(new.list_price * (100 - new.discount_pct) / 100, -2);
  new.needs_approval := new.discount_pct > lim and new.approved_by is null;
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  return new;
end $$;
create trigger quote_rules before insert or update of list_price, discount_pct, approved_by on public.fee_quote for each row execute function public.quote_rules();

-- 5. Sensitive candidate details, masked or hidden by role
create or replace function public.mask_text(v text) returns text
language sql immutable as $$
  select case when v is null or v = '' then v
              when length(v) <= 4 then repeat('•', length(v))
              else repeat('•', length(v) - 4) || right(v, 4) end
$$;

create or replace function public.mask_group(j jsonb, mode text) returns jsonb
language sql immutable as $$
  select case mode
    when 'f' then j
    when 'm' then coalesce((select jsonb_object_agg(key, public.mask_text(value)) from jsonb_each_text(j)), '{}'::jsonb)
    else null end
$$;

create or replace function public.candidate_private_get(cid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.candidate_private;
begin
  if not (public.can_page('candidate', 'r') or public.can_page('enrolform', 'r')) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into p from public.candidate_private where candidate_id = cid;
  return jsonb_build_object(
    'contact', public.mask_group(coalesce(p.contact, '{}'::jsonb), public.field_mode('contact')),
    'family', public.mask_group(coalesce(p.family, '{}'::jsonb), public.field_mode('family')),
    'identity', public.mask_group(coalesce(p.identity, '{}'::jsonb), public.field_mode('identity')),
    'bank', public.mask_group(coalesce(p.bank, '{}'::jsonb), public.field_mode('bank')),
    'modes', jsonb_build_object('contact', public.field_mode('contact'), 'family', public.field_mode('family'),
                                'identity', public.field_mode('identity'), 'bank', public.field_mode('bank'))
  );
end $$;

create or replace function public.candidate_private_set(cid uuid, grp text, data jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if grp not in ('contact', 'family', 'identity', 'bank') then raise exception 'Unknown group'; end if;
  if public.field_mode(grp) <> 'f' or not (public.can_page('candidate', 'w') or public.can_page('enrolform', 'w')) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into public.candidate_private (candidate_id) values (cid) on conflict do nothing;
  execute format('update public.candidate_private set %I = %I || $1, updated_at = now() where candidate_id = $2', grp, grp) using data, cid;
end $$;

-- 6. Fee balance per candidate (runs with the caller's own permissions)
create or replace view public.fee_plan_summary with (security_invoker = true) as
select fp.id, fp.candidate_id, c.full_name, c.program_id, fp.total, fp.plan,
       coalesce(sum(p.amount) filter (where p.status = 'Received'), 0) as paid,
       fp.total - coalesce(sum(p.amount) filter (where p.status = 'Received'), 0) as balance,
       min(p.due_on) filter (where p.status in ('Due', 'Overdue')) as next_due,
       bool_or(p.status = 'Overdue') as overdue,
       fp.created_at
from public.fee_plan fp
join public.candidate c on c.id = fp.candidate_id
left join public.fee_payment p on p.candidate_id = fp.candidate_id
group by fp.id, c.full_name, c.program_id;

-- 7. One person's timeline: notes, calls, stage changes and more, already filtered by what the caller may see
create or replace function public.person_timeline(p_lead uuid, p_candidate uuid) returns table (kind text, body text, by_name text, at timestamptz, visibility text)
language sql stable security invoker set search_path = public as $$
  select n.kind, n.body, s.full_name, n.created_at, n.visibility
    from note n left join staff s on s.id = n.by_id
   where (p_lead is not null and n.lead_id = p_lead) or (p_candidate is not null and n.candidate_id = p_candidate)
  union all
  select 'Call', 'Call: ' || c.outcome || coalesce(' — ' || c.notes, ''), s.full_name, c.called_at, 'Internal'
    from call_log c left join staff s on s.id = c.caller_id where p_lead is not null and c.lead_id = p_lead
  union all
  select 'Stage', h.what || ': ' || coalesce(h.from_value, '—') || ' → ' || coalesce(h.to_value, '—'), coalesce(s.full_name, 'System'), h.at, 'System'
    from status_history h left join staff s on s.id = h.by_id
   where (h.entity = 'lead' and h.entity_id = p_lead) or (h.entity = 'candidate' and h.entity_id = p_candidate)
  union all
  select 'Fee', 'Quote ' || q.amount::text || ' · ' || q.discount_pct::text || '% off · ' || q.status, s.full_name, q.created_at, 'Internal'
    from fee_quote q left join staff s on s.id = q.created_by where p_lead is not null and q.lead_id = p_lead
  union all
  select 'Mock', m.level || ' mock · ' || m.status, s.full_name, coalesce(m.scheduled_at, m.created_at), 'Internal'
    from mock_session m left join staff s on s.id = m.trainer_id where p_candidate is not null and m.candidate_id = p_candidate
  union all
  select 'Training', t.note || coalesce(' · ' || t.flag, ''), s.full_name, t.created_at, 'Internal'
    from training_note t left join staff s on s.id = t.trainer_id where p_candidate is not null and t.candidate_id = p_candidate
  union all
  select 'Resume', 'Resume ' || r.version || ' · ' || r.status, s.full_name, r.created_at, 'Internal'
    from resume_version r left join staff s on s.id = r.reviewer_id where p_candidate is not null and r.candidate_id = p_candidate
  union all
  select 'Fee', 'Payment ' || p.amount::text || ' · ' || p.status, null, coalesce(p.paid_on::timestamptz, p.due_on::timestamptz, p.created_at), 'Internal'
    from fee_payment p where p_candidate is not null and p.candidate_id = p_candidate
  order by 4 desc
$$;

grant execute on all functions in schema public to authenticated, service_role;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
