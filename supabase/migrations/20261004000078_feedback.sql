-- Student feedback on training (owner-approved #3). Students rate a finished mock interview, each week of classes
-- while in Training, and the course once training is over. One rating per student per item; never asked twice.
-- Students write and read only through portal_feedback_* (security definer, own candidate only).
-- Staff read through the view feedback_for_trainer: page 'feedback' (Training). A Trainer sees only rows for their own
-- batches or mocks, and never the student's name when the student asked to stay anonymous (the default).

insert into public.page (id, grp, title, sort) values ('feedback', 'Training', 'Student feedback', 19) on conflict (id) do nothing;
insert into public.role_page_access (role, page_id, mode)
select r.name, 'feedback', 'r' from public.app_role r where r.name in ('HR / Counsellor', 'SME', 'Trainer') on conflict do nothing;

create table if not exists public.student_feedback (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate (id) on delete cascade,
  batch_id uuid references public.batch (id) on delete set null,
  trainer_id uuid references public.staff (id) on delete set null,
  subject text not null check (subject in ('module', 'mock', 'overall')),
  subject_ref text not null check (length(subject_ref) between 1 and 64),
  rating int not null check (rating between 1 and 5),
  comment text check (comment is null or length(comment) <= 1000),
  anonymous_to_trainer boolean not null default true,
  created_at timestamptz not null default now(),
  unique (candidate_id, subject, subject_ref)
);
create index if not exists student_feedback_batch_idx on public.student_feedback (batch_id, created_at desc);
create index if not exists student_feedback_trainer_idx on public.student_feedback (trainer_id, created_at desc);
alter table public.student_feedback enable row level security;

-- Direct table reads: feedback page, but not Trainers (they would see who wrote what). No write policies: inserts go through the RPC.
drop policy if exists student_feedback_read on public.student_feedback;
create policy student_feedback_read on public.student_feedback for select to authenticated
  using (public.can_page('feedback', 'r') and public.my_role() is distinct from 'Trainer');
revoke insert, update, delete on public.student_feedback from anon, authenticated;

-- One read path for the Feedback page. Runs with the owner's rights (it must hide names a Trainer may not see), so it
-- filters every row itself: page access, and for Trainers only their own batches/mocks.
drop view if exists public.feedback_for_trainer;
create view public.feedback_for_trainer with (security_barrier = true) as
select f.id, f.batch_id, b.code as batch_code, coalesce(f.trainer_id, b.trainer_id) as trainer_id, t.full_name as trainer_name,
  f.subject, f.subject_ref,
  case f.subject when 'mock' then 'Mock ' || coalesce(m.level, '') when 'module' then 'Week of ' || to_char(to_date(f.subject_ref, 'IYYY-"W"IW'), 'DD Mon') else 'Whole course' end as subject_label,
  f.rating, f.comment, f.anonymous_to_trainer, f.created_at,
  case when f.anonymous_to_trainer and (f.trainer_id = auth.uid() or b.trainer_id = auth.uid()) then null else c.full_name end as student_name
from public.student_feedback f
join public.candidate c on c.id = f.candidate_id
left join public.batch b on b.id = f.batch_id
left join public.staff t on t.id = coalesce(f.trainer_id, b.trainer_id)
left join public.mock_session m on f.subject = 'mock' and m.id::text = f.subject_ref
where public.can_page('feedback', 'r')
  and (public.my_role() is distinct from 'Trainer' or f.trainer_id = auth.uid() or b.trainer_id = auth.uid());
revoke all on public.feedback_for_trainer from anon, public;
grant select on public.feedback_for_trainer to authenticated;
comment on view public.feedback_for_trainer is 'Student feedback for staff. Filters by page feedback; Trainers see own batches only; name hidden from the trainer when anonymous.';

-- What the signed-in student may rate right now (newest first). Also files one portal alert per item, once.
create or replace function public.portal_feedback_pending() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare cid uuid := public.my_candidate(); c record; out jsonb := '[]'; it record;
begin
  if cid is null then return null; end if;
  select id, stage, batch_id into c from candidate where id = cid;
  for it in
    select 'mock'::text as subject, m.id::text as ref, 'Rate your mock interview' || coalesce(' ' || m.level, '') as title,
      coalesce(m.scheduled_at, m.created_at) as at, 1 as ord
    from mock_session m
    where m.candidate_id = cid and m.status in ('Passed', 'Failed', 'Done')
      and not exists (select 1 from student_feedback f where f.candidate_id = cid and f.subject = 'mock' and f.subject_ref = m.id::text)
    union all
    select 'module', to_char(now() at time zone 'Asia/Kolkata', 'IYYY-"W"IW'), 'Rate this week’s classes', now(), 2
    where c.stage = 'Training' and c.batch_id is not null
      and not exists (select 1 from student_feedback f where f.candidate_id = cid and f.subject = 'module' and f.subject_ref = to_char(now() at time zone 'Asia/Kolkata', 'IYYY-"W"IW'))
    union all
    select 'overall', 'course', 'Rate your training overall', now(), 3
    where c.batch_id is not null and c.stage in ('Mocks', 'Resume', 'Docs', 'Ready', 'Placed')
      and not exists (select 1 from student_feedback f where f.candidate_id = cid and f.subject = 'overall')
    order by 5, 4 desc
  loop
    out := out || jsonb_build_object('subject', it.subject, 'ref', it.ref, 'title', it.title, 'at', it.at);
    if not exists (select 1 from student_notification n where n.candidate_id = cid and n.kind = 'feedback' and n.link = 'portal:feedback:' || it.subject || ':' || it.ref) then
      insert into student_notification (candidate_id, kind, title, body, link) values (cid, 'feedback', it.title, 'Takes 10 seconds. Your name stays hidden from the trainer unless you choose otherwise.', 'portal:feedback:' || it.subject || ':' || it.ref);
    end if;
  end loop;
  return out;
end $$;
revoke all on function public.portal_feedback_pending() from public, anon;
grant execute on function public.portal_feedback_pending() to authenticated;

create or replace function public.portal_feedback_submit(p_subject text, p_ref text, p_rating int, p_comment text default null, p_anonymous boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid := public.my_candidate(); c record; m record; tid uuid; nid uuid; cm text := nullif(trim(coalesce(p_comment, '')), '');
begin
  if cid is null then raise exception 'Only students can rate their training'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Choose 1 to 5 stars'; end if;
  if cm is not null and length(cm) > 1000 then raise exception 'Keep the comment under 1000 characters'; end if;
  select cd.id, cd.stage, cd.batch_id, b.trainer_id into c from candidate cd left join batch b on b.id = cd.batch_id where cd.id = cid;
  if exists (select 1 from student_feedback f where f.candidate_id = cid and f.subject = p_subject and f.subject_ref = p_ref) then
    raise exception 'You have already rated this. Thank you.';
  end if;
  if p_subject = 'mock' then
    select * into m from mock_session where id::text = p_ref and candidate_id = cid and status in ('Passed', 'Failed', 'Done');
    if not found then raise exception 'This mock interview cannot be rated'; end if;
    tid := coalesce(m.trainer_id, c.trainer_id);
  elsif p_subject = 'module' then
    if c.stage <> 'Training' or c.batch_id is null or p_ref <> to_char(now() at time zone 'Asia/Kolkata', 'IYYY-"W"IW') then raise exception 'This week cannot be rated'; end if;
    tid := c.trainer_id;
  elsif p_subject = 'overall' then
    if p_ref <> 'course' or c.batch_id is null or c.stage not in ('Mocks', 'Resume', 'Docs', 'Ready', 'Placed') then raise exception 'The course can be rated once training is over'; end if;
    tid := c.trainer_id;
  else raise exception 'Unknown item';
  end if;
  insert into student_feedback (candidate_id, batch_id, trainer_id, subject, subject_ref, rating, comment, anonymous_to_trainer)
  values (cid, c.batch_id, tid, p_subject, p_ref, p_rating, cm, coalesce(p_anonymous, true)) returning id into nid;
  update student_notification set read_at = coalesce(read_at, now()) where candidate_id = cid and kind = 'feedback' and link = 'portal:feedback:' || p_subject || ':' || p_ref;
  return nid;
exception when unique_violation then raise exception 'You have already rated this. Thank you.';
end $$;
revoke all on function public.portal_feedback_submit(text, text, int, text, boolean) from public, anon;
grant execute on function public.portal_feedback_submit(text, text, int, text, boolean) to authenticated;
