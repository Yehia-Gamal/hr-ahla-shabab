-- Patch 057: Trusted device policy enforcement and state RPC
-- Purpose: enforce HR-approved devices, maximum devices per employee, and a clear device state for the punch flow.
begin;

create table if not exists public.attendance_device_policy (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  max_trusted_devices integer not null default 2 check (max_trusted_devices between 1 and 5),
  require_hr_approval boolean not null default true,
  allow_temporary_review boolean not null default true,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.attendance_device_policy enable row level security;

drop policy if exists attendance_device_policy_employee_read on public.attendance_device_policy;
create policy attendance_device_policy_employee_read on public.attendance_device_policy
  for select using (
    employee_id in (select p.employee_id from public.profiles p where p.id = auth.uid())
    or public.has_app_permission('attendance:review')
    or public.has_app_permission('attendance:manage')
    or public.has_app_permission('users:manage')
  );

drop policy if exists attendance_device_policy_admin_write on public.attendance_device_policy;
create policy attendance_device_policy_admin_write on public.attendance_device_policy
  for all using (
    public.has_app_permission('attendance:manage')
    or public.has_app_permission('users:manage')
  ) with check (
    public.has_app_permission('attendance:manage')
    or public.has_app_permission('users:manage')
  );

create or replace function public.get_attendance_device_policy_state(
  p_employee_id uuid,
  p_device_fingerprint_hash text default ''
)
returns table (
  employee_id uuid,
  device_fingerprint_hash text,
  trusted_count integer,
  max_trusted_devices integer,
  has_approved_device boolean,
  has_pending_request boolean,
  pending_request_id uuid,
  requires_approval boolean,
  status text,
  risk_flags text[]
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_policy public.attendance_device_policy%rowtype;
  v_pending uuid;
  v_trusted_count integer := 0;
  v_approved boolean := false;
  v_flags text[] := '{}'::text[];
begin
  if p_employee_id is null then
    return;
  end if;

  select * into v_policy
  from public.attendance_device_policy p
  where p.employee_id = p_employee_id;

  if not found then
    v_policy.employee_id := p_employee_id;
    v_policy.max_trusted_devices := 2;
    v_policy.require_hr_approval := true;
    v_policy.allow_temporary_review := true;
  end if;

  select count(*)::integer into v_trusted_count
  from public.passkey_credentials pc
  where pc.employee_id = p_employee_id
    and coalesce(pc.trusted, true) = true
    and coalesce(pc.status, 'DEVICE_TRUSTED') in ('DEVICE_TRUSTED','APPROVED','ACTIVE');

  select exists(
    select 1 from public.passkey_credentials pc
    where pc.employee_id = p_employee_id
      and coalesce(pc.device_fingerprint_hash, '') = coalesce(p_device_fingerprint_hash, '')
      and coalesce(pc.trusted, true) = true
      and coalesce(pc.status, 'DEVICE_TRUSTED') in ('DEVICE_TRUSTED','APPROVED','ACTIVE')
  ) into v_approved;

  select r.id into v_pending
  from public.trusted_device_approval_requests r
  where r.employee_id = p_employee_id
    and coalesce(r.device_fingerprint_hash, '') = coalesce(p_device_fingerprint_hash, '')
    and coalesce(r.status, 'PENDING') = 'PENDING'
  order by r.created_at desc
  limit 1;

  if v_policy.require_hr_approval and not v_approved then
    v_flags := array_append(v_flags, 'DEVICE_APPROVAL_REQUIRED');
  end if;

  if v_trusted_count >= v_policy.max_trusted_devices and not v_approved then
    v_flags := array_append(v_flags, 'DEVICE_LIMIT_REACHED');
  end if;

  return query select
    p_employee_id,
    coalesce(p_device_fingerprint_hash, ''),
    coalesce(v_trusted_count, 0),
    coalesce(v_policy.max_trusted_devices, 2),
    coalesce(v_approved, false),
    v_pending is not null,
    v_pending,
    (array_length(v_flags, 1) is not null),
    case
      when v_approved then 'APPROVED'
      when v_pending is not null then 'PENDING_REVIEW'
      else 'REQUIRES_APPROVAL'
    end,
    coalesce(v_flags, '{}'::text[]);
end;
$$;

comment on function public.get_attendance_device_policy_state(uuid, text) is
  'Returns the HR approval and trusted-device policy state for the employee punch flow.';

commit;
