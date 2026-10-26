-- Ad conversions: the three trigger functions of 20261004000101 run as their owner (security definer); nobody needs to call
-- them directly. Triggers still fire (EXECUTE is not checked when a trigger runs).
revoke execute on function public.ad_on_click(), public.ad_on_stage(), public.ad_on_payment() from public, anon, authenticated;
