-- Final wiring after migrations 058-063.
-- 1. Audit trail on every business table, including tables created after 058 (templates, reminder rules, saved reports).
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind = 'r'
             and c.relname not in ('audit_log','data_access_log','viewing','notification','student_notification',
                                   'integration_event','status_history','alert','import_run','message','session','sessions',
                                   'login_attempt','reminder_log')
  loop
    execute format('drop trigger if exists zz_audit on public.%I', t);
    execute format('create trigger zz_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- 2. Send queued WhatsApp/email messages (manual sends and reminders) every 2 minutes, same pattern as recording cleanup.
create or replace function public.call_message_sender() returns bigint
language sql security definer set search_path = public, extensions as $$
  select net.http_post(
    url := (select value from public.integration_config where key = 'app_url') || '/api/messages/process',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.integration_config where key = 'cron_secret')))
$$;
revoke all on function public.call_message_sender() from public, anon, authenticated;
select cron.unschedule('message-sender') where exists (select 1 from cron.job where jobname = 'message-sender');
select cron.schedule('message-sender', '*/2 * * * *', 'select public.call_message_sender()');

-- 3. No signed-out access to any SECURITY DEFINER function, including ones created after 059 (e.g. message_notify).
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon', f);
  end loop;
end $$;
