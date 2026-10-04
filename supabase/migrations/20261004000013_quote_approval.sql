-- 2.6 Quote approval: a discount above the limit needs the Sales head (role Sales, level Head) or an Admin.
create or replace function public.can_approve_quotes() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from public.staff where id = auth.uid() and role = 'Sales' and level = 'Head' and status = 'Active')
$$;
grant execute on function public.can_approve_quotes() to authenticated;

create or replace function public.approve_quote(qid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_approve_quotes() then raise exception 'Only the Sales head or an admin can approve a quote.' using errcode = '42501'; end if;
  update public.fee_quote set approved_by = auth.uid() where id = qid;
  if not found then raise exception 'Quote not found.'; end if;
end $$;
grant execute on function public.approve_quote(uuid) to authenticated;

create or replace function public.quote_approval_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- approved_by is only set through approve_quote (or by the database itself, e.g. seeds)
  if new.approved_by is distinct from (case when tg_op = 'UPDATE' then old.approved_by end)
     and new.approved_by is not null and auth.uid() is not null and not public.can_approve_quotes() then
    raise exception 'Only the Sales head or an admin can approve a quote.' using errcode = '42501';
  end if;
  -- a change of price after approval needs a fresh approval
  if tg_op = 'UPDATE' and new.approved_by is not null and new.approved_by is not distinct from old.approved_by
     and (new.discount_pct <> old.discount_pct or new.list_price <> old.list_price) then
    new.approved_by := null;
  end if;
  return new;
end $$;
create trigger quote_approval_guard before insert or update on public.fee_quote for each row execute function public.quote_approval_guard();

-- quote_rules (alphabetically after the guard) then sets needs_approval. This check runs last.
create or replace function public.quote_accept_check() returns trigger
language plpgsql as $$
begin
  if new.status = 'Accepted' and new.needs_approval then
    raise exception 'This quote needs the Sales head''s approval before it can be accepted.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger zz_quote_accept_check before insert or update on public.fee_quote for each row execute function public.quote_accept_check();
