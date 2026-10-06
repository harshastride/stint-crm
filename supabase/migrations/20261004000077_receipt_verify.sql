-- Receipt and quote verification (QR on the PDF). Each document gets a random, unguessable code.
-- verify_document(code) returns only what proves the paper is genuine: never a full name, contact or internal id.
-- It is server-only (no anon/staff EXECUTE): the public page /v/<code> calls it with the service key after an IP rate limit.

create or replace function public.new_verification_code() returns text
language sql volatile set search_path = public as $$
  select upper(encode(extensions.gen_random_bytes(8), 'hex'))   -- 16 chars, 64 random bits
$$;
revoke all on function public.new_verification_code() from public, anon;
grant execute on function public.new_verification_code() to authenticated, service_role;  -- column default and trigger run as the inserting staff member

alter table public.fee_payment add column if not exists verification_code text;
alter table public.fee_quote add column if not exists verification_code text;
update public.fee_payment set verification_code = public.new_verification_code() where verification_code is null;
update public.fee_quote set verification_code = public.new_verification_code() where verification_code is null;
alter table public.fee_payment alter column verification_code set default public.new_verification_code(), alter column verification_code set not null;
alter table public.fee_quote alter column verification_code set default public.new_verification_code(), alter column verification_code set not null;
create unique index if not exists fee_payment_verification_code_key on public.fee_payment (verification_code);
create unique index if not exists fee_quote_verification_code_key on public.fee_quote (verification_code);

-- The code cannot be changed or chosen by staff (a forged code could point at someone else's paper).
create or replace function public.keep_verification_code() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.verification_code := public.new_verification_code();
  elsif new.verification_code is distinct from old.verification_code then new.verification_code := old.verification_code;
  end if;
  return new;
end $$;
drop trigger if exists fee_payment_verification_code on public.fee_payment;
create trigger fee_payment_verification_code before insert or update of verification_code on public.fee_payment for each row execute function public.keep_verification_code();
drop trigger if exists fee_quote_verification_code on public.fee_quote;
create trigger fee_quote_verification_code before insert or update of verification_code on public.fee_quote for each row execute function public.keep_verification_code();

-- "Ravi Babu" -> "R. B."
create or replace function public.name_initials(n text) returns text
language sql immutable set search_path = public as $$
  select coalesce(string_agg(upper(left(w, 1)) || '.', ' '), '')
  from unnest(regexp_split_to_array(trim(coalesce(n, '')), '\s+')) w where w <> ''
$$;

create or replace function public.verify_document(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')); r record;
  inst text := coalesce((select value from public.setting where key = 'institute_name'), 'Stint Academy');
begin
  if length(c) < 12 or length(c) > 32 then return jsonb_build_object('found', false); end if;
  select p.receipt_no, p.id, p.paid_on, p.amount, p.status, cd.full_name, cd.code into r
    from public.fee_payment p join public.candidate cd on cd.id = p.candidate_id where p.verification_code = c and p.status = 'Received';  -- a receipt exists only once paid
  if found then
    return jsonb_build_object('found', true, 'kind', 'receipt',
      'number', coalesce(r.receipt_no, 'R-' || upper(left(r.id::text, 8))), 'issued_on', r.paid_on, 'amount', r.amount, 'status', r.status,
      'institute', inst,
      'holder', public.name_initials(r.full_name) || case when r.code is not null and length(r.code) >= 2 then ' · …' || right(r.code, 2) else '' end);
  end if;
  select q.id, q.created_at::date as created_on, q.valid_until, q.amount, q.status, l.full_name into r
    from public.fee_quote q join public.lead l on l.id = q.lead_id where q.verification_code = c;
  if found then
    return jsonb_build_object('found', true, 'kind', 'quote', 'number', 'Q-' || upper(left(r.id::text, 8)), 'issued_on', r.created_on,
      'valid_until', r.valid_until, 'amount', r.amount, 'status', r.status, 'institute', inst, 'holder', public.name_initials(r.full_name));
  end if;
  return jsonb_build_object('found', false);
end $$;
revoke all on function public.verify_document(text) from public, anon, authenticated;
grant execute on function public.verify_document(text) to service_role;
