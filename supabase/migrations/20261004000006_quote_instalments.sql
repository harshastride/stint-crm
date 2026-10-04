-- Custom instalments on quotes and fee plans: any number of parts, each with its own amount.
-- instalments = [{ "label": "On joining", "amount": 50000 }, ...]; the parts must add up to the final amount.
alter table public.fee_quote add column instalments jsonb;
alter table public.fee_plan add column instalments jsonb;

-- Equal split in hundreds; the first part takes the rounding difference.
create or replace function public.split_instalments(total numeric, parts int) returns jsonb
language sql immutable as $$
  select jsonb_agg(jsonb_build_object(
           'label', case when i = 1 then 'On joining' else 'Instalment ' || i end,
           'amount', case when i = 1 then total - round(total / parts, -2) * (parts - 1) else round(total / parts, -2) end) order by i)
  from generate_series(1, greatest(parts, 1)) i
$$;

create or replace function public.plan_parts(plan text) returns int
language sql immutable as $$
  select case when plan is null then 3 when plan ilike 'full%' then 1 else coalesce(nullif(substring(plan from '\d+'), '')::int, 3) end
$$;

create or replace function public.check_instalments(total numeric, inst jsonb) returns void
language plpgsql immutable as $$
declare n int := jsonb_array_length(inst); s numeric;
begin
  if n < 1 or n > 24 then raise exception 'Instalments must be between 1 and 24.' using errcode = '23514'; end if;
  if exists (select 1 from jsonb_array_elements(inst) e where coalesce((e->>'amount')::numeric, 0) <= 0) then
    raise exception 'Every instalment needs an amount above zero.' using errcode = '23514';
  end if;
  select sum((e->>'amount')::numeric) into s from jsonb_array_elements(inst) e;
  if s <> total then
    raise exception 'Instalments add up to % but the final amount is %.', s, total using errcode = '23514';
  end if;
end $$;

create or replace function public.quote_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim numeric := coalesce((select value::numeric from public.setting where key = 'discount_approval_limit_pct'), 10);
begin
  new.amount := round(new.list_price * (100 - new.discount_pct) / 100, -2);
  new.needs_approval := new.discount_pct > lim and new.approved_by is null;
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  -- no split given, or the price changed without a new split: split evenly
  if new.instalments is null or jsonb_array_length(new.instalments) = 0
     or (tg_op = 'UPDATE' and new.amount <> old.amount and new.instalments is not distinct from old.instalments) then
    new.instalments := split_instalments(new.amount, plan_parts(new.plan));
  end if;
  perform check_instalments(new.amount, new.instalments);
  new.plan := case when jsonb_array_length(new.instalments) = 1 then 'Full payment' else jsonb_array_length(new.instalments) || ' instalments' end;
  return new;
end $$;
drop trigger quote_rules on public.fee_quote;
create trigger quote_rules before insert or update of list_price, discount_pct, approved_by, instalments, plan on public.fee_quote for each row execute function public.quote_rules();

create or replace function public.fee_plan_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.instalments is null or jsonb_array_length(new.instalments) = 0
     or (tg_op = 'UPDATE' and new.total <> old.total and new.instalments is not distinct from old.instalments) then
    new.instalments := split_instalments(new.total, plan_parts(new.plan));
  end if;
  perform check_instalments(new.total, new.instalments);
  new.plan := case when jsonb_array_length(new.instalments) = 1 then 'Full payment' else jsonb_array_length(new.instalments) || ' instalments' end;
  return new;
end $$;
create trigger fee_plan_rules before insert or update of total, plan, instalments on public.fee_plan for each row execute function public.fee_plan_rules();

update public.fee_quote set instalments = split_instalments(amount, plan_parts(plan)) where instalments is null;
update public.fee_plan set instalments = split_instalments(total, plan_parts(plan)) where instalments is null;

-- Converting a lead carries the accepted quote's instalments into the fee plan.
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
      insert into public.fee_plan (candidate_id, total, plan, instalments) values (cid, q.amount, q.plan, q.instalments);
    end if;
    insert into public.follow_up (title, candidate_id, owner_role, due_at) values
      ('Finish the data sheet', cid, 'Front desk', now()),
      ('Assign a batch', cid, 'HR / Counsellor', now()),
      ('Record the first payment', cid, 'Finance', now());
  end if;
  return new;
end $$;

-- The fee plan page edits rows read from this view, so it needs the instalments too.
create or replace view public.fee_plan_summary with (security_invoker = true) as
select fp.id, fp.candidate_id, c.full_name, c.program_id, fp.total, fp.plan,
       coalesce(sum(p.amount) filter (where p.status = 'Received'), 0) as paid,
       fp.total - coalesce(sum(p.amount) filter (where p.status = 'Received'), 0) as balance,
       min(p.due_on) filter (where p.status in ('Due', 'Overdue')) as next_due,
       bool_or(p.status = 'Overdue') as overdue,
       fp.created_at, fp.instalments
from public.fee_plan fp
join public.candidate c on c.id = fp.candidate_id
left join public.fee_payment p on p.candidate_id = fp.candidate_id
group by fp.id, c.full_name, c.program_id;
