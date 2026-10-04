-- The student's own journey for the portal: stage changes of their candidate record and the lead it came from.
create or replace function public.portal_journey() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('to_value', h.to_value, 'at', h.at) order by h.at), '[]'::jsonb)
  from status_history h join candidate c on c.id = public.my_candidate()
  where h.entity_id in (c.id, c.lead_id) and h.to_value is not null
$$;
grant execute on function public.portal_journey() to authenticated;
