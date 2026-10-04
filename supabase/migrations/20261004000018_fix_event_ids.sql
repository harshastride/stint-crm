-- Fix: event rows for counselling and quotes failed because the function named candidate_id on rows without it.
create or replace function public.events_candidate_side() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev text; extra jsonb := '{}'; who text;
begin
  case tg_table_name
    when 'counselling_session' then
      if tg_op = 'INSERT' then ev := 'counselling.booked';
        extra := jsonb_build_object('lead', public.lead_brief(new.lead_id), 'scheduled_at', new.scheduled_at,
          'counsellor', (select full_name from public.staff where id = new.counsellor_id)); end if;
    when 'fee_quote' then
      if new.status = 'Sent' and (tg_op = 'INSERT' or old.status is distinct from 'Sent') then ev := 'quote.sent';
        extra := jsonb_build_object('lead', public.lead_brief(new.lead_id), 'amount', new.amount, 'discount_pct', new.discount_pct,
          'instalments', new.instalments, 'valid_until', new.valid_until, 'program', (select name from public.program where id = new.program_id)); end if;
    when 'fee_payment' then
      if new.status = 'Received' and (tg_op = 'INSERT' or old.status is distinct from 'Received') then ev := 'payment.recorded';
        extra := jsonb_build_object('candidate', public.candidate_brief(new.candidate_id), 'amount', new.amount, 'mode', new.mode,
          'receipt_no', new.receipt_no, 'paid_on', new.paid_on, 'for', new.label); end if;
    when 'mock_session' then
      if tg_op = 'INSERT' and new.status = 'Booked' then ev := 'mock.booked';
      elsif new.status in ('Passed', 'Failed') and (tg_op = 'INSERT' or old.status is distinct from new.status) then ev := 'mock.result'; end if;
      if ev is not null then extra := jsonb_build_object('candidate', public.candidate_brief(new.candidate_id), 'status', new.status, 'level', new.level); end if;
    when 'resume_version' then
      if new.status = 'Rejected' and (tg_op = 'INSERT' or old.status is distinct from 'Rejected') then ev := 'resume.rejected';
        extra := jsonb_build_object('candidate', public.candidate_brief(new.candidate_id), 'version', new.version, 'reason', new.reason); end if;
    when 'vendor_request' then
      if tg_op = 'INSERT' then ev := 'vendor_request.created';
        extra := jsonb_build_object('candidate', public.candidate_brief(new.candidate_id), 'request', to_jsonb(new) - 'candidate_id'); end if;
    when 'placement' then
      if tg_op = 'INSERT' then ev := 'placement.recorded';
        extra := jsonb_build_object('candidate', public.candidate_brief(new.candidate_id), 'role', new.role, 'ctc_lpa', new.ctc_lpa,
          'joining_on', new.joining_on, 'company', (select name from public.company where id = new.company_id)); end if;
  end case;
  if ev is null then return null; end if;
  who := coalesce(extra #>> '{candidate,name}', extra #>> '{lead,name}');
  -- to_jsonb: a SQL expression must not name a column the row type lacks (counselling has no candidate_id)
  perform public.emit_event(ev, case when tg_table_name in ('counselling_session', 'fee_quote') then 'lead' else 'candidate' end,
    (to_jsonb(new) ->> case when tg_table_name in ('counselling_session', 'fee_quote') then 'lead_id' else 'candidate_id' end)::uuid, who, extra);
  return null;
end $$;
