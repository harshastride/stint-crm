-- Sidebar counts: 'today' is the India day (Asia/Kolkata), not the database's UTC day.
create or replace function public.sidebar_counts() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'followups', (select count(*) from follow_up where status = 'Open' and due_at < (((now() at time zone 'Asia/Kolkata')::date + 1)::timestamp at time zone 'Asia/Kolkata')
                   and (owner_id = auth.uid() or (owner_id is null and owner_role = public.my_role()))),
    'followups_late', (select count(*) from follow_up where status = 'Open' and due_at < now() - interval '1 day'
                   and (owner_id = auth.uid() or (owner_id is null and owner_role = public.my_role()))),
    'alert', (select count(*) from alert where status = 'Open'),
    'lead', (select count(*) from lead where created_at >= ((now() at time zone 'Asia/Kolkata')::date::timestamp at time zone 'Asia/Kolkata')),
    'payment', (select count(*) from fee_payment where status = 'Overdue'),
    'recordings', (select count(*) from recording where status in ('Unmatched', 'Waiting to confirm')),
    'deliveries', (select count(*) from integration_event where status = 'Failed')
  )
$$;
grant execute on function public.sidebar_counts() to authenticated;
