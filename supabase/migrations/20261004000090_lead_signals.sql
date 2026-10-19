-- 090 · Lead signals: a hot-lead score (0–100) and the best time to call, for every open lead.
-- Rule-based and explainable (no AI). Read through the view public.lead_signal (security invoker, so the
-- lead row rules decide which leads appear). The per-lead maths runs in lead_signal_calc, a security-definer
-- function that re-checks the same lead visibility rules itself, so every role gets the same score for the
-- same lead (a telecaller cannot read fee quotes, but a sent quote still raises the score) and nothing is
-- returned for a lead the caller cannot see. Only derived numbers and plain phrases leave the function:
-- never contact details, notes or call rows.
-- Safe to re-run.

-- "Picked up and talked": the outcomes that count as a two-way call for best time and the pickup heatmap.
create or replace function public.call_answered(p_outcome text) returns boolean
language sql immutable as $$
  select p_outcome in ('Connected', 'Interested', 'Callback', 'Booked counselling')
$$;

-- "6–8 pm", "11 am–1 pm", "12–2 pm" (to = end hour, not included)
create or replace function public.hour_range_label(p_from int, p_to int) returns text
language sql immutable as $$
  select case when p_from is null or p_to is null then null else
    (case when p_from % 12 = 0 then 12 else p_from % 12 end)::text
    || case when (p_from >= 12) = ((p_to % 24) >= 12) and p_to < 24 then '' else case when p_from >= 12 then ' pm' else ' am' end end
    || '–' || (case when p_to % 12 = 0 then 12 else p_to % 12 end)::text
    || case when (p_to % 24) >= 12 then ' pm' else ' am' end
  end
$$;

-- "today", "yesterday", "3 days ago" (India dates)
create or replace function public.when_words(p_at timestamptz) returns text
language sql stable as $$
  select case d when 0 then 'today' when 1 then 'yesterday' else d || ' days ago' end
  from (select ((now() at time zone 'Asia/Kolkata')::date - (p_at at time zone 'Asia/Kolkata')::date) as d) x
$$;

create index if not exists call_log_lead_called_idx on public.call_log (lead_id, called_at desc);
create index if not exists call_log_called_idx on public.call_log (called_at desc);
create index if not exists counselling_session_lead_idx on public.counselling_session (lead_id);
create index if not exists fee_quote_lead_idx on public.fee_quote (lead_id);

-- Team-wide best 2-hour window (start hour 9–20, India time), overall (source_id null) and per lead source.
-- Window rank: best pickup rate among windows with at least 5 calls; if no window has 5 calls, the most
-- answered calls (at least 2); a per-source time needs 5+ calls in the slot. Counts every call in the last p_days days (not limited by who made it):
-- only these team totals leave the function. Nothing for roles that cannot see leads.
create or replace function public.pickup_windows(p_days int default 60)
returns table (source_id uuid, best_from int, calls int, answered int)
language sql stable security definer rows 20 set search_path = public as $$
  with ok as (select (public.can_page('lead', 'r') or public.can_page('enquiry', 'r')
                      or coalesce(auth.role(), '') not in ('authenticated', 'anon')) as yes),   -- server jobs and the service key
  c as (
    select l.source_id, extract(hour from cl.called_at at time zone 'Asia/Kolkata')::int as h, public.call_answered(cl.outcome) as a
    from public.call_log cl join public.lead l on l.id = cl.lead_id, ok
    where ok.yes and cl.called_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 60), 1), 365))
  ),
  hours as (select generate_series(9, 20) as h0),
  win as (   -- grouping sets: per source and overall (source null)
    select g.source_id, g.h0, count(*)::int as calls, count(*) filter (where g.a)::int as answered, grouping(g.source_id) as overall
    from (select c.source_id, hours.h0, c.a from c join hours on c.h in (hours.h0, hours.h0 + 1)) g
    group by grouping sets ((g.source_id, g.h0), (g.h0))
  ),
  ranked as (
    select w.*, row_number() over (partition by w.overall, w.source_id
      order by (w.calls >= 5) desc,
               case when w.calls >= 5 then w.answered::numeric / w.calls end desc nulls last,
               w.answered desc, w.h0 desc) as rn
    from win w where w.answered >= 2 and (w.overall = 1 or w.calls >= 5)   -- a source needs 5+ calls in the slot, else the overall time is used
  )
  select case when overall = 1 then null else r.source_id end, r.h0, r.calls, r.answered
  from ranked r
  where r.rn = 1 and (r.overall = 1 or r.source_id is not null)
