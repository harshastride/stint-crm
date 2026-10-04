-- Stint CRM · business tables, in the order of the student journey

-- Marketing
create table public.campaign (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel text,
  status text not null default 'Planned',
  budget numeric(12, 2) not null default 0,
  starts_on date,
  created_at timestamptz not null default now()
);

create table public.lead_source (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  type text not null default 'Organic',
  connection text not null default 'Manual',
  cost_per_lead numeric(10, 2),
  last_lead_at timestamptz,
  created_at timestamptz not null default now()
);

-- Enrolment reference data (needed by leads and candidates)
create table public.program (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  duration_weeks int,
  fee numeric(12, 2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.batch (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  program_id uuid references public.program (id),
  trainer_id uuid references public.staff (id),
  branch_id uuid references public.branch (id),
  starts_on date,
  status text not null default 'Live',
  created_at timestamptz not null default now()
);

-- Telecalling
create table public.lead (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  mobile text not null unique,
  email text,
  city text,
  program_id uuid references public.program (id),
  course_other text,
  preferred_mode text,
  preferred_start text,
  currently text,
  source_id uuid references public.lead_source (id),
  campaign_id uuid references public.campaign (id),
  referred_by text,
  notes text,
  stage text not null default 'New',
  owner_id uuid references public.staff (id),
  next_call_at timestamptz,
  stage_changed_at timestamptz not null default now(),
  created_by uuid references public.staff (id),
  created_at timestamptz not null default now()
);
create index lead_stage_idx on public.lead (stage);
create index lead_owner_idx on public.lead (owner_id);

create table public.call_log (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.lead (id) on delete cascade,
  caller_id uuid references public.staff (id),
  outcome text not null,
  duration_sec int not null default 0,
  notes text,
  called_at timestamptz not null default now()
);

-- Sales
create table public.counselling_session (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.lead (id) on delete cascade,
  counsellor_id uuid references public.staff (id),
  program_id uuid references public.program (id),
  status text not null default 'Booked',
  scheduled_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create table public.fee_quote (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.lead (id) on delete cascade,
  program_id uuid not null references public.program (id),
  list_price numeric(12, 2) not null,
  discount_pct numeric(5, 2) not null default 0,
  amount numeric(12, 2) not null,
  plan text not null default '3 instalments',
  valid_until date,
  status text not null default 'Sent',
  needs_approval boolean not null default false,
  approved_by uuid references public.staff (id),
  created_by uuid references public.staff (id),
  created_at timestamptz not null default now()
);

create table public.sales_target (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id) on delete cascade,
  month date not null,
  target int not null default 0,
  unique (staff_id, month)
);

-- Enrolment
create table public.candidate (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  full_name text not null,
  lead_id uuid references public.lead (id),
  program_id uuid references public.program (id),
  batch_id uuid references public.batch (id),
  stage text not null default 'Enrolled',
  poc_id uuid references public.staff (id),
  joined_on date not null default current_date,
  profile jsonb not null default '{}'::jsonb,      -- date of birth, marital status, marks, referred by
  education jsonb not null default '[]'::jsonb,
  experience jsonb not null default '[]'::jsonb,
  stage_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index candidate_stage_idx on public.candidate (stage);

-- Sensitive groups live apart so they can be masked or hidden per role
create table public.candidate_private (
  candidate_id uuid primary key references public.candidate (id) on delete cascade,
  contact jsonb not null default '{}'::jsonb,
  family jsonb not null default '{}'::jsonb,
  identity jsonb not null default '{}'::jsonb,
  bank jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Training
create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batch (id) on delete cascade,
  candidate_id uuid not null references public.candidate (id) on delete cascade,
  day date not null,
  mark text not null check (mark in ('P', 'A', 'L')),
  marked_by uuid references public.staff (id),
  unique (candidate_id, day)
);

create table public.training_note (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate (id) on delete cascade,
  trainer_id uuid references public.staff (id),
  note text not null,
  flag text,
  created_at timestamptz not null default now()
);

-- Mocks
create table public.mock_session (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate (id) on delete cascade,
  trainer_id uuid references public.staff (id),
  level text not null default 'L1',
  status text not null default 'Booked',
  scheduled_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.sme_feedback (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate (id) on delete cascade,
  mock_session_id uuid references public.mock_session (id) on delete set null,
  sme_id uuid references public.staff (id),
  rating int check (rating between 1 and 5),
  verdict text,
  comments text,
  created_at timestamptz not null default now()
);

-- Resume and documents
create table public.resume_version (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate (id) on delete cascade,
  version text not null,
  file_path text,
  reviewer_id uuid references public.staff (id),
  status text not null default 'Pending',
  reason text,
  created_at timestamptz not null default now()
);

create table public.candidate_document (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate (id) on delete cascade,
  doc_type text not null,
  status text not null default 'Missing',
  file_path text,
  verified_by uuid references public.staff (id),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.vendor_request (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate (id) on delete cascade,
  vendor text not null,
  request text not null,
  send_with text,
  status text not null default 'Open',
  due_on date,
  note text,
  created_by uuid references public.staff (id),
  created_at timestamptz not null default now()
);

-- A real job a candidate holds at a partner company, and the papers it produces
create table public.job_record (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate (id) on delete cascade,
  company text not null,
  role text,
  joined_on date not null,
  last_working_day date,
  pf_status text not null default 'Not applied',
  status text not null default 'Open',
  created_at timestamptz not null default now(),
  check (last_working_day is null or last_working_day >= joined_on)
);

create table public.job_paper (
  job_record_id uuid not null references public.job_record (id) on delete cascade,
  paper text not null,
  status text not null default 'Requested',
  updated_at timestamptz not null default now(),
  primary key (job_record_id, paper)
);

-- Placement
create table public.company (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  openings int not null default 0,
  contact text,
  status text not null default 'Prospect',
  created_at timestamptz not null default now()
);

create table public.placement (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate (id) on delete cascade,
  company_id uuid references public.company (id),
  role text,
  ctc_lpa numeric(6, 2),
  joining_on date,
  status text not null default 'Joining soon',
  created_at timestamptz not null default now()
);

create table public.placement_checklist_item (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate (id) on delete cascade,
  item text not null,
  owner_id uuid references public.staff (id),
  status text not null default 'Pending',
  due_on date,
  created_at timestamptz not null default now()
);

create table public.alumni_followup (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate (id) on delete cascade,
  note text,
  referrals int not null default 0,
  contacted_on date not null default current_date,
  by_id uuid references public.staff (id)
);

-- Fees
create table public.fee_plan (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null unique references public.candidate (id) on delete cascade,
  total numeric(12, 2) not null,
  plan text not null default '3 instalments',
  created_at timestamptz not null default now()
);

create table public.fee_payment (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate (id) on delete cascade,
  amount numeric(12, 2) not null,
  mode text,
  receipt_no text,
  status text not null default 'Due',
  due_on date,
  paid_on date,
  created_by uuid references public.staff (id),
  created_at timestamptz not null default now()
);

-- Work that cuts across stages
create table public.follow_up (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  lead_id uuid references public.lead (id) on delete cascade,
  candidate_id uuid references public.candidate (id) on delete cascade,
  owner_id uuid references public.staff (id),
  owner_role text references public.app_role (name) on update cascade,
  due_at timestamptz not null default now(),
  status text not null default 'Open',
  created_by uuid references public.staff (id),
  created_at timestamptz not null default now()
);

create table public.note (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.lead (id) on delete cascade,
  candidate_id uuid references public.candidate (id) on delete cascade,
  kind text not null default 'Note',
  body text not null,
  visibility text not null default 'Internal',
  by_id uuid references public.staff (id),
  created_at timestamptz not null default now(),
  check (lead_id is not null or candidate_id is not null)
);
create index note_lead_idx on public.note (lead_id);
create index note_candidate_idx on public.note (candidate_id);

create table public.recording (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.lead (id) on delete set null,
  candidate_id uuid references public.candidate (id) on delete set null,
  number text,
  captured_by uuid references public.staff (id),
  source text not null default 'Record button',
  length_sec int not null default 0,
  transcript jsonb not null default '[]'::jsonb,
  summary text,
  outcome text,
  follow_up text,
  status text not null default 'Unmatched',
  consent boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.alert (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  area text,
  lead_id uuid references public.lead (id) on delete cascade,
  candidate_id uuid references public.candidate (id) on delete cascade,
  owner_id uuid references public.staff (id),
  priority text not null default 'Medium',
  status text not null default 'Open',
  raised_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.status_history (
  id uuid primary key default gen_random_uuid(),
  entity text not null,
  entity_id uuid not null,
  person_name text,
  what text not null,
  from_value text,
  to_value text,
  by_id uuid,
  at timestamptz not null default now()
);
create index status_history_entity_idx on public.status_history (entity, entity_id);

-- Admin settings
create table public.assignment_rule (
  id uuid primary key default gen_random_uuid(),
  when_text text not null,
  give_to text not null,
  method text not null default 'Round-robin, in turn',
  limit_per_person text,
  status text not null default 'Live'
);

create table public.follow_rule (
  id uuid primary key default gen_random_uuid(),
  trigger text not null,
  suggest_next text not null,
  after text,
  stage text,
  stuck_after_days int,
  status text not null default 'Live'
);

create table public.import_run (
  id uuid primary key default gen_random_uuid(),
  file text not null,
  into_table text not null,
  total_rows int not null default 0,
  ok_rows int not null default 0,
  failed_rows int not null default 0,
  duplicate_rows int not null default 0,
  by_id uuid references public.staff (id),
  created_at timestamptz not null default now()
);

create table public.automation (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  direction text not null default 'Outgoing',
  trigger text,
  channel text,
  recipient text,
  message text,
  status text not null default 'Paused',
  sent_week int not null default 0,
  failed_week int not null default 0
);

create table public.connection (
  id uuid primary key default gen_random_uuid(),
  service text not null unique,
  used_for text,
  status text not null default 'Not set up',
  last_checked_at timestamptz
);
