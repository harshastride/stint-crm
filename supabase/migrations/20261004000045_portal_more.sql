-- Student portal, more: feedback, resumes, notifications, interview practice. All reads go through
-- security-definer portal_* functions scoped to my_candidate(); students get no table policies.

-- 1. Feedback from SMEs and mock results
create or replace function public.portal_feedback() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cid uuid := public.my_candidate();
begin
  if cid is null then return null; end if;
  return jsonb_build_object(
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'rating', f.rating, 'verdict', f.verdict, 'comments', f.comments,
        'created_at', f.created_at, 'sme', jsonb_build_object('full_name', split_part(s.full_name, ' ', 1))) order by f.created_at desc)
      from sme_feedback f left join staff s on s.id = f.sme_id where f.candidate_id = cid), '[]'),
    'mocks', coalesce((select jsonb_agg(jsonb_build_object('status', status, 'level', level, 'scheduled_at', scheduled_at) order by scheduled_at desc)
      from mock_session where candidate_id = cid), '[]'));
end $$;

-- 2. Resume versions
create or replace function public.portal_resumes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cid uuid := public.my_candidate();
begin
  if cid is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'version', r.version, 'status', r.status, 'reason', r.reason,
      'reviewer', nullif(split_part(s.full_name, ' ', 1), ''), 'created_at', r.created_at, 'file_path', r.file_path) order by r.created_at desc)
    from resume_version r left join staff s on s.id = r.reviewer_id where r.candidate_id = cid), '[]');
end $$;

-- 3. Students may read (not upload) their own resume files
drop policy if exists candidate_files_student_resume_read on storage.objects;
create policy candidate_files_student_resume_read on storage.objects for select to authenticated
  using (bucket_id = 'candidate-files' and public.my_candidate() is not null and name like public.my_candidate()::text || '/resume/%');

-- 4. Student notifications
create table if not exists public.student_notification (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists student_notification_cand_idx on public.student_notification (candidate_id, created_at desc);
alter table public.student_notification enable row level security;
drop policy if exists student_notification_staff on public.student_notification;
create policy student_notification_staff on public.student_notification for select to authenticated
  using (public.can_page('candidate', 'r') and public.candidate_in_scope(candidate_id));

create or replace function public.portal_notifications() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cid uuid := public.my_candidate();
begin
  if cid is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'title', title, 'body', body, 'link', link,
      'read_at', read_at, 'created_at', created_at) order by created_at desc)
    from (select * from student_notification where candidate_id = cid order by created_at desc limit 30) x), '[]');
end $$;

create or replace function public.portal_notifications_read(p_ids uuid[] default null) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid := public.my_candidate();
begin
  if cid is null then raise exception 'Not a student account.' using errcode = '42501'; end if;
  update student_notification set read_at = now()
   where candidate_id = cid and read_at is null and (p_ids is null or id = any (p_ids));
end $$;