$$;
revoke execute on function public.pickup_windows(int) from public, anon;
grant execute on function public.pickup_windows(int) to authenticated, service_role;

-- The score for one lead. Returns no row when the caller cannot see the lead or the lead is closed.
create or replace function public.lead_signal_calc(p_lead uuid)
returns table (score int, band text, reasons text[], own_from int, own_answered int, last_contact_at timestamptz)
language plpgsql stable security definer rows 1 set search_path = public as $$
declare
  l public.lead;
  r jsonb := '[]'::jsonb;      -- [{p: points, t: phrase}]
  base int; total int;
  calls_n int; no_ans int; wrong boolean; last_out text; last_at timestamptz;
  pos_out text; pos_at timestamptz; contact_at timestamptz;
  sess_booked boolean; sess_done timestamptz; sess_noshow boolean;
  q_status text;
  b_last timestamptz; b_secs int; b_days int;
  w_from int; w_n int;
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into l from public.lead where id = p_lead;
  if l.id is null or l.stage in ('Converted', 'Not interested') then return; end if;
  -- the same rules as the lead's own row security (server jobs and the service key, which have no staff role, pass)
  if coalesce(auth.role(), '') in ('authenticated', 'anon') and not public.is_admin() and not (
       (public.can_page('lead', 'r') or public.can_page('enquiry', 'r'))
       and public.lead_stage_visible(l.stage)
       and public.lead_row_visible(l.stage, l.owner_id, l.created_by)) then
    return;
  end if;

  -- 1. where the lead is in the journey
  base := case l.stage when 'New' then 20 when 'Callback' then 25 when 'Interested' then 40 when 'Counselling' then 50 else 20 end;

  -- 2. calls (last 60 days)
  select count(*), max(called_at) filter (where public.call_answered(outcome)) into calls_n, contact_at
  from public.call_log where lead_id = l.id and called_at >= now() - interval '60 days';
  select outcome, called_at into last_out, last_at from public.call_log where lead_id = l.id order by called_at desc limit 1;
  -- no answer in a row since the last real talk
  select count(*) filter (where outcome = 'No answer'), coalesce(bool_or(outcome = 'Wrong number'), false) into no_ans, wrong
  from public.call_log where lead_id = l.id and called_at >= now() - interval '60 days' and called_at > coalesce(contact_at, '-infinity'::timestamptz);
  -- the strongest positive outcome in the last 14 days (latest first on ties)
  select outcome, called_at into pos_out, pos_at from public.call_log
  where lead_id = l.id and called_at >= now() - interval '14 days' and outcome in ('Booked counselling', 'Interested', 'Callback', 'Connected')
  order by case outcome when 'Booked counselling' then 1 when 'Interested' then 2 when 'Callback' then 3 else 4 end, called_at desc limit 1;

  if pos_out = 'Booked counselling' then r := r || jsonb_build_object('p', 15, 't', 'Booked counselling on a call ' || public.when_words(pos_at));
  elsif pos_out = 'Interested' then r := r || jsonb_build_object('p', 15, 't', 'Said interested ' || public.when_words(pos_at));
  elsif pos_out = 'Callback' then r := r || jsonb_build_object('p', 10, 't', 'Asked for a callback ' || public.when_words(pos_at));
  elsif pos_out = 'Connected' then r := r || jsonb_build_object('p', 5, 't', 'Spoke ' || public.when_words(pos_at));
  end if;
  if last_out = 'Not interested' then r := r || jsonb_build_object('p', -20, 't', 'Said not interested on the last call'); end if;
  if wrong or last_out = 'Wrong number' then r := r || jsonb_build_object('p', -40, 't', 'Wrong number logged');
  elsif no_ans >= 3 then r := r || jsonb_build_object('p', -15, 't', 'No answer ' || no_ans || ' times');
  elsif no_ans = 2 then r := r || jsonb_build_object('p', -6, 't', 'No answer 2 times');
  end if;

  -- 3. counselling and fee quote
  select coalesce(bool_or(status = 'Booked' and (scheduled_at is null or scheduled_at >= now() - interval '12 hours')), false),
         max(coalesce(scheduled_at, created_at)) filter (where status in ('Done', 'Won')),
         coalesce(bool_or(status = 'No-show' and coalesce(scheduled_at, created_at) >= now() - interval '14 days'), false)
    into sess_booked, sess_done, sess_noshow
  from public.counselling_session where lead_id = l.id;
  if sess_booked then r := r || jsonb_build_object('p', 15, 't', 'Counselling booked');
  elsif sess_done >= now() - interval '30 days' then r := r || jsonb_build_object('p', 10, 't', 'Attended counselling');
  end if;
  if sess_noshow and not sess_booked then r := r || jsonb_build_object('p', -10, 't', 'Missed counselling'); end if;
  if sess_done is not null then contact_at := greatest(contact_at, sess_done); end if;

  select status into q_status from public.fee_quote
  where lead_id = l.id and status in ('Sent', 'Negotiating') and created_at >= now() - interval '30 days'
    and (valid_until is null or valid_until >= today)
  order by case status when 'Negotiating' then 1 else 2 end, created_at desc limit 1;
  if q_status = 'Negotiating' then r := r || jsonb_build_object('p', 12, 't', 'Talking about the fee');
  elsif q_status = 'Sent' then r := r || jsonb_build_object('p', 10, 't', 'Fee quote sent');
  end if;

  -- 4. brochure reading (recent opens weigh more)
  select max(opened_at), coalesce(sum(seconds), 0) into b_last, b_secs
  from public.brochure_view where lead_id = l.id and opened_at >= now() - interval '14 days';
  if b_last is not null then
    b_days := today - (b_last at time zone 'Asia/Kolkata')::date;
    r := r || jsonb_build_object('p', case when b_days = 0 then 20 when b_days <= 3 then 12 else 6 end,
                                 't', 'Opened the brochure ' || public.when_words(b_last));
    if b_secs >= 180 then r := r || jsonb_build_object('p', 5, 't', 'Read the brochure for ' || (b_secs / 60) || ' min'); end if;
  end if;

  -- 5. a fresh enquiry nobody has called yet is worth calling fast
  if last_at is null and l.stage = 'New' then
    if (l.created_at at time zone 'Asia/Kolkata')::date = today then r := r || jsonb_build_object('p', 25, 't', 'New enquiry today, not called yet');
    elsif (l.created_at at time zone 'Asia/Kolkata')::date = today - 1 then r := r || jsonb_build_object('p', 15, 't', 'New enquiry yesterday, not called yet');
    else r := r || jsonb_build_object('p', 0, 't', 'Not called yet');
    end if;
  end if;

  -- 6. going cold: days since the last two-way talk
  if contact_at is not null and contact_at < now() - interval '7 days' then
    r := r || jsonb_build_object('p', -least(25, extract(day from now() - contact_at)::int - 7),
                                 't', 'No talk for ' || extract(day from now() - contact_at)::int || ' days');
  end if;

  total := base + coalesce((select sum((x ->> 'p')::int) from jsonb_array_elements(r) x), 0);
  total := least(100, greatest(0, total));
  score := total;
  band := case when total >= 70 then 'Hot' when total >= 40 then 'Warm' else 'Cold' end;
  -- top 3 phrases by how much they moved the score; the stage fills in when there are fewer
  reasons := array(
    select t from (
      select x ->> 't' as t, abs((x ->> 'p')::int) as w, 0 as k from jsonb_array_elements(r) x
      union all select 'Stage: ' || l.stage, 0, 1
    ) y order by k, w desc limit 3);

  -- best time from this lead's own answered calls (needs at least 2)
  select h.h0, count(*)::int into w_from, w_n
  from public.call_log cl
  join generate_series(9, 20) h(h0) on extract(hour from cl.called_at at time zone 'Asia/Kolkata')::int in (h.h0, h.h0 + 1)
  where cl.lead_id = l.id and public.call_answered(cl.outcome)
  group by h.h0
  having count(*) >= 2
  order by count(*) desc, max(cl.called_at) desc, h.h0
  limit 1;
  own_from := w_from; own_answered := w_n;
  last_contact_at := contact_at;
  return next;
