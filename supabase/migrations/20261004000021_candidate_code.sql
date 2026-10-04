-- Candidate codes from one sequence, also for imports (go-live 5.3)
create or replace function public.next_candidate_code() returns text
language sql volatile security definer set search_path = public as $$
  select 'STA-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.candidate_code_seq')::text, 4, '0')
$$;
revoke all on function public.next_candidate_code() from public, anon, authenticated;
grant execute on function public.next_candidate_code() to service_role;