create or replace function public.student_notify(p_cid uuid, p_kind text, p_title text, p_body text, p_link text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_cid is null or not exists (select 1 from student_account where candidate_id = p_cid) then return; end if;
  insert into student_notification (candidate_id, kind, title, body, link) values (p_cid, p_kind, p_title, p_body, p_link);
end $$;
revoke execute on function public.student_notify(uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public.notify_student_resume() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform student_notify(new.candidate_id, 'resume', 'A new resume version was added', 'Version ' || new.version, 'portal:resumes');
  elsif new.status is distinct from old.status then
    if new.status = 'Approved' then
      perform student_notify(new.candidate_id, 'resume', 'Your resume ' || new.version || ' was approved', null, 'portal:resumes');
    elsif new.status in ('Rejected', 'Changes needed', 'Needs changes') then
      perform student_notify(new.candidate_id, 'resume', 'Your resume ' || new.version || ' needs changes' || coalesce(': ' || new.reason, ''), new.reason, 'portal:resumes');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists student_notify_resume on public.resume_version;
create trigger student_notify_resume after insert or update of status on public.resume_version for each row execute function public.notify_student_resume();

create or replace function public.notify_student_document() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'Missing' then
    perform student_notify(new.candidate_id, 'document', 'Please upload: ' || new.doc_type, null, 'portal:files');
  elsif new.status = 'Verified' and (tg_op = 'INSERT' or old.status is distinct from 'Verified') then
    perform student_notify(new.candidate_id, 'document', 'Your ' || new.doc_type || ' was verified', null, 'portal:files');
  end if;
  return new;
end $$;
drop trigger if exists student_notify_document on public.candidate_document;
create trigger student_notify_document after insert or update of status on public.candidate_document for each row execute function public.notify_student_document();

create or replace function public.notify_student_mock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform student_notify(new.candidate_id, 'mock', 'Mock interview booked for ' || to_char(new.scheduled_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM'), new.level, 'portal:progress');
  elsif new.status is distinct from old.status and new.status in ('Passed', 'Failed') then
    perform student_notify(new.candidate_id, 'mock',
      case when new.status = 'Passed' then 'You passed your mock interview' else 'Your mock interview needs another try' end, new.level, 'portal:progress');
  end if;
  return new;
end $$;
drop trigger if exists student_notify_mock on public.mock_session;
create trigger student_notify_mock after insert or update of status on public.mock_session for each row execute function public.notify_student_mock();

create or replace function public.notify_student_payment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'Received' and (tg_op = 'INSERT' or old.status is distinct from 'Received') then
    perform student_notify(new.candidate_id, 'fee', 'Payment of ₹' || trim(to_char(new.amount, 'FM99,99,99,990')) || ' received', new.receipt_no, 'portal:fees');
  end if;
  return new;
end $$;
drop trigger if exists student_notify_payment on public.fee_payment;
create trigger student_notify_payment after insert or update of status on public.fee_payment for each row execute function public.notify_student_payment();

-- 5. Interview practice (written by the practice service with the service role)
create table if not exists public.interview_practice (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate (id) on delete cascade,
  attempt_ref text not null unique,
  topic text,
  question text,
  overall numeric(5,2),
  accuracy numeric(5,2),
  fluency numeric(5,2),
  completeness numeric(5,2),
  wpm numeric(6,1),
  filler_count int,
  created_at timestamptz not null default now(),
  received_at timestamptz default now()
);
create index if not exists interview_practice_cand_idx on public.interview_practice (candidate_id, created_at desc);
alter table public.interview_practice enable row level security;
drop policy if exists interview_practice_read on public.interview_practice;
create policy interview_practice_read on public.interview_practice for select to authenticated
  using (public.can_page('practice', 'r') and public.candidate_in_scope(candidate_id));

insert into public.page (id, grp, title, sort) values ('practice', 'Training', 'Interview practice', 18) on conflict (id) do nothing;
insert into public.role_page_access (role, page_id, mode)
select name, 'practice', 'r' from public.app_role where name in ('SME', 'Trainer', 'HR / Counsellor') on conflict do nothing;

create or replace function public.notify_student_practice() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform student_notify(new.candidate_id, 'practice', 'Practice score saved: ' || coalesce(round(new.overall)::text, '-') || '/100', new.topic, 'portal:progress');
  return new;
end $$;
drop trigger if exists student_notify_practice on public.interview_practice;
create trigger student_notify_practice after insert on public.interview_practice for each row execute function public.notify_student_practice();

create or replace function public.portal_practice() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cid uuid := public.my_candidate();
begin
  if cid is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('topic', topic, 'question', question, 'overall', overall, 'accuracy', accuracy,
      'fluency', fluency, 'completeness', completeness, 'wpm', wpm, 'filler_count', filler_count, 'created_at', created_at) order by created_at desc)
    from (select * from interview_practice where candidate_id = cid order by created_at desc limit 50) x), '[]');
end $$;

-- 6. Grants
grant execute on function public.portal_feedback() to authenticated;
grant execute on function public.portal_resumes() to authenticated;
grant execute on function public.portal_notifications() to authenticated;
grant execute on function public.portal_notifications_read(uuid[]) to authenticated;
grant execute on function public.portal_practice() to authenticated;
