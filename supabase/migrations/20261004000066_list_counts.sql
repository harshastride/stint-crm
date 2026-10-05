-- List summary strip: money totals for the Payments list, computed in the database so they cover every row,
-- not just the rows a browser has loaded. security invoker: fee_payment row security (can_page('payment','r')
-- and candidate_in_scope) decides which rows are counted, so a role without the Payments page gets zeros.
create or replace function public.list_summary_payment()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'collected',     coalesce(sum(amount) filter (where status = 'Received'), 0),
    'overdue',       coalesce(sum(amount) filter (where status = 'Overdue'), 0),
    'late_students', count(distinct candidate_id) filter (where status = 'Overdue')
  )
  from fee_payment;
$$;

revoke all on function public.list_summary_payment() from public, anon;
grant execute on function public.list_summary_payment() to authenticated;

-- Server-side search and sort on the big lists filter by these columns; cheap indexes keep them fast at volume.
create index if not exists lead_created_at_idx on lead (created_at desc);
create index if not exists lead_next_call_at_idx on lead (next_call_at);
create index if not exists candidate_created_at_idx on candidate (created_at desc);
create index if not exists fee_payment_due_on_idx on fee_payment (due_on);
create index if not exists call_log_called_at_idx on call_log (called_at desc);
create index if not exists follow_up_due_at_idx on follow_up (due_at);