end $$;
revoke execute on function public.lead_signal_calc(uuid) from public, anon;
grant execute on function public.lead_signal_calc(uuid) to authenticated, service_role;

-- One row per open lead the caller can see.
-- best_from / best_to: India-time hours, best_to is the end hour (not included), e.g. 18 and 20 = "6–8 pm".
create or replace view public.lead_signal with (security_invoker = true) as
  with team as materialized (select * from public.pickup_windows(60))
  select l.id as lead_id, c.score, c.band, c.reasons,
         coalesce(c.own_from, ts.best_from, ta.best_from) as best_from,
         coalesce(c.own_from, ts.best_from, ta.best_from) + 2 as best_to,
         case when c.own_from is not null then 'Usually answers ' || public.hour_range_label(c.own_from, c.own_from + 2)
              when coalesce(ts.best_from, ta.best_from) is not null
                then 'Most leads answer ' || public.hour_range_label(coalesce(ts.best_from, ta.best_from), coalesce(ts.best_from, ta.best_from) + 2)
         end as best_label,
         c.last_contact_at
  from public.lead_list l
  cross join lateral public.lead_signal_calc(l.id) c
  left join team ts on ts.source_id = l.source_id
  left join team ta on ta.source_id is null
  where l.stage not in ('Converted', 'Not interested');
