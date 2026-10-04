-- First-time tour: shown until the person finishes or skips it once.
alter table public.staff add column tour_done_at timestamptz;
create or replace function public.tour_done() returns void
language sql security definer set search_path = public as $$ update staff set tour_done_at = now() where id = auth.uid() $$;
grant execute on function public.tour_done() to authenticated;
-- existing staff have already used the CRM
update public.staff set tour_done_at = now() where tour_done_at is null and created_at < now() - interval '1 hour';
