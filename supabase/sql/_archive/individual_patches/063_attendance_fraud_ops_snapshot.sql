-- Patch 059: Attendance fraud operations snapshot and abuse summaries
-- Purpose: provide executive/HR views for repeated device, browser, GPS, and QR issues.
begin;

create or replace view public.attendance_device_abuse_summary as
select
  coalesce(e.device_fingerprint_hash, c.device_fingerprint_hash, '') as device_fingerprint_hash,
  count(*) as total_punches,
  count(distinct e.employee_id) as distinct_employees,
  max(e.event_at) as last_seen_at,
  array_remove(array_agg(distinct emp.full_name), null) as employee_names,
  max(coalesce(e.risk_score, c.risk_score, 0)) as max_risk_score,
  array_remove(array_agg(distinct flag), null) as risk_flags
from public.attendance_events e
left join public.attendance_identity_checks c on c.attendance_event_id = e.id
left join public.employees emp on emp.id = e.employee_id
left join lateral unnest(
  coalesce(
    (select array_agg(value) from jsonb_array_elements_text(coalesce(e.risk_flags, '[]'::jsonb)) as value),
    '{}'::text[]
  ) || coalesce(c.risk_flags, '{}'::text[])
) flag on true
where coalesce(e.device_fingerprint_hash, c.device_fingerprint_hash, '') <> ''
  and e.event_at >= now() - interval '30 days'
group by 1
having count(distinct e.employee_id) > 1 or max(coalesce(e.risk_score, c.risk_score, 0)) >= 50
order by distinct_employees desc, max_risk_score desc, last_seen_at desc;

create or replace view public.attendance_browser_abuse_summary as
select
  coalesce(e.browser_install_id, c.browser_install_id, '') as browser_install_id,
  count(*) as total_punches,
  count(distinct e.employee_id) as distinct_employees,
  max(e.event_at) as last_seen_at,
  array_remove(array_agg(distinct emp.full_name), null) as employee_names,
  max(coalesce(e.risk_score, c.risk_score, 0)) as max_risk_score
from public.attendance_events e
left join public.attendance_identity_checks c on c.attendance_event_id = e.id
left join public.employees emp on emp.id = e.employee_id
where coalesce(e.browser_install_id, c.browser_install_id, '') <> ''
  and e.event_at >= now() - interval '30 days'
group by 1
having count(distinct e.employee_id) > 1 or max(coalesce(e.risk_score, c.risk_score, 0)) >= 50
order by distinct_employees desc, max_risk_score desc, last_seen_at desc;

create or replace function public.attendance_fraud_ops_snapshot(p_days integer default 30)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'generated_at', now(),
    'days', greatest(1, least(coalesce(p_days,30), 90)),
    'risk_counts', (
      select jsonb_object_agg(risk_level, total)
      from (
        select coalesce(risk_level, 'LOW') as risk_level, count(*) as total
        from public.attendance_events
        where event_at >= now() - (greatest(1, least(coalesce(p_days,30), 90)) || ' days')::interval
        group by 1
      ) x
    ),
    'device_abuse', coalesce((select jsonb_agg(to_jsonb(d)) from (select * from public.attendance_device_abuse_summary limit 50) d), '[]'::jsonb),
    'browser_abuse', coalesce((select jsonb_agg(to_jsonb(b)) from (select * from public.attendance_browser_abuse_summary limit 50) b), '[]'::jsonb),
    'pending_reviews', (
      select count(*) from public.attendance_events
      where requires_review = true
        and event_at >= now() - (greatest(1, least(coalesce(p_days,30), 90)) || ' days')::interval
    ),
    'high_risk', (
      select count(*) from public.attendance_events
      where coalesce(risk_score,0) >= 70
        and event_at >= now() - (greatest(1, least(coalesce(p_days,30), 90)) || ' days')::interval
    )
  );
$$;

comment on function public.attendance_fraud_ops_snapshot(integer) is
  'Executive/HR snapshot of identity fraud indicators over the selected period.';

commit;
