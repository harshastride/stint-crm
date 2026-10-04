-- Stint CRM · row security.  The page grid (role_page_access) decides everything:
-- a role that can view a page can read its table; a role that can edit the page can write it.

-- 1. Reference tables: every active staff member can read; only the owning page can write
do $$
declare r record;
begin
  for r in select * from (values
      ('app_role', 'roles'), ('page', 'roles'), ('role_page_access', 'roles'), ('role_field_access', 'roles'),
      ('dropdown_list', 'dropdowns'), ('dropdown_value', 'dropdowns'), ('setting', 'branding'),
      ('staff', 'users'), ('branch', 'branch'), ('program', 'program'), ('batch', 'batch'),
      ('company', 'company'), ('lead_source', 'source'), ('campaign', 'campaign')
    ) as t (tbl, page)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);
    execute format('create policy %I on public.%I for select to authenticated using (public.my_role() is not null)', r.tbl || '_read', r.tbl);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_page(%L, ''w''))', r.tbl || '_ins', r.tbl, r.page);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_page(%L, ''w'')) with check (public.can_page(%L, ''w''))', r.tbl || '_upd', r.tbl, r.page, r.page);
    execute format('create policy %I on public.%I for delete to authenticated using (public.can_page(%L, ''w''))', r.tbl || '_del', r.tbl, r.page);
  end loop;
end $$;

-- 2. Business tables: read and write follow the page
do $$
declare r record;
begin
  for r in select * from (values
      ('call_log', 'call'), ('counselling_session', 'counsel'), ('fee_quote', 'quote'), ('sales_target', 'target'),
      ('attendance', 'attendance'), ('training_note', 'note'), ('mock_session', 'mock'), ('sme_feedback', 'sme'),
      ('resume_version', 'resume'), ('candidate_document', 'doc'), ('vendor_request', 'vendor'),
      ('job_record', 'jobdocs'), ('job_paper', 'jobdocs'), ('placement', 'placement'),
      ('placement_checklist_item', 'checklist'), ('alumni_followup', 'alumni'),
      ('fee_plan', 'plan'), ('fee_payment', 'payment'), ('alert', 'alert'),
      ('assignment_rule', 'assign'), ('follow_rule', 'followrules'), ('import_run', 'imports'),
      ('automation', 'automations'), ('connection', 'connections')
    ) as t (tbl, page)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);
    execute format('create policy %I on public.%I for select to authenticated using (public.can_page(%L, ''r''))', r.tbl || '_read', r.tbl, r.page);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_page(%L, ''w''))', r.tbl || '_ins', r.tbl, r.page);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_page(%L, ''w'')) with check (public.can_page(%L, ''w''))', r.tbl || '_upd', r.tbl, r.page, r.page);
    execute format('create policy %I on public.%I for delete to authenticated using (public.can_page(%L, ''w''))', r.tbl || '_del', r.tbl, r.page);
  end loop;
end $$;

-- 3. Leads: the front desk enquiry form may also create them
alter table public.lead enable row level security;
create policy lead_read on public.lead for select to authenticated using (public.can_page('lead', 'r') or public.can_page('enquiry', 'r'));
create policy lead_ins on public.lead for insert to authenticated with check (public.can_page('lead', 'w') or public.can_page('enquiry', 'w'));
create policy lead_upd on public.lead for update to authenticated using (public.can_page('lead', 'w')) with check (public.can_page('lead', 'w'));
create policy lead_del on public.lead for delete to authenticated using (public.is_admin());

-- 4. Candidates: the enrolment form may also create and fill them
alter table public.candidate enable row level security;
create policy candidate_read on public.candidate for select to authenticated using (public.can_page('candidate', 'r') or public.can_page('enrolform', 'r'));
create policy candidate_ins on public.candidate for insert to authenticated with check (public.can_page('candidate', 'w') or public.can_page('enrolform', 'w'));
create policy candidate_upd on public.candidate for update to authenticated using (public.can_page('candidate', 'w') or public.can_page('enrolform', 'w')) with check (public.can_page('candidate', 'w') or public.can_page('enrolform', 'w'));
create policy candidate_del on public.candidate for delete to authenticated using (public.is_admin());

-- 5. Sensitive details: only through the masking functions (see logic migration); admins may read directly
alter table public.candidate_private enable row level security;
create policy candidate_private_admin on public.candidate_private for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 6. Follow-ups: yours, your team's, or everyone's for an admin
alter table public.follow_up enable row level security;
create policy follow_up_read on public.follow_up for select to authenticated
  using (public.can_page('followups', 'r') and (public.is_admin() or owner_id = auth.uid() or owner_role = public.my_role() or created_by = auth.uid()));
create policy follow_up_ins on public.follow_up for insert to authenticated with check (public.can_page('followups', 'w'));
create policy follow_up_upd on public.follow_up for update to authenticated
  using (public.can_page('followups', 'w') and (public.is_admin() or owner_id = auth.uid() or owner_role = public.my_role() or created_by = auth.uid()))
  with check (public.can_page('followups', 'w'));
create policy follow_up_del on public.follow_up for delete to authenticated using (public.is_admin() or created_by = auth.uid());

-- 7. Notes: anyone who can see the person can read and add; only the author or an admin can change
alter table public.note enable row level security;
create policy note_read on public.note for select to authenticated
  using ((lead_id is not null and public.can_page('lead', 'r')) or (candidate_id is not null and public.can_page('candidate', 'r')));
create policy note_ins on public.note for insert to authenticated
  with check (by_id = auth.uid() and ((lead_id is not null and public.can_page('lead', 'r')) or (candidate_id is not null and public.can_page('candidate', 'r'))));
create policy note_upd on public.note for update to authenticated using (by_id = auth.uid() or public.is_admin()) with check (by_id = auth.uid() or public.is_admin());
create policy note_del on public.note for delete to authenticated using (by_id = auth.uid() or public.is_admin());

-- 8. Recordings: the Recordings page, plus anyone who pressed Record on a person they can work on
alter table public.recording enable row level security;
create policy recording_read on public.recording for select to authenticated using (public.can_page('recordings', 'r') or captured_by = auth.uid());
create policy recording_ins on public.recording for insert to authenticated
  with check (captured_by = auth.uid() and consent = true and (public.can_page('recordings', 'w') or public.can_page('lead', 'w') or public.can_page('candidate', 'r')));
create policy recording_upd on public.recording for update to authenticated using (public.can_page('recordings', 'w') or captured_by = auth.uid()) with check (public.can_page('recordings', 'w') or captured_by = auth.uid());
create policy recording_del on public.recording for delete to authenticated using (public.can_page('recordings', 'w') or captured_by = auth.uid());

-- 9. Status history: written only by triggers; readable on the History page and on a person's timeline
alter table public.status_history enable row level security;
create policy status_history_read on public.status_history for select to authenticated
  using (public.can_page('history', 'r') or (entity = 'lead' and public.can_page('lead', 'r')) or (entity = 'candidate' and public.can_page('candidate', 'r')));

-- Nothing for visitors who are not logged in
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
