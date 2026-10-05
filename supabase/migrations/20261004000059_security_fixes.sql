-- 059 Security fixes (audit 2026-10, see docs/security/audit-2026-10.md).
-- 1. No SECURITY DEFINER function in public may be called by anon (signed-out) users.
--    Students and staff are always "authenticated"; triggers and policies are not affected by EXECUTE grants on trigger functions.
-- 2. Server-only helpers that return unmasked contact details or write events are callable only by the service role:
--    lead_brief / candidate_brief returned full mobile + email to ANY caller with no checks.
-- 3. New functions created later by the migration owner do not get EXECUTE for anon/public by default.
-- Idempotent: safe to run again.

-- Signed-in users may run only an explicit allow-list: functions the browser calls with .rpc(...) plus helpers that row-security
-- policies, views or SECURITY INVOKER functions call in the caller's context. Everything else (jobs, cron, internal helpers)
-- is service-role only. Functions created by later migrations are not touched here (they set their own grants), so order does not matter.
do $$
declare f record;
  allow text[] := array[
    'approve_quote','automation_builder','can_file','can_page','can_recording_file','candidate_in_scope',
    'candidate_private_get','candidate_private_set','candidate_stage_visible','contact_status',
    'existing_lead_mobiles','find_duplicates','funnel_counts','in_scope','is_admin','kpi_trends',
    'lead_from_recording','lead_in_scope','lead_row_visible','lead_stage_visible','leaderboard',
    'merge_people','my_candidate','my_onboarding','my_role',
    'my_session','password_changed','person_timeline','portal_document_paths','portal_document_uploaded',
    'portal_feedback','portal_journey','portal_me','portal_notifications','portal_notifications_read',
    'portal_password_changed','portal_practice','portal_resumes','portal_save','portal_sign','portal_signature',
    'preview_reminders','program_stats','raise_alerts_now','recent_enough','retry_event',
    'reveal_contact','run_report','search_people','send_test_event','sidebar_counts','staff_activity',
    'suggest_follow_up','tour_done'];
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
    if f.proname = any(allow) then execute format('grant execute on function %s to authenticated', f.sig);
    else execute format('revoke execute on function %s from authenticated', f.sig); end if;
  end loop;

  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('lead_brief', 'candidate_brief', 'emit_event', 'next_receipt', 'pick_assignee', 'staff_can_page',
                         -- already server-only in earlier migrations; listed again so this file can never widen them
                         'raise_alerts', 'next_candidate_code',  'call_recording_cleanup', 'dispatch_events',
                         'student_notify', 'login_locked_seconds', 'login_record', 'audit_row', 'audit_purge',
                         'reminder_targets', 'reminders_core', 'run_reminders')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- Every SECURITY DEFINER function already pins search_path (checked by security_definer_offenders below);
-- this keeps it that way for any that might be added without it.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public', f.sig);
  end loop;
end $$;

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

-- Audit helper (service role / psql only): lists SECURITY DEFINER functions that break the rules. Empty = good.
create or replace function public.security_definer_offenders()
returns table (fn text, problem text)
language sql stable security invoker set search_path = public as $$
  select p.oid::regprocedure::text, 'no search_path'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  union all
  select p.oid::regprocedure::text, 'anon can execute'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
  union all
  select p.oid::regprocedure::text, 'server-only helper open to signed-in users'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('lead_brief', 'candidate_brief', 'emit_event', 'next_receipt', 'pick_assignee', 'staff_can_page',
    -- already server-only in earlier migrations; listed again so this file can never widen them
    'raise_alerts', 'next_candidate_code',  'call_recording_cleanup', 'dispatch_events',
    'student_notify', 'login_locked_seconds', 'login_record', 'audit_row', 'audit_purge',
    'reminder_targets', 'reminders_core', 'run_reminders')
    and has_function_privilege('authenticated', p.oid, 'execute');
$$;
revoke execute on function public.security_definer_offenders() from public, anon, authenticated;
grant execute on function public.security_definer_offenders() to service_role;

-- Audit helper: SECURITY DEFINER functions signed-in users can run directly that no policy, view or invoker function needs.
-- scripts/test-security.mjs fails if any of these is not called with .rpc('name') somewhere in the app.
create or replace function public.definer_open_to_staff()
returns setof text
language sql stable security invoker set search_path = public as $$
  select distinct d.proname::text
  from pg_proc d join pg_namespace n on n.oid = d.pronamespace
  where n.nspname = 'public' and d.prosecdef and d.prorettype <> 'trigger'::regtype
    and has_function_privilege('authenticated', d.oid, 'execute')
    and not exists (select 1 from pg_policies po where po.qual ~ ('\m' || d.proname || '\(') or po.with_check ~ ('\m' || d.proname || '\('))
    and not exists (select 1 from pg_views v where v.schemaname = 'public' and v.definition ~ ('\m' || d.proname || '\('))
    and not exists (select 1 from pg_proc i join pg_namespace m on m.oid = i.pronamespace
                    where m.nspname = 'public' and not i.prosecdef and i.prosrc ~ ('\m' || d.proname || '\('));
$$;
revoke execute on function public.definer_open_to_staff() from public, anon, authenticated;
grant execute on function public.definer_open_to_staff() to service_role;
