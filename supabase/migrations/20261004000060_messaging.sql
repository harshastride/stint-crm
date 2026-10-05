-- Two-way WhatsApp + email inside the CRM. Staff queue outbound rows; the server (service role) sends them,
-- stores inbound replies and delivery updates. Contact numbers are never stored for the browser to read beyond to_addr
-- of rows the staff member queued (to_addr is filled server-side and masked in the view below).

create table if not exists public.message (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('whatsapp','email')),
  direction text not null check (direction in ('out','in')),
  lead_id uuid null references public.lead(id) on delete cascade,
  candidate_id uuid null references public.candidate(id) on delete cascade,
  to_addr text,
  from_addr text,
  subject text,
  body text,
  template text,
  status text not null default 'queued' check (status in ('queued','sent','delivered','read','failed','received')),
  error text,
  provider_id text,
  send_after timestamptz default now(),
  created_by uuid,
  created_at timestamptz default now(),
  sent_at timestamptz
);
create index if not exists message_lead_idx on public.message (lead_id, created_at);
create index if not exists message_candidate_idx on public.message (candidate_id, created_at);
create index if not exists message_queue_idx on public.message (send_after) where status = 'queued' and direction = 'out';
create index if not exists message_provider_idx on public.message (provider_id);

alter table public.message enable row level security;

-- Same visibility as notes, plus the record itself must be visible to the caller (its own RLS applies inside exists).
create or replace function public.message_visible(p_lead uuid, p_cand uuid) returns boolean
language sql stable security invoker set search_path = public as $$
  select (p_lead is not null or p_cand is not null)
    and (p_lead is null or (public.can_page('lead','r') and exists (select 1 from public.lead l where l.id = p_lead)))
    and (p_cand is null or (public.can_page('candidate','r') and exists (select 1 from public.candidate c where c.id = p_cand)))
$$;

drop policy if exists message_read on public.message;
create policy message_read on public.message for select to authenticated
  using (public.message_visible(lead_id, candidate_id) and public.recent_enough(created_at));
-- Staff may only queue outbound rows, as themselves, for records they can see. No address: the server fills it.
drop policy if exists message_ins on public.message;
create policy message_ins on public.message for insert to authenticated
  with check (direction = 'out' and status = 'queued' and created_by = auth.uid()
    and provider_id is null and sent_at is null and error is null and to_addr is null and from_addr is null
    and public.message_visible(lead_id, candidate_id));
-- No update/delete policies: only the service role changes status.

-- Staff never see raw addresses: revoke column access, expose everything else.
revoke select on public.message from authenticated, anon;
grant select (id, channel, direction, lead_id, candidate_id, subject, body, template, status, error, provider_id, send_after, created_by, created_at, sent_at) on public.message to authenticated;
grant insert (channel, direction, lead_id, candidate_id, subject, body, template, status, send_after, created_by) on public.message to authenticated;

-- Inbound reply: tell the record owner.
create or replace function public.message_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_name text; v_link text;
begin
  if new.direction <> 'in' then return new; end if;
  if new.lead_id is not null then
    select owner_id, full_name into v_owner, v_name from public.lead where id = new.lead_id;
  elsif new.candidate_id is not null then
    select poc_id, full_name into v_owner, v_name from public.candidate where id = new.candidate_id;
  end if;
  v_link := public.person_link(new.lead_id, new.candidate_id);
  if v_owner is not null then
    insert into public.notification (staff_id, kind, title, body, link)
    values (v_owner, 'message', 'New ' || case when new.channel = 'whatsapp' then 'WhatsApp' else 'email' end || ' from ' || coalesce(v_name, 'a contact'), left(coalesce(new.body, ''), 140), v_link);
  end if;
  return new;
end $$;
drop trigger if exists message_notify on public.message;
create trigger message_notify after insert on public.message for each row execute function public.message_notify();

-- Templates (Admin settings → Message templates)
create table if not exists public.message_template (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'whatsapp' check (channel in ('whatsapp','email')),
  name text not null,
  subject text,
  body text not null,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.message_template enable row level security;
drop policy if exists message_template_read on public.message_template;
create policy message_template_read on public.message_template for select to authenticated
  using (public.can_page('templates','r') or public.can_page('lead','r') or public.can_page('candidate','r'));
drop policy if exists message_template_write on public.message_template;
create policy message_template_write on public.message_template for all to authenticated
  using (public.can_page('templates','w')) with check (public.can_page('templates','w'));
grant select, insert, update, delete on public.message_template to authenticated;

insert into public.page (id, grp, title, sort) values ('templates', 'Admin settings', 'Message templates', 44) on conflict (id) do nothing;
