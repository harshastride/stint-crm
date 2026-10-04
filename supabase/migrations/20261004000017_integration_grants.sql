-- The sender job may also be run by the server (tests, a manual "send now").
grant execute on function public.dispatch_events() to service_role;