revoke all on public.lead_signal from anon;
grant select on public.lead_signal to authenticated, service_role;

-- Lets the lead list read the signal in the same request: select=*,signal:lead_signal_of(score,band,reasons,best_label)
create or replace function public.lead_signal_of(public.lead_list) returns setof public.lead_signal
language sql stable rows 1 as $$
  select * from public.lead_signal where lead_id = $1.id
$$;
-- …and sort the list by score: order=lead_score.desc.nullslast
create or replace function public.lead_score(public.lead_list) returns int
language sql stable as $$
  select score from public.lead_signal where lead_id = $1.id
$$;
revoke execute on function public.lead_signal_of(public.lead_list), public.lead_score(public.lead_list) from public, anon;
grant execute on function public.lead_signal_of(public.lead_list), public.lead_score(public.lead_list) to authenticated, service_role;

-- Team pickup heatmap: calls the caller can see (their row rules apply), by India weekday (1 = Monday) and hour 9–21.
create or replace function public.pickup_heatmap(p_days int default 60)
returns table (weekday int, hour int, calls int, connected int)
language sql stable security invoker set search_path = public as $$
  select extract(isodow from called_at at time zone 'Asia/Kolkata')::int,
         extract(hour from called_at at time zone 'Asia/Kolkata')::int,
         count(*)::int, count(*) filter (where public.call_answered(outcome))::int
  from public.call_log
  where called_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 60), 1), 365))
    and extract(hour from called_at at time zone 'Asia/Kolkata') between 9 and 21
  group by 1, 2
$$;
-- How many days the heatmap really covers for the caller (staff other than Admin only see old_data_days of calls).
create or replace function public.pickup_heatmap_days(p_days int default 60) returns int
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then least(greatest(coalesce(p_days, 60), 1), 365)
              else least(least(greatest(coalesce(p_days, 60), 1), 365), public.setting_int('old_data_days', 30)) end
$$;
revoke execute on function public.pickup_heatmap(int), public.pickup_heatmap_days(int) from public, anon;
grant execute on function public.pickup_heatmap(int), public.pickup_heatmap_days(int) to authenticated, service_role;

notify pgrst, 'reload schema';
