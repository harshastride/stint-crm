-- 2.7 Fee plan → instalments. A plan creates one Due payment per instalment (first today, then monthly,
-- or on the instalment's own due_on). Recording a payment marks the matching instalment Received with a receipt number.
alter table public.fee_payment add column fee_plan_id uuid references public.fee_plan (id) on delete cascade;
alter table public.fee_payment add column instalment_no int;
alter table public.fee_payment add column label text;

create sequence if not exists public.receipt_seq start 5001;
create or replace function public.next_receipt() returns text
language sql volatile security definer set search_path = public as $$
  select 'RCPT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.receipt_seq')::text, 5, '0')
$$;

-- (Re)create the unpaid instalments of a plan; paid ones are kept.
create or replace function public.sync_plan_payments(pid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p record; e jsonb; i int := 0; start date;
begin
  select * into p from public.fee_plan where id = pid;
  if not found then return; end if;
  start := p.created_at::date;
  delete from public.fee_payment where fee_plan_id = pid and status in ('Due', 'Overdue');
  for e in select * from jsonb_array_elements(p.instalments) loop
    i := i + 1;
    if not exists (select 1 from public.fee_payment where fee_plan_id = pid and instalment_no = i) then
      insert into public.fee_payment (candidate_id, fee_plan_id, instalment_no, label, amount, status, due_on, created_by)
      values (p.candidate_id, pid, i, e->>'label', (e->>'amount')::numeric, 'Due',
              coalesce((e->>'due_on')::date, (start + make_interval(months => i - 1))::date), auth.uid());
    end if;
  end loop;
end $$;

create or replace function public.plan_payments_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.instalments is distinct from old.instalments then
    perform public.sync_plan_payments(new.id);
  end if;
  return null;
end $$;
create trigger plan_payments after insert or update of instalments, total on public.fee_plan for each row execute function public.plan_payments_trigger();

-- Recording a payment (a new Received row without an instalment) settles the oldest unpaid instalments.
create or replace function public.apply_payment() returns trigger
language plpgsql security definer set search_path = public as $$
declare left_amt numeric := new.amount; d record; receipt text;
begin
  if new.status <> 'Received' or new.fee_plan_id is not null then
    if new.status = 'Received' and new.receipt_no is null then new.receipt_no := public.next_receipt(); end if;
    return new;
  end if;
  receipt := coalesce(nullif(trim(new.receipt_no), ''), public.next_receipt());
  for d in select * from public.fee_payment where candidate_id = new.candidate_id and fee_plan_id is not null and status in ('Due', 'Overdue')
           order by instalment_no for update loop
    exit when left_amt <= 0;
    if left_amt >= d.amount then
      update public.fee_payment set status = 'Received', paid_on = coalesce(new.paid_on, current_date), mode = new.mode, receipt_no = receipt where id = d.id;
      left_amt := left_amt - d.amount;
    else
      -- part payment: the received part becomes its own row, the rest stays due
      update public.fee_payment set amount = d.amount - left_amt where id = d.id;
      insert into public.fee_payment (candidate_id, fee_plan_id, instalment_no, label, amount, status, due_on, paid_on, mode, receipt_no, created_by)
      values (d.candidate_id, d.fee_plan_id, null, coalesce(d.label, 'Instalment') || ' (part)', left_amt, 'Received', d.due_on, coalesce(new.paid_on, current_date), new.mode, receipt, auth.uid());
      left_amt := 0;
    end if;
  end loop;
  if left_amt <= 0 then return null; end if;   -- fully applied to instalments; nothing extra to store
  new.amount := left_amt;                       -- more than was due: keep the extra as its own received row
  new.receipt_no := receipt;
  new.paid_on := coalesce(new.paid_on, current_date);
  return new;
end $$;
create trigger fee_payment_apply before insert on public.fee_payment for each row execute function public.apply_payment();
