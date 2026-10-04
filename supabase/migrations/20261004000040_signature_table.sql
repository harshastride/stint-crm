-- Keep the signature image out of the candidate row so lists stay light.
alter table public.candidate drop column signature_png, drop column signed_at;
create table public.candidate_signature (
  candidate_id uuid primary key references public.candidate (id) on delete cascade,
  png text not null check (length(png) < 200000),
  signed_at timestamptz not null default now()
);
alter table public.candidate_signature enable row level security;
create policy candidate_signature_read on public.candidate_signature for select to authenticated
  using (public.can_page('candidate', 'r') and public.candidate_in_scope(candidate_id));

create or replace function public.portal_sign(p_png text) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid := public.my_candidate();
begin
  if cid is null then raise exception 'Not a student account.' using errcode = '42501'; end if;
  if p_png is null or p_png not like 'data:image/png;base64,%' then raise exception 'Please sign in the box first.' using errcode = '22023'; end if;
  insert into candidate_signature (candidate_id, png) values (cid, p_png) on conflict do nothing;
  if not found then raise exception 'You have already signed.' using errcode = '42501'; end if;
  insert into note (candidate_id, kind, body) values (cid, 'Note', 'Student signed the fee agreement in the portal.');
end $$;

create or replace function public.portal_signature() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('signed_at', (select signed_at from candidate_signature where candidate_id = public.my_candidate()))
$$;
