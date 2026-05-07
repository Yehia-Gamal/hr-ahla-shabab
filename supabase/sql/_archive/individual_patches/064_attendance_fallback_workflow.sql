-- Patch 060: Formal fallback attendance workflow and post-deploy verification
-- Purpose: convert camera/GPS/QR failures into reviewable fallback requests instead of silent failure.
begin;

create table if not exists public.attendance_fallback_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('checkIn','checkOut','CHECK_IN','CHECK_OUT')),
  reason text not null default '',
  device_fingerprint_hash text default '',
  browser_install_id text default '',
  latitude double precision,
  longitude double precision,
  accuracy_meters numeric,
  selfie_url text default '',
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','ESCALATED')),
  review_notes text default '',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.attendance_fallback_requests enable row level security;

drop policy if exists attendance_fallback_employee_insert on public.attendance_fallback_requests;
create policy attendance_fallback_employee_insert on public.attendance_fallback_requests
  for insert with check (auth.uid() = user_id);

drop policy if exists attendance_fallback_employee_read on public.attendance_fallback_requests;
create policy attendance_fallback_employee_read on public.attendance_fallback_requests
  for select using (
    auth.uid() = user_id
    or public.has_app_permission('attendance:review')
    or public.has_app_permission('attendance:manage')
    or public.has_app_permission('users:manage')
  );

drop policy if exists attendance_fallback_admin_update on public.attendance_fallback_requests;
create policy attendance_fallback_admin_update on public.attendance_fallback_requests
  for update using (
    public.has_app_permission('attendance:review')
    or public.has_app_permission('attendance:manage')
    or public.has_app_permission('users:manage')
  ) with check (
    public.has_app_permission('attendance:review')
    or public.has_app_permission('attendance:manage')
    or public.has_app_permission('users:manage')
  );

create or replace view public.attendance_fallback_review_queue as
select
  r.*,
  e.full_name as employee_name,
  e.job_title,
  e.phone
from public.attendance_fallback_requests r
left join public.employees e on e.id = r.employee_id
where r.status in ('PENDING','ESCALATED')
order by r.created_at desc;

create or replace function public.review_attendance_fallback_request(
  p_request_id uuid,
  p_decision text,
  p_notes text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.attendance_fallback_requests%rowtype;
begin
  if not (public.has_app_permission('attendance:review') or public.has_app_permission('attendance:manage') or public.has_app_permission('users:manage')) then
    raise exception 'not authorized';
  end if;

  select * into v_request from public.attendance_fallback_requests where id = p_request_id for update;
  if not found then
    raise exception 'fallback request not found';
  end if;

  update public.attendance_fallback_requests
  set status = case when upper(coalesce(p_decision,'')) = 'APPROVED' then 'APPROVED' else 'REJECTED' end,
      review_notes = coalesce(p_notes, ''),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_request_id;

  return p_request_id;
end;
$$;

create or replace function public.attendance_identity_post_deploy_check()
returns table(check_name text, ok boolean, detail text)
language sql
security definer
stable
set search_path = public
as $$
  select 'attendance_identity_checks', to_regclass('public.attendance_identity_checks') is not null, 'Patch 051 table' union all
  select 'attendance_identity_review_queue', to_regclass('public.attendance_identity_review_queue') is not null, 'Patch 052 view' union all
  select 'trusted_device_approval_requests', to_regclass('public.trusted_device_approval_requests') is not null, 'Patch 053 table' union all
  select 'branch_qr_challenges', to_regclass('public.branch_qr_challenges') is not null, 'Patch 054 table' union all
  select 'attendance_risk_escalations', to_regclass('public.attendance_risk_escalations') is not null, 'Patch 055 table' union all
  select 'attendance_risk_center', to_regclass('public.attendance_risk_center') is not null, 'Patch 056 view' union all
  select 'attendance_device_policy', to_regclass('public.attendance_device_policy') is not null, 'Patch 057 table' union all
  select 'branch_qr_station_settings', to_regclass('public.branch_qr_station_settings') is not null, 'Patch 058 table' union all
  select 'attendance_device_abuse_summary', to_regclass('public.attendance_device_abuse_summary') is not null, 'Patch 059 view' union all
  select 'attendance_fallback_requests', to_regclass('public.attendance_fallback_requests') is not null, 'Patch 060 table';
$$;

comment on function public.attendance_identity_post_deploy_check() is
  'Post-deploy checklist for Identity Guard patches 051–060.';

commit;
