-- Attaching an unmatched recording to a person moves it on (to confirm if a draft exists).
create or replace function public.recording_matched() returns trigger
language plpgsql as $$
begin
  if new.status = 'Unmatched' and (new.lead_id is not null or new.candidate_id is not null) then
    new.status := case when new.draft is not null then 'Waiting to confirm' else 'Recorded' end;
  end if;
  return new;
end $$;
create trigger recording_matched before update of lead_id, candidate_id on public.recording for each row execute function public.recording_matched();
