-- Where staff open Activepieces from the CRM ("Open automation builder")
insert into public.integration_config (key, value) values ('builder_url', 'http://localhost:8080') on conflict (key) do nothing;
-- Everyone who may open the Automations page can see the builder address (not the secrets)
create or replace function public.automation_builder() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.can_page('automations', 'r') or public.can_page('deliveries', 'r') then jsonb_build_object(
    'url', (select value from public.integration_config where key = 'builder_url'),
    'listening', coalesce((select jsonb_agg(jsonb_build_object('event', event, 'label', label, 'since', created_at) order by created_at) from public.integration_subscription), '[]'::jsonb))
  end
$$;
grant execute on function public.automation_builder() to authenticated;
