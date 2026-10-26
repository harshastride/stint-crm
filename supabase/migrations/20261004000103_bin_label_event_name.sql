-- Recycle bin: give removed ad conversion rules a readable label (their name column is event_name).
create or replace function public.bin_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare d jsonb := to_jsonb(old);
begin
  if current_setting('stint.no_bin', true) = 'on' then return old; end if;
  insert into recycle_bin (table_name, row_id, row_label, data)
  values (tg_table_name, coalesce(d ->> 'id', d ->> 'key', d ->> 'candidate_id'),
          left(coalesce(d ->> 'full_name', d ->> 'name', d ->> 'title', d ->> 'doc_type', d ->> 'version', d ->> 'item', d ->> 'message',
                        d ->> 'event_name'), 120), d);
  return old;
end $$;
revoke execute on function public.bin_row() from public, anon, authenticated;
