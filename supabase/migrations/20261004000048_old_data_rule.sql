-- 048 · 30-day rule: non-Admin staff do not see closed / old history older than
-- setting old_data_days (default 30). Admin keeps full access. Security-definer jobs
-- (raise_alerts, reports owned by postgres) are not affected because table owners bypass RLS.

create or replace function public.setting_int(p_key text, p_fallback int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(trim(value), '')::int from setting where key = p_key), p_fallback)
$$;

create or replace function public.lead_last_activity(p_lead uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select greatest(
    (select stage_changed_at from lead where id = p_lead),
    (select max(called_at) from call_log where lead_id = p_lead),
    (select max(created_at) from note where lead_id = p_lead))
$$;

insert into public.setting(key, value) values ('old_data_days', '30') on conflict (key) do nothing;

-- true when the row's timestamp is still inside the window (or caller is Admin)
create or replace function public.recent_enough(p_at timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or p_at is null
      or p_at >= now() - make_interval(days => public.setting_int('old_data_days', 30))
$$;
grant execute on function public.setting_int(text,int), public.lead_last_activity(uuid), public.recent_enough(timestamptz) to authenticated;

drop policy if exists old_data_sel on public.lead;
create policy old_data_sel on public.lead as restrictive for select to authenticated
  using (stage not in ('Not interested','Converted') or public.recent_enough(stage_changed_at));

drop policy if exists old_data_sel on public.call_log;
create policy old_data_sel on public.call_log as restrictive for select to authenticated using (public.recent_enough(called_at));
drop policy if exists old_data_sel on public.note;
create policy old_data_sel on public.note as restrictive for select to authenticated using (public.recent_enough(created_at));
drop policy if exists old_data_sel on public.recording;
create policy old_data_sel on public.recording as restrictive for select to authenticated using (public.recent_enough(created_at));
drop policy if exists old_data_sel on public.training_note;
create policy old_data_sel on public.training_note as restrictive for select to authenticated using (public.recent_enough(created_at));
drop policy if exists old_data_sel on public.follow_up;
create policy old_data_sel on public.follow_up as restrictive for select to authenticated
  using (status <> 'Done' or public.recent_enough(created_at));
drop policy if exists old_data_sel on public.alert;
create policy old_data_sel on public.alert as restrictive for select to authenticated
  using (status <> 'Resolved' or public.recent_enough(raised_at));
drop policy if exists old_data_sel on public.status_history;
create policy old_data_sel on public.status_history as restrictive for select to authenticated using (public.recent_enough(at));
drop policy if exists old_data_sel on public.fee_quote;
create policy old_data_sel on public.fee_quote as restrictive for select to authenticated
  using (status not in ('Expired','Lost') or public.recent_enough(created_at));
-- person_timeline is security invoker, so the policies above already apply to it.
