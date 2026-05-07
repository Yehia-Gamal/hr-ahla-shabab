-- Patch 056: Attendance risk center, policy acknowledgement, and reporting views
begin;

create table if not exists public.attendance_policy_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  policy_version text not null default 'attendance-identity-v3',
  device_fingerprint_hash text,
  browser_install_id text,
  ip_hash text,
  user_agent text,
  acknowledged_at timestamptz not null default now(),
  unique(employee_id, policy_version)
);

alter table public.attendance_policy_acknowledgements enable row level security;

drop policy if exists "employee_ack_own_policy" on public.attendance_policy_acknowledgements;
create policy "employee_ack_own_policy"
  on public.attendance_policy_acknowledgements
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "employee_read_own_policy" on public.attendance_policy_acknowledgements;
create policy "employee_read_own_policy"
  on public.attendance_policy_acknowledgements
  for select
  using (auth.uid() = user_id or public.has_app_permission('attendance:review') or public.has_app_permission('users:manage'));

create or replace view public.attendance_risk_center as
select
  e.id as attendance_event_id,
  e.employee_id,
  emp.full_name as employee_name,
  e.event_at,
  e.type,
  e.status,
  e.requires_review,
  coalesce(e.risk_score, c.risk_score, 0) as risk_score,
  coalesce(e.risk_level, c.risk_level, 'LOW') as risk_level,
  coalesce(
    (select array_agg(value) from jsonb_array_elements_text(coalesce(e.risk_flags, '[]'::jsonb)) as value),
    c.risk_flags,
    '{}'::text[]
  ) as risk_flags,
  coalesce(e.anti_spoofing_flags, c.anti_spoofing_flags, '{}'::text[]) as anti_spoofing_flags,
  coalesce(e.selfie_url, c.selfie_url, '') as selfie_url,
  coalesce(e.device_fingerprint_hash, c.device_fingerprint_hash, '') as device_fingerprint_hash,
  coalesce(e.branch_qr_status, c.branch_qr_status, '') as branch_qr_status,
  c.liveness_status,
  c.location_trust,
  c.review_decision,
  c.reviewed_at
from public.attendance_events e
left join public.attendance_identity_checks c on c.attendance_event_id = e.id
left join public.employees emp on emp.id = e.employee_id
where e.requires_review = true
   or coalesce(e.risk_score, c.risk_score, 0) >= 35
   or coalesce(array_length(e.anti_spoofing_flags,1), 0) > 0
   or coalesce(array_length(c.anti_spoofing_flags,1), 0) > 0
order by e.event_at desc;

create or replace view public.attendance_monthly_risk_report as
select
  date_trunc('month', e.event_at)::date as month,
  e.employee_id,
  emp.full_name as employee_name,
  count(*) as total_punches,
  count(*) filter (where e.requires_review = true) as review_count,
  count(*) filter (where coalesce(e.risk_score,0) >= 70) as high_risk_count,
  max(coalesce(e.risk_score,0)) as max_risk_score,
  array_remove(array_agg(distinct flag), null) as risk_flags
from public.attendance_events e
left join public.employees emp on emp.id = e.employee_id
left join lateral jsonb_array_elements_text(coalesce(e.risk_flags, '[]'::jsonb)) flag on true
group by 1,2,3
order by month desc, high_risk_count desc, max_risk_score desc;

create or replace function public.acknowledge_attendance_identity_policy(
  p_employee_id uuid,
  p_policy_version text default 'attendance-identity-v3',
  p_device_fingerprint_hash text default '',
  p_browser_install_id text default '',
  p_user_agent text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.attendance_policy_acknowledgements(
    employee_id, user_id, policy_version, device_fingerprint_hash, browser_install_id, user_agent
  ) values (
    p_employee_id, auth.uid(), coalesce(p_policy_version,'attendance-identity-v3'), p_device_fingerprint_hash, p_browser_install_id, p_user_agent
  )
  on conflict (employee_id, policy_version)
  do update set
    user_id = excluded.user_id,
    device_fingerprint_hash = excluded.device_fingerprint_hash,
    browser_install_id = excluded.browser_install_id,
    user_agent = excluded.user_agent,
    acknowledged_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

comment on view public.attendance_risk_center is
  'مركز مكافحة التلاعب: يعرض كل بصمة تحتاج مراجعة أو تحمل إشارات خطر أو Anti-spoofing.';

commit;
