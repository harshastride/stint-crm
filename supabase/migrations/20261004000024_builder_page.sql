-- Automation builder page: Activepieces shown inside the CRM. Admin only by default;
-- give other roles access later under Roles & permissions (page "Automation builder").
insert into public.page (id, grp, title, sort) values ('builder', 'Admin settings', 'Automation builder', 43)
on conflict (id) do nothing;

create or replace function public.automation_builder() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.can_page('automations', 'r') or public.can_page('deliveries', 'r') or public.can_page('builder', 'r') then jsonb_build_object(
    'url', (select value from public.integration_config where key = 'builder_url'),
    'listening', coalesce((select jsonb_agg(jsonb_build_object('event', event, 'label', label, 'since', created_at) order by created_at) from public.integration_subscription), '[]'::jsonb))
  end
$$;
