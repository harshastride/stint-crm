-- Student portal. A student logs in with their own account (linked to one candidate) and, only through the
-- functions below, sees and fills their own details, uploads requested documents, and sees fees and schedule.
-- Students get no access to any CRM table: my_role() is null for them, so every staff policy refuses them.
create table public.student_account (
  user_id uuid primary key references auth.users (id) on delete cascade,
  candidate_id uuid not null unique references public.candidate (id) on delete cascade,
  must_change_password boolean not null default true,
  invited_by uuid references public.staff (id),
  invited_at timestamptz not null default now(),
  last_login_at timestamptz
);
alter table public.student_account enable row level security;
create policy student_account_staff on public.student_account for select to authenticated using (public.can_page('candidate', 'r'));

create or replace function public.my_candidate() returns uuid
language sql stable security definer set search_path = public as $$
  select candidate_id from public.student_account where user_id = auth.uid()
$$;

-- Everything the portal shows, in one call
create or replace function public.portal_me() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cid uuid := public.my_candidate(); c record; acct record;
begin
  if cid is null then return null; end if;
  select * into acct from student_account where user_id = auth.uid();
  select cd.*, p.name as program, b.code as batch, b.starts_on, t.full_name as trainer, o.full_name as owner, o.email as owner_email
    into c from candidate cd left join program p on p.id = cd.program_id left join batch b on b.id = cd.batch_id
    left join staff t on t.id = b.trainer_id left join staff o on o.id = cd.poc_id where cd.id = cid;
  return jsonb_build_object(
    'must_change_password', acct.must_change_password,
    'candidate', jsonb_build_object('id', c.id, 'code', c.code, 'full_name', c.full_name, 'stage', c.stage, 'program', c.program, 'batch', c.batch,
       'starts_on', c.starts_on, 'trainer', c.trainer, 'owner', c.owner, 'owner_email', c.owner_email, 'joined_on', c.joined_on,
       'profile', c.profile, 'education', c.education, 'experience', c.experience),
    'private', (select jsonb_build_object('contact', contact, 'family', family, 'identity', identity, 'bank', bank) from candidate_private where candidate_id = cid),
    'editable', c.stage in ('Enrolled', 'Training'),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'doc_type', doc_type, 'status', status, 'has_file', file_path is not null) order by created_at) from candidate_document where candidate_id = cid), '[]'),
    'fees', (select jsonb_build_object('total', total, 'paid', paid, 'balance', balance, 'next_due', next_due, 'overdue', overdue)
             from (select fp.total, coalesce(sum(p.amount) filter (where p.status = 'Received'), 0) as paid,
                          fp.total - coalesce(sum(p.amount) filter (where p.status = 'Received'), 0) as balance,
                          min(p.due_on) filter (where p.status in ('Due', 'Overdue')) as next_due, bool_or(p.status = 'Overdue') as overdue
                   from fee_plan fp left join fee_payment p on p.candidate_id = fp.candidate_id where fp.candidate_id = cid group by fp.total) x),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'amount', amount, 'status', status, 'due_on', due_on, 'paid_on', paid_on, 'label', label, 'receipt_no', receipt_no) order by coalesce(due_on, paid_on)) from fee_payment where candidate_id = cid), '[]'),
    'mocks', coalesce((select jsonb_agg(jsonb_build_object('scheduled_at', scheduled_at, 'level', level, 'status', status) order by scheduled_at) from mock_session where candidate_id = cid), '[]'),
    'attendance', (select jsonb_build_object('present', count(*) filter (where mark = 'P'), 'absent', count(*) filter (where mark = 'A'), 'late', count(*) filter (where mark = 'L'), 'total', count(*)) from attendance where candidate_id = cid)
  );
end $$;
grant execute on function public.portal_me() to authenticated;

-- The student fills their own data sheet while they are Enrolled or in Training
create or replace function public.portal_save(p_profile jsonb, p_education jsonb, p_experience jsonb, p_private jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid := public.my_candidate(); g text;
begin
  if cid is null then raise exception 'Not a student account.' using errcode = '42501'; end if;
  if not exists (select 1 from candidate where id = cid and stage in ('Enrolled', 'Training')) then
    raise exception 'Your details are locked now. Ask the institute to change anything.' using errcode = '42501';
  end if;
  update candidate set profile = coalesce(profile, '{}') || coalesce(p_profile, '{}'),
    education = coalesce(p_education, education), experience = coalesce(p_experience, experience) where id = cid;
  insert into candidate_private (candidate_id) values (cid) on conflict do nothing;
  foreach g in array array['contact', 'family', 'identity', 'bank'] loop
    if p_private ? g then
      execute format('update candidate_private set %I = coalesce(%I, ''{}'') || $1, updated_at = now() where candidate_id = $2', g, g) using p_private -> g, cid;
    end if;
  end loop;
  insert into note (candidate_id, kind, body) values (cid, 'Note', 'Student updated their details in the portal.');
end $$;
grant execute on function public.portal_save(jsonb, jsonb, jsonb, jsonb) to authenticated;

-- After uploading a requested document's file, the student marks it Received for staff to verify
create or replace function public.portal_document_uploaded(p_doc uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid := public.my_candidate();
begin
  if cid is null or p_path not like cid || '/doc/%' then raise exception 'Not allowed.' using errcode = '42501'; end if;
  update candidate_document set file_path = p_path, status = 'Received' where id = p_doc and candidate_id = cid and status <> 'Verified';
  if not found then raise exception 'That document is not open for upload.' using errcode = '42501'; end if;
end $$;
grant execute on function public.portal_document_uploaded(uuid, text) to authenticated;

create or replace function public.portal_password_changed() returns void
language sql security definer set search_path = public as $$
  update student_account set must_change_password = false, last_login_at = now() where user_id = auth.uid()
$$;
grant execute on function public.portal_password_changed() to authenticated;

-- Students upload only into their own folder for documents
create policy candidate_files_student_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'candidate-files' and public.my_candidate() is not null and name like public.my_candidate()::text || '/doc/%');
create policy candidate_files_student_read on storage.objects for select to authenticated
  using (bucket_id = 'candidate-files' and public.my_candidate() is not null and name like public.my_candidate()::text || '/doc/%');
