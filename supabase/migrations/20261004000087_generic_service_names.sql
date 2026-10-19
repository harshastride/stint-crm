-- Generic service names (owner's rule): staff and students must never learn which outside services the CRM
-- uses for speech to text or AI. Anything the database can hand to a signed-in user says "Speech to text" or
-- "AI assistant" instead of a vendor or product name, and never an environment variable name.
--
-- What this migration does on an existing database (a fresh one gets the same from seed.sql):
--   1. Connections page: the speech-to-text and AI rows get generic names.
--   2. Saved briefs and the AI usage log: the "model" column (which holds the vendor's model id) can no longer
--      be read from the browser. The server writes and reads it with the service role; the screens never used it.
--   3. Recordings: a saved processing problem ("process_error", shown on the Recordings page and in the
--      Stint Notes phone app) that names a vendor or a server setting is replaced with a plain message.
--      A trigger keeps it that way, whatever the server code writes.
-- No database function raises an error that names an AI or voice vendor, so none is recreated here.
-- Activepieces, Microsoft Teams, WhatsApp and email names stay: they appear only on Admin setup pages for
-- services the Admin sets up in that vendor's own product.

-- 1. Connections page rows. "service" is unique, so rename only when the generic row is not there yet,
--    then remove any vendor-named row left over.
update public.connection set service = 'Speech to text', used_for = 'Call and voice-note transcripts'
  where service = 'Deepgram' and not exists (select 1 from public.connection where service = 'Speech to text');
update public.connection set service = 'AI assistant', used_for = 'Summaries, briefs and call tips'
  where service = 'Claude' and not exists (select 1 from public.connection where service = 'AI assistant');
update public.connection set service = 'AI assistant', used_for = 'Summaries, briefs and call tips'
  where service = 'Gemini' and not exists (select 1 from public.connection where service = 'AI assistant');
delete from public.connection where service in ('Deepgram', 'Claude', 'Gemini');

-- 2. Hide the model id from signed-in users (row security from migration 083 still decides which rows).
revoke select on public.ai_brief from authenticated;
grant select (id, kind, staff_id, period_start, period_end, body, facts, created_by, created_at) on public.ai_brief to authenticated;
revoke select on public.ai_usage from authenticated;
grant select (id, feature, staff_id, input_tokens, output_tokens, cost_usd, ok, created_at) on public.ai_usage to authenticated;

-- 3. Recording problems in plain words.
create or replace function public.recording_generic_error() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.process_error ~* '(deepgram|claude|anthropic|gemini|haiku|sonnet|openai|supabase|postgrest|infisical|_api_key|_secret)' then
    new.process_error := 'Could not make the transcript or summary. Please try again later.';
  end if;
  return new;
end $$;

drop trigger if exists recording_generic_error on public.recording;
create trigger recording_generic_error before insert or update of process_error on public.recording
  for each row execute function public.recording_generic_error();

update public.recording set process_error = process_error
  where process_error ~* '(deepgram|claude|anthropic|gemini|haiku|sonnet|openai|supabase|postgrest|infisical|_api_key|_secret)';
