-- Slice 4 · Recordings. Audio lives in a private bucket at recordings/<recording id>.<ext>.
-- Status: Recorded → Transcribing → Waiting to confirm → Confirmed (or Unmatched when nobody is attached yet).
alter table public.recording add column audio_path text;
alter table public.recording add column audio_deleted_at timestamptz;
alter table public.recording add column transcript_text text;
alter table public.recording add column draft jsonb;          -- AI summary waiting for the staff member to confirm
alter table public.recording add column process_error text;
alter table public.recording add column confirmed_by uuid references public.staff (id);
alter table public.recording add column called_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit) values ('recordings', 'recordings', false, 104857600)
on conflict (id) do nothing;

-- A file follows its recording row: whoever may see the row may play it; the person who captured it (or the Recordings page) may write it.
create or replace function public.can_recording_file(path text, need text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare rid uuid;
begin
  begin rid := split_part(split_part(path, '/', 1), '.', 1)::uuid; exception when others then return false; end;
  return exists (select 1 from public.recording r where r.id = rid
    and (r.captured_by = auth.uid() or public.can_page('recordings', need))
    and public.lead_in_scope(r.lead_id) and public.candidate_in_scope(r.candidate_id));
end $$;
create policy recordings_read on storage.objects for select to authenticated using (bucket_id = 'recordings' and public.can_recording_file(name, 'r'));
create policy recordings_ins on storage.objects for insert to authenticated with check (bucket_id = 'recordings' and public.can_recording_file(name, 'w'));
create policy recordings_del on storage.objects for delete to authenticated using (bucket_id = 'recordings' and public.can_recording_file(name, 'w'));

-- Where the database can reach the app (for the nightly audio clean-up call) and the secret that call uses
insert into public.integration_config (key, value) values
  ('app_url', 'http://host.docker.internal:3100'),
  ('cron_secret', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

-- Recordings whose audio is past the retention period (setting audio_retention_days)
create or replace function public.recordings_to_expire() returns setof public.recording
language sql stable security definer set search_path = public as $$
  select * from public.recording
  where audio_path is not null and audio_deleted_at is null
    and created_at < now() - make_interval(days => coalesce((select value::int from public.setting where key = 'audio_retention_days'), 90))
$$;
revoke all on function public.recordings_to_expire() from public, anon, authenticated;
grant execute on function public.recordings_to_expire() to service_role;

-- Nightly at 02:30 the database asks the app to remove expired audio (the app deletes through the Storage API)
create or replace function public.call_recording_cleanup() returns bigint
language sql security definer set search_path = public, extensions as $$
  select net.http_post(
    url := (select value from public.integration_config where key = 'app_url') || '/api/recordings/cleanup',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.integration_config where key = 'cron_secret')))
$$;
revoke all on function public.call_recording_cleanup() from public, anon, authenticated;
select cron.schedule('recording-cleanup', '30 21 * * *', 'select public.call_recording_cleanup()');  -- 02:30 IST

-- 4.3 Make a lead from a recording (unknown caller): uses the number, attaches the recording
create or replace function public.lead_from_recording(rid uuid, p_name text, p_mobile text) returns uuid
language plpgsql security definer set search_path = public as $$
declare lid uuid; m text := regexp_replace(coalesce(p_mobile, ''), '\D', '', 'g');
begin
  if not (public.can_page('recordings', 'w') and (public.can_page('lead', 'w') or public.can_page('enquiry', 'w'))) then
    raise exception 'Your role can’t create leads from recordings.' using errcode = '42501';
  end if;
  m := regexp_replace(m, '^(91|0)(?=\d{10}$)', '');
  if length(m) <> 10 then raise exception 'Give a 10-digit mobile number.' using errcode = '23514'; end if;
  select id into lid from public.lead where mobile = m;
  if lid is null then
    insert into public.lead (full_name, mobile, notes, source_id, created_by)
    values (coalesce(nullif(trim(p_name), ''), 'Caller ' || m), m, 'From a recorded call',
            (select id from public.lead_source where name ilike 'WhatsApp%' or name ilike 'Walk-in%' order by name limit 1), auth.uid())
    returning id into lid;
  end if;
  update public.recording set lead_id = lid, status = case when status = 'Unmatched' then case when draft is not null then 'Waiting to confirm' else 'Recorded' end else status end where id = rid;
  return lid;
end $$;
grant execute on function public.lead_from_recording(uuid, text, text) to authenticated;
