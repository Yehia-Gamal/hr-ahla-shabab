-- Patch 053: HR approval workflow for trusted attendance devices
-- Requires: patches 051-052
begin;

create extension if not exists pgcrypto;

alter table if exists public.passkey_credentials
  add column if not exists device_fingerprint_hash text,
  add column if not exists approval_status text default 'PENDING'
    check (approval_status in ('PENDING','APPROVED','REJECTED','REVOKED')),
  add column if not exists approved_by uuid references auth.users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists last_risk_seen_at timestamptz;

create table if not exists public.trusted_device_approval_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  credential_id text,
  device_fingerprint_hash text not null,
  device_name text default '',
  user_agent text default '',
  selfie_url text default '',
  latitude double precision,
  longitude double precision,
  accuracy_meters numeric,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','REVOKED')),
  reason text default '',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, device_fingerprint_hash)
);

alter table public.trusted_device_approval_requests enable row level security;

drop policy if exists "employee_create_own_device_request" on public.trusted_device_approval_requests;
create policy "employee_create_own_device_request"
  on public.trusted_device_approval_requests
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "employee_read_own_device_request" on public.trusted_device_approval_requests;
create policy "employee_read_own_device_request"
  on public.trusted_device_approval_requests
  for select
  using (auth.uid() = user_id or public.has_app_permission('attendance:review') or public.has_app_permission('users:manage'));

drop policy if exists "reviewers_manage_device_requests" on public.trusted_device_approval_requests;
create policy "reviewers_manage_device_requests"
  on public.trusted_device_approval_requests
  for update
  using (public.has_app_permission('attendance:review') or public.has_app_permission('users:manage'))
  with check (public.has_app_permission('attendance:review') or public.has_app_permission('users:manage'));

create index if not exists idx_device_requests_employee_status
  on public.trusted_device_approval_requests(employee_id, status, created_at desc);

create index if not exists idx_passkey_device_approval
  on public.passkey_credentials(employee_id, approval_status, device_fingerprint_hash);

create or replace view public.trusted_device_review_queue as
select
  r.*,
  e.full_name as employee_name,
  e.phone as employee_phone
from public.trusted_device_approval_requests r
left join public.employees e on e.id = r.employee_id
where r.status = 'PENDING'
order by r.created_at desc;

create or replace function public.request_trusted_device_approval(
  p_employee_id uuid,
  p_device_fingerprint_hash text,
  p_device_name text default '',
  p_user_agent text default '',
  p_selfie_url text default '',
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy_meters numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.trusted_device_approval_requests (
    employee_id, user_id, device_fingerprint_hash, device_name, user_agent,
    selfie_url, latitude, longitude, accuracy_meters, status
  ) values (
    p_employee_id, auth.uid(), p_device_fingerprint_hash, coalesce(p_device_name,''), coalesce(p_user_agent,''),
    coalesce(p_selfie_url,''), p_latitude, p_longitude, p_accuracy_meters, 'PENDING'
  )
  on conflict (employee_id, device_fingerprint_hash)
  do update set
    user_id = excluded.user_id,
    device_name = excluded.device_name,
    user_agent = excluded.user_agent,
    selfie_url = coalesce(nullif(excluded.selfie_url,''), public.trusted_device_approval_requests.selfie_url),
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    accuracy_meters = excluded.accuracy_meters,
    status = case when public.trusted_device_approval_requests.status = 'REJECTED' then 'PENDING' else public.trusted_device_approval_requests.status end,
    updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.review_trusted_device_approval(
  p_request_id uuid,
  p_decision text,
  p_reason text default ''
)
returns public.trusted_device_approval_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.trusted_device_approval_requests;
  v_decision text := upper(coalesce(p_decision,''));
begin
  if not (public.has_app_permission('attendance:review') or public.has_app_permission('users:manage')) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if v_decision not in ('APPROVED','REJECTED','REVOKED') then
    raise exception 'INVALID_DECISION';
  end if;
  update public.trusted_device_approval_requests
  set status = v_decision,
      reason = coalesce(p_reason,''),
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  where id = p_request_id
  returning * into v_row;
  if v_row.id is null then
    raise exception 'REQUEST_NOT_FOUND';
  end if;
  update public.passkey_credentials
  set approval_status = v_decision,
      approved_by = case when v_decision = 'APPROVED' then auth.uid() else approved_by end,
      approved_at = case when v_decision = 'APPROVED' then now() else approved_at end,
      rejected_at = case when v_decision in ('REJECTED','REVOKED') then now() else rejected_at end,
      device_fingerprint_hash = coalesce(device_fingerprint_hash, v_row.device_fingerprint_hash)
  where employee_id = v_row.employee_id
    and (credential_id = v_row.credential_id or device_fingerprint_hash = v_row.device_fingerprint_hash);
  return v_row;
end;
$$;

comment on table public.trusted_device_approval_requests is
  'طلبات اعتماد أجهزة الحضور قبل السماح بالبصمة التلقائية. أي جهاز جديد يتحول إلى مراجعة HR.';

commit;
