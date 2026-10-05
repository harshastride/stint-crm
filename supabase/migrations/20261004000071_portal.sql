-- Student portal: rejected documents with a reason, and the student's next class.

-- 1. Rejected documents need a reason the student can act on
alter table public.candidate_document add column if not exists reject_reason text;
alter table public.candidate_document drop constraint if exists candidate_document_reject_reason_ok;
alter table public.candidate_document add constraint candidate_document_reject_reason_ok
  check (status <> 'Rejected' or length(btrim(coalesce(reject_reason, ''))) >= 3);

-- The reason only belongs to a rejected document: clear it when the status moves on (e.g. student re-uploads)
create or replace function public.candidate_document_clear_reason() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status <> 'Rejected' then new.reject_reason := null;
  elsif length(btrim(coalesce(new.reject_reason, ''))) < 3 then
    raise exception 'Add a reason when rejecting a document, so the student knows what to fix.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists candidate_document_clear_reason on public.candidate_document;
create trigger candidate_document_clear_reason before insert or update of status, reject_reason on public.candidate_document
  for each row execute function public.candidate_document_clear_reason();

-- Dropdown value (the list exists only after seed on a fresh reset; seed.sql repeats this)
insert into public.dropdown_value (list_id, value, sort, locked)
  select 'document_status', 'Rejected', 3, false where exists (select 1 from public.dropdown_list where id = 'document_status')
  on conflict (list_id, value) do nothing;

-- Portal: reasons for the signed-in student's own rejected documents
create or replace function public.portal_document_reasons() returns table (id uuid, reject_reason text)
language sql stable security definer set search_path = public as $$
  select d.id, d.reject_reason from candidate_document d
   where d.candidate_id = public.my_candidate() and d.status = 'Rejected'
$$;
revoke all on function public.portal_document_reasons() from public, anon;
grant execute on function public.portal_document_reasons() to authenticated;

-- 2. Portal: the next class of the signed-in student's own batch (null when none)
create or replace function public.portal_next_class() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('batch', b.code,
           'starts_at', (d::date + coalesce(b.class_start, '10:00'::time)) at time zone 'Asia/Kolkata',
           'ends_at', (d::date + coalesce(b.class_end, '12:00'::time)) at time zone 'Asia/Kolkata')
    from candidate c
    join batch b on b.id = c.batch_id
    cross join lateral generate_series(greatest(b.starts_on, (now() at time zone 'Asia/Kolkata')::date),
                                       least(coalesce(b.ends_on, current_date + 60), current_date + 60), interval '1 day') d
   where c.id = public.my_candidate()
     and b.starts_on is not null and b.status not in ('Completed', 'Closed', 'Cancelled')
     and extract(isodow from d)::smallint = any (b.class_days)
     and (d::date + coalesce(b.class_end, '12:00'::time)) at time zone 'Asia/Kolkata' > now()
   order by d limit 1
$$;
revoke all on function public.portal_next_class() from public, anon;
grant execute on function public.portal_next_class() to authenticated;
