-- Bell upgrade: "seen" (read_at) is separate from "dealt with" (done_at).
-- Done items leave the default list; a Done filter shows them again.
-- Staff can change only read_at / done_at on their own notifications, never the text, the link or who it is for.
-- Safe to run again.

alter table public.notification add column if not exists done_at timestamptz;

-- The open list (not done) for one person, newest first; and the unread badge.
create index if not exists notification_open_idx on public.notification (staff_id, created_at desc) where done_at is null;
create index if not exists notification_unread_idx on public.notification (staff_id) where read_at is null and done_at is null;
create index if not exists notification_done_idx on public.notification (staff_id, done_at desc) where done_at is not null;

-- Table rights: read and delete your own rows (policies below); update only the two status columns.
-- Rows are written only by database triggers (security definer), never by signed-in users directly.
revoke insert, update, truncate, references, trigger on public.notification from anon, authenticated;
revoke select, delete on public.notification from anon;
grant select, delete on public.notification to authenticated;
grant update (read_at, done_at) on public.notification to authenticated;

drop policy if exists notification_own on public.notification;
create policy notification_own on public.notification for select to authenticated using (staff_id = auth.uid());
drop policy if exists notification_read on public.notification;
create policy notification_read on public.notification for update to authenticated
  using (staff_id = auth.uid()) with check (staff_id = auth.uid());
drop policy if exists notification_del on public.notification;
create policy notification_del on public.notification for delete to authenticated using (staff_id = auth.uid());

-- One call for the bell.
--   p_ids  : the notifications to change; null means "all my notifications that are not done".
--   p_read : true = seen, false = back to unread, null = leave as is.
--   p_done : true = done (also counts as seen), false = back to the list, null = leave as is.
-- Runs as the caller, so row security and the column rights above still apply. Returns how many changed.
create or replace function public.notification_mark(p_ids uuid[] default null, p_read boolean default null, p_done boolean default null)
returns integer
language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'Please sign in again.' using errcode = '42501'; end if;
  if p_read is null and p_done is null then return 0; end if;
  if p_ids is not null and cardinality(p_ids) > 500 then raise exception 'Choose fewer notifications at a time.'; end if;
  if p_ids is null and p_done is false then raise exception 'Choose which notifications to bring back.'; end if;

  update public.notification
     set read_at = case when p_done is true or p_read is true then coalesce(read_at, now())
                        when p_read is false then null
                        else read_at end,
         done_at = case when p_done is true then coalesce(done_at, now())
                        when p_done is false then null
                        else done_at end
   where staff_id = auth.uid()
     and (case when p_ids is null then done_at is null else id = any (p_ids) end)
     and (read_at is distinct from case when p_done is true or p_read is true then coalesce(read_at, now())
                                        when p_read is false then null else read_at end
          or done_at is distinct from case when p_done is true then coalesce(done_at, now())
                                           when p_done is false then null else done_at end);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.notification_mark(uuid[], boolean, boolean) from public, anon;
grant execute on function public.notification_mark(uuid[], boolean, boolean) to authenticated;

notify pgrst, 'reload schema';
