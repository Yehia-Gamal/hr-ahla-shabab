-- =========================================================
-- EXPANDED SQL EDITOR BUNDLE: PATCHES 044 TO 074
-- Generated for Supabase SQL Editor.
-- Run AFTER base schema and patches 001-043 have already been applied.
-- Requirements before running:
--   1) Set app.vault_key before patch 044.
--   2) Enable pg_cron before patch 045 if backup scheduling is required.
-- =========================================================



-- =========================================================
-- BEGIN PATCH: 044_encrypt_credential_vault.sql
-- =========================================================
-- Patch 044: Encrypt credential_vault.temporary_password
-- Requires: app.vault_key to be set in Supabase Project Settings / Secrets before running.
begin;

create extension if not exists pgcrypto;

alter table if exists public.credential_vault
  add column if not exists encrypted_password bytea;

do $$
declare
  vault_key text;
begin
  vault_key := current_setting('app.vault_key', true);
  if vault_key is null or vault_key = '' then
    raise warning 'app.vault_key is not set; encrypted_password migration skipped. Set the secret and re-run this patch.';
  else
    update public.credential_vault
    set encrypted_password = pgp_sym_encrypt(coalesce(temporary_password, ''), vault_key)
    where temporary_password is not null
      and temporary_password <> ''
      and encrypted_password is null;
  end if;
end $$;

comment on column public.credential_vault.temporary_password is
  'DEPRECATED PLAINTEXT — use encrypted_password. Drop this column only after verifying migration.';

create or replace function public.get_my_vault_entry()
returns table (id text, created_at timestamptz, decrypted_password text)
language sql
security definer
stable
set search_path = public
as $$
  select
    cv.id::text,
    cv.created_at,
    pgp_sym_decrypt(cv.encrypted_password, current_setting('app.vault_key', true)) as decrypted_password
  from public.credential_vault cv
  where cv.encrypted_password is not null
    and (public.current_can_view_password_vault())
  order by cv.created_at desc
  limit 1;
$$;

commit;

-- =========================================================
-- END PATCH: 044_encrypt_credential_vault.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 045_enable_pg_cron_backup.sql
-- =========================================================
-- Patch 045: Enable pg_cron backup schedule placeholder
-- Requires enabling pg_cron in Supabase Dashboard before running scheduled jobs.
begin;

create extension if not exists pg_cron;

create table if not exists public.backup_run_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'scheduled',
  status text not null default 'PENDING',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.run_auto_backup()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.backup_run_log(kind, status, details)
  values ('scheduled', 'RECORDED', jsonb_build_object('note', 'External backup runner should export data from Supabase storage/database.'));
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ahla-shabab-hr-auto-backup', '0 2 * * *', $$select public.run_auto_backup();$$);
  end if;
exception when duplicate_object then
  null;
end $$;

commit;

-- =========================================================
-- END PATCH: 045_enable_pg_cron_backup.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 046_performance_indexes.sql
-- =========================================================
-- Patch 046: Performance indexes for frequently queried columns
begin;

-- Attendance indexes
create index if not exists idx_attendance_employee_date
  on public.attendance(employee_id, punch_date desc);

create index if not exists idx_attendance_status_date
  on public.attendance(status, punch_date desc);

-- Notifications unread
create index if not exists idx_notifications_user_unread
  on public.notifications(user_id, is_read, created_at desc)
  where is_read = false;

-- KPI evaluations cycle
create index if not exists idx_kpi_evaluations_cycle
  on public.kpi_evaluations(cycle_id, employee_id, status);

-- Audit log ordering by created date
create index if not exists idx_audit_log_created
  on public.audit_log(created_at desc);

-- Pending leave requests
create index if not exists idx_leave_requests_pending
  on public.leave_requests(status, created_at desc)
  where status = 'PENDING';

-- Live location responses by employee and time
create index if not exists idx_live_location_employee_time
  on public.live_location_responses(employee_id, created_at desc);

commit;
-- =========================================================
-- END PATCH: 046_performance_indexes.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 047_mfa_trusted_devices.sql
-- =========================================================
-- Patch 047: MFA trusted devices table
begin;

create table if not exists public.trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_fingerprint text not null,
  device_name text default '',
  trusted_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_trusted_devices_user_fp
  on public.trusted_devices(user_id, device_fingerprint);

alter table public.trusted_devices enable row level security;

create policy "user_own_devices" on public.trusted_devices
  for all using (auth.uid() = user_id);

-- Remove expired trusted devices
create or replace function public.cleanup_expired_trusted_devices()
returns void language sql security definer as $$
  delete from public.trusted_devices where expires_at < now();
$$;

comment on table public.trusted_devices is
  'أجهزة موثوقة لتجاوز MFA لمدة 30 يوم للأدوار الحساسة';

commit;
-- =========================================================
-- END PATCH: 047_mfa_trusted_devices.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 048_enhanced_audit_log.sql
-- =========================================================
-- Patch 048: Enhanced audit log for sensitive operations
begin;

alter table if exists public.audit_log
  add column if not exists ip_address text,
  add column if not exists user_agent text,
  add column if not exists session_id text,
  add column if not exists severity text default 'INFO'
    check (severity in ('INFO', 'WARNING', 'CRITICAL'));

-- Promote sensitive actions to CRITICAL severity
update public.audit_log
set severity = 'CRITICAL'
where action in (
  'USER_CREATED', 'USER_DELETED', 'ROLE_CHANGED',
  'PASSWORD_RESET', 'ADMIN_LOGIN', 'BULK_EXPORT'
);

create index if not exists idx_audit_log_severity
  on public.audit_log(severity, created_at desc)
  where severity in ('WARNING', 'CRITICAL');

commit;
-- =========================================================
-- END PATCH: 048_enhanced_audit_log.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 049_cleanup_old_reports.sql
-- =========================================================
-- Patch 049: Auto-cleanup old temporary reports (keep 6 months)
begin;

create or replace function public.cleanup_old_reports()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.report_snapshots
  where created_at < now() - interval '6 months';

  delete from public.kpi_cycle_archives
  where archived_at < now() - interval '12 months';
$$;

-- Schedule weekly cleanup via pg_cron if available
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'hr-weekly-cleanup',
      '0 2 * * 0',
      $cron$ SELECT public.cleanup_old_reports(); $cron$
    );
  end if;
end;
$$;

commit;
-- =========================================================
-- END PATCH: 049_cleanup_old_reports.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 051_attendance_identity_verification.sql
-- =========================================================
-- Patch 051: Attendance identity verification and anti-shared-device controls
-- Purpose:
--   Bind every employee punch to a trusted passkey/device, live selfie, location, and risk score.
--   High-risk events are marked for HR review instead of silently accepted.

begin;

create extension if not exists pgcrypto;

-- Extend attendance_events without breaking older clients.
alter table if exists public.attendance_events
  add column if not exists trusted_device_id uuid,
  add column if not exists device_fingerprint_hash text,
  add column if not exists identity_check jsonb default '{}'::jsonb,
  add column if not exists risk_score integer default 0 check (risk_score between 0 and 100),
  add column if not exists risk_level text default 'LOW' check (risk_level in ('LOW','MEDIUM','HIGH')),
  add column if not exists risk_flags text[] default '{}';

-- Extend passkey_credentials if the table already exists.
alter table if exists public.passkey_credentials
  add column if not exists employee_id uuid references public.employees(id) on delete cascade,
  add column if not exists device_fingerprint_hash text,
  add column if not exists trusted boolean default true,
  add column if not exists status text default 'DEVICE_TRUSTED',
  add column if not exists last_verified_at timestamptz;

-- Per-punch verification record for review/audit.
create table if not exists public.attendance_identity_checks (
  id uuid primary key default gen_random_uuid(),
  attendance_event_id uuid references public.attendance_events(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  trusted_device_id uuid null,
  device_fingerprint_hash text,
  passkey_credential_id text,
  selfie_url text default '',
  identity_check jsonb default '{}'::jsonb,
  risk_score integer not null default 0 check (risk_score between 0 and 100),
  risk_level text not null default 'LOW' check (risk_level in ('LOW','MEDIUM','HIGH')),
  risk_flags text[] not null default '{}',
  requires_review boolean not null default false,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_decision text check (review_decision in ('APPROVED','REJECTED','ESCALATED')),
  review_notes text default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_attendance_identity_checks_event
  on public.attendance_identity_checks(attendance_event_id);

create index if not exists idx_attendance_identity_checks_employee_created
  on public.attendance_identity_checks(employee_id, created_at desc);

create index if not exists idx_attendance_identity_checks_review
  on public.attendance_identity_checks(requires_review, created_at desc)
  where requires_review = true;

create index if not exists idx_attendance_identity_checks_device_time
  on public.attendance_identity_checks(device_fingerprint_hash, created_at desc);

-- Detailed risk events for analytics and alerts.
create table if not exists public.attendance_risk_events (
  id uuid primary key default gen_random_uuid(),
  attendance_event_id uuid references public.attendance_events(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete cascade,
  risk_flag text not null,
  risk_score integer not null default 0 check (risk_score between 0 and 100),
  details jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_attendance_risk_events_flag_time
  on public.attendance_risk_events(risk_flag, created_at desc);

create index if not exists idx_attendance_risk_events_employee_time
  on public.attendance_risk_events(employee_id, created_at desc);

-- Selfie catalog; actual objects stay in Storage bucket punch-selfies.
create table if not exists public.punch_selfies (
  id uuid primary key default gen_random_uuid(),
  attendance_event_id uuid references public.attendance_events(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  selfie_url text not null,
  storage_bucket text default 'punch-selfies',
  storage_path text default '',
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_punch_selfies_event
  on public.punch_selfies(attendance_event_id);

alter table public.attendance_identity_checks enable row level security;
alter table public.attendance_risk_events enable row level security;
alter table public.punch_selfies enable row level security;

-- Read access for users who can review attendance or manage HR/admin.
drop policy if exists "attendance_identity_reviewers_read" on public.attendance_identity_checks;
create policy "attendance_identity_reviewers_read" on public.attendance_identity_checks
  for select using (
    auth.uid() = user_id
    or public.has_app_permission('attendance:review')
    or public.has_app_permission('attendance:manage')
    or public.has_app_permission('hr:operations')
    or public.has_app_permission('executive:mobile')
  );

drop policy if exists "attendance_risk_reviewers_read" on public.attendance_risk_events;
create policy "attendance_risk_reviewers_read" on public.attendance_risk_events
  for select using (
    public.has_app_permission('attendance:review')
    or public.has_app_permission('attendance:manage')
    or public.has_app_permission('hr:operations')
    or public.has_app_permission('executive:mobile')
  );

drop policy if exists "punch_selfies_reviewers_read" on public.punch_selfies;
create policy "punch_selfies_reviewers_read" on public.punch_selfies
  for select using (
    auth.uid() = user_id
    or public.has_app_permission('attendance:review')
    or public.has_app_permission('attendance:manage')
    or public.has_app_permission('hr:operations')
  );

-- Authenticated users may insert their own verification metadata through the app.
drop policy if exists "attendance_identity_insert_own" on public.attendance_identity_checks;
create policy "attendance_identity_insert_own" on public.attendance_identity_checks
  for insert with check (auth.uid() = user_id);

drop policy if exists "attendance_risk_insert_authenticated" on public.attendance_risk_events;
create policy "attendance_risk_insert_authenticated" on public.attendance_risk_events
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "punch_selfies_insert_own" on public.punch_selfies;
create policy "punch_selfies_insert_own" on public.punch_selfies
  for insert with check (auth.uid() = user_id);

-- Helper view: shared-device punches within 30 minutes.
create or replace view public.attendance_shared_device_alerts as
select
  a.device_fingerprint_hash,
  count(distinct a.employee_id) as distinct_employees,
  min(a.event_at) as first_event_at,
  max(a.event_at) as last_event_at,
  array_agg(distinct e.full_name) as employee_names
from public.attendance_events a
left join public.employees e on e.id = a.employee_id
where a.device_fingerprint_hash is not null
  and a.event_at >= now() - interval '30 minutes'
group by a.device_fingerprint_hash
having count(distinct a.employee_id) > 1;

comment on table public.attendance_identity_checks is
  'Verification metadata for each punch: trusted device, passkey, selfie, location, risk score and review status.';
comment on table public.attendance_risk_events is
  'Atomic risk flags produced by attendance identity verification.';
comment on view public.attendance_shared_device_alerts is
  'Flags devices used by more than one employee within a 30 minute window.';

commit;

-- =========================================================
-- END PATCH: 051_attendance_identity_verification.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 052_attendance_identity_server_review.sql
-- =========================================================
-- Patch 052: Server-side attendance identity review controls
-- Purpose:
--   Add a secure review queue and review RPC for identity-guarded attendance punches.
--   Complements Patch 051 by making shared-device detection and HR decisions auditable.

begin;

-- A review-oriented view for HR/Admin/Executive dashboards.
create or replace view public.attendance_identity_review_queue as
select
  c.id as check_id,
  c.attendance_event_id,
  c.employee_id,
  e.full_name as employee_name,
  c.user_id,
  c.device_fingerprint_hash,
  c.passkey_credential_id,
  c.selfie_url,
  c.risk_score,
  c.risk_level,
  c.risk_flags,
  c.requires_review,
  c.review_decision,
  c.review_notes,
  c.reviewed_at,
  c.created_at,
  ae.type,
  ae.status,
  ae.event_at,
  ae.geofence_status,
  ae.distance_from_branch_meters,
  ae.accuracy_meters,
  ae.notes
from public.attendance_identity_checks c
left join public.attendance_events ae on ae.id = c.attendance_event_id
left join public.employees e on e.id = c.employee_id
where c.requires_review = true
   or c.risk_level in ('MEDIUM','HIGH')
order by c.created_at desc;

-- Security-definer review RPC; keeps review writes out of the public table API.
create or replace function public.review_attendance_identity_check(
  p_check_id uuid,
  p_decision text,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_check public.attendance_identity_checks%rowtype;
  v_decision text := upper(trim(coalesce(p_decision, '')));
  v_can_review boolean;
begin
  v_can_review := public.has_app_permission('attendance:review')
    or public.has_app_permission('attendance:manage')
    or public.has_app_permission('hr:operations')
    or public.has_app_permission('executive:mobile');

  if not v_can_review then
    raise exception 'NOT_ALLOWED_TO_REVIEW_ATTENDANCE_IDENTITY';
  end if;

  if v_decision not in ('APPROVED','REJECTED','ESCALATED') then
    raise exception 'INVALID_REVIEW_DECISION';
  end if;

  select * into v_check
  from public.attendance_identity_checks
  where id = p_check_id
  for update;

  if not found then
    raise exception 'ATTENDANCE_IDENTITY_CHECK_NOT_FOUND';
  end if;

  update public.attendance_identity_checks
  set reviewed_at = now(),
      reviewed_by = auth.uid(),
      review_decision = v_decision,
      review_notes = coalesce(p_notes, ''),
      requires_review = (v_decision = 'ESCALATED')
  where id = p_check_id;

  update public.attendance_events
  set requires_review = (v_decision = 'ESCALATED'),
      review_decision = v_decision,
      review_note = coalesce(p_notes, ''),
      reviewed_by_user_id = auth.uid(),
      reviewed_at = now(),
      status = case
        when v_decision = 'APPROVED' and status in ('REJECTED','PENDING_REVIEW','MANUAL_CHECK_IN','MANUAL_CHECK_OUT') then 'APPROVED'
        when v_decision = 'REJECTED' then 'REJECTED'
        else status
      end
  where id = v_check.attendance_event_id;

  if to_regclass('public.audit_log') is not null then
    insert into public.audit_log(action, entity_type, entity_id, metadata, created_at)
    values (
      'ATTENDANCE_IDENTITY_REVIEWED',
      'attendance_identity_check',
      p_check_id,
      jsonb_build_object('decision', v_decision, 'notes', coalesce(p_notes, ''), 'attendance_event_id', v_check.attendance_event_id),
      now()
    );
  elsif to_regclass('public.audit_logs') is not null then
    insert into public.audit_logs(action, entity_type, entity_id, actor_user_id, metadata, created_at)
    values (
      'ATTENDANCE_IDENTITY_REVIEWED',
      'attendance_identity_check',
      p_check_id,
      auth.uid(),
      jsonb_build_object('decision', v_decision, 'notes', coalesce(p_notes, ''), 'attendance_event_id', v_check.attendance_event_id),
      now()
    );
  end if;

  return jsonb_build_object('ok', true, 'decision', v_decision, 'check_id', p_check_id);
end;
$$;

comment on view public.attendance_identity_review_queue is
  'HR/Admin queue for reviewing identity-guarded attendance punches with medium/high risk.';
comment on function public.review_attendance_identity_check(uuid, text, text) is
  'Approves, rejects, or escalates an attendance identity check using role-based permissions.';

-- Storage policies for punch-selfies bucket, if Supabase Storage is enabled.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects') then
    execute 'drop policy if exists "punch_selfies_authenticated_upload" on storage.objects';
    execute 'drop policy if exists "punch_selfies_reviewer_read" on storage.objects';

    execute $pol$
      create policy "punch_selfies_authenticated_upload"
      on storage.objects for insert to authenticated
      with check (bucket_id = 'punch-selfies')
    $pol$;

    execute $pol$
      create policy "punch_selfies_reviewer_read"
      on storage.objects for select to authenticated
      using (
        bucket_id = 'punch-selfies'
        and (
          owner = auth.uid()
          or public.has_app_permission('attendance:review')
          or public.has_app_permission('attendance:manage')
          or public.has_app_permission('hr:operations')
          or public.has_app_permission('executive:mobile')
        )
      )
    $pol$;
  end if;
exception when others then
  raise warning 'Storage policies for punch-selfies were not applied: %', sqlerrm;
end;
$$;

commit;

-- =========================================================
-- END PATCH: 052_attendance_identity_server_review.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 053_trusted_device_approval.sql
-- =========================================================
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

create policy if not exists "employee_create_own_device_request"
  on public.trusted_device_approval_requests
  for insert
  with check (auth.uid() = user_id);

create policy if not exists "employee_read_own_device_request"
  on public.trusted_device_approval_requests
  for select
  using (auth.uid() = user_id or public.has_app_permission('attendance:review') or public.has_app_permission('users:manage'));

create policy if not exists "reviewers_manage_device_requests"
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

-- =========================================================
-- END PATCH: 053_trusted_device_approval.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 054_attendance_branch_qr_challenge.sql
-- =========================================================
-- Patch 054: Rotating branch QR challenge for attendance confirmation
begin;

create extension if not exists pgcrypto;

create table if not exists public.branch_qr_challenges (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid,
  challenge_code text not null unique,
  challenge_hash text not null,
  valid_from timestamptz not null default now(),
  valid_until timestamptz not null default (now() + interval '90 seconds'),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.branch_qr_challenges enable row level security;

create policy if not exists "reviewers_manage_branch_qr"
  on public.branch_qr_challenges
  for all
  using (public.has_app_permission('attendance:review') or public.has_app_permission('users:manage'))
  with check (public.has_app_permission('attendance:review') or public.has_app_permission('users:manage'));

create index if not exists idx_branch_qr_valid
  on public.branch_qr_challenges(branch_id, valid_until desc);

create or replace function public.create_branch_qr_challenge(p_branch_id uuid default null)
returns table (id uuid, challenge_code text, valid_until timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not (public.has_app_permission('attendance:review') or public.has_app_permission('users:manage')) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  v_code := upper(substr(encode(gen_random_bytes(9), 'hex'), 1, 12));
  insert into public.branch_qr_challenges(branch_id, challenge_code, challenge_hash, created_by)
  values (p_branch_id, v_code, encode(digest(v_code, 'sha256'), 'hex'), auth.uid())
  returning public.branch_qr_challenges.id, public.branch_qr_challenges.challenge_code, public.branch_qr_challenges.valid_until
  into id, challenge_code, valid_until;
  return next;
end;
$$;

create or replace function public.validate_branch_qr_challenge(
  p_branch_id uuid default null,
  p_challenge_code text default ''
)
returns table (valid boolean, reason text, challenge_id uuid)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  return query
  select true, 'VALID'::text, c.id
  from public.branch_qr_challenges c
  where c.challenge_hash = encode(digest(upper(trim(coalesce(p_challenge_code,''))), 'sha256'), 'hex')
    and (p_branch_id is null or c.branch_id is null or c.branch_id = p_branch_id)
    and now() between c.valid_from and c.valid_until
  order by c.valid_until desc
  limit 1;
  if not found then
    return query select false, 'INVALID_OR_EXPIRED'::text, null::uuid;
  end if;
end;
$$;

comment on table public.branch_qr_challenges is
  'أكواد QR متغيرة داخل الفرع؛ الموظف يثبت حضوره فعليًا داخل المكان بمسح كود صالح قصير المدة.';

commit;

-- =========================================================
-- END PATCH: 054_attendance_branch_qr_challenge.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 055_attendance_anti_spoofing_risk.sql
-- =========================================================
-- Patch 055: Anti-spoofing, browser install id, liveness, and risk escalation signals
begin;

alter table if exists public.attendance_identity_checks
  add column if not exists browser_install_id text,
  add column if not exists branch_qr_challenge_id uuid,
  add column if not exists branch_qr_status text default 'NOT_REQUIRED',
  add column if not exists liveness_status text default 'NOT_CHECKED',
  add column if not exists location_trust jsonb default '{}'::jsonb,
  add column if not exists anti_spoofing_flags text[] default '{}'::text[];

alter table if exists public.attendance_events
  add column if not exists browser_install_id text,
  add column if not exists branch_qr_status text,
  add column if not exists branch_qr_challenge_id uuid,
  add column if not exists anti_spoofing_flags text[] default '{}'::text[];

create table if not exists public.attendance_risk_escalations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete cascade,
  attendance_event_id uuid references public.attendance_events(id) on delete cascade,
  escalation_level text not null check (escalation_level in ('HR_REVIEW','MANAGER_NOTICE','EXECUTIVE_NOTICE')),
  reason text not null,
  risk_score numeric default 0,
  risk_flags text[] default '{}'::text[],
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id)
);

alter table public.attendance_risk_escalations enable row level security;

create policy if not exists "reviewers_read_risk_escalations"
  on public.attendance_risk_escalations
  for select
  using (public.has_app_permission('attendance:review') or public.has_app_permission('users:manage'));

create index if not exists idx_attendance_identity_browser_install
  on public.attendance_identity_checks(browser_install_id, created_at desc);

create index if not exists idx_risk_escalations_employee_date
  on public.attendance_risk_escalations(employee_id, created_at desc);

create or replace function public.create_attendance_risk_escalation(
  p_employee_id uuid,
  p_attendance_event_id uuid,
  p_risk_score numeric,
  p_risk_flags text[] default '{}'::text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_level text := 'HR_REVIEW';
  v_id uuid;
  v_recent_count int;
begin
  select count(*) into v_recent_count
  from public.attendance_risk_escalations
  where employee_id = p_employee_id
    and created_at >= now() - interval '30 days';
  if v_recent_count >= 2 then
    v_level := 'EXECUTIVE_NOTICE';
  elsif v_recent_count >= 1 then
    v_level := 'MANAGER_NOTICE';
  end if;
  insert into public.attendance_risk_escalations(employee_id, attendance_event_id, escalation_level, reason, risk_score, risk_flags)
  values (p_employee_id, p_attendance_event_id, v_level, 'Repeated or high-risk attendance identity signal', p_risk_score, p_risk_flags)
  returning id into v_id;
  return v_id;
end;
$$;

commit;

-- =========================================================
-- END PATCH: 055_attendance_anti_spoofing_risk.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 056_attendance_risk_center.sql
-- =========================================================
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

create policy if not exists "employee_ack_own_policy"
  on public.attendance_policy_acknowledgements
  for insert
  with check (auth.uid() = user_id);

create policy if not exists "employee_read_own_policy"
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
  coalesce(e.risk_flags, c.risk_flags, '{}'::text[]) as risk_flags,
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
left join lateral unnest(coalesce(e.risk_flags, '{}'::text[])) flag on true
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

-- =========================================================
-- END PATCH: 056_attendance_risk_center.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 057_employee_requests_two_stage_workflow.sql
-- =========================================================
-- Patch 057: Two-stage approval workflow for leaves and missions
begin;

-- workflow statuses include: pending_manager_review, pending_hr_review, manager_rejected, hr_approved, hr_rejected

alter table if exists public.leave_requests
  add column if not exists workflow_status text default 'pending_manager_review',
  add column if not exists direct_manager_id uuid,
  add column if not exists manager_reviewed_at timestamptz,
  add column if not exists manager_decision text,
  add column if not exists manager_note text,
  add column if not exists hr_reviewed_at timestamptz,
  add column if not exists hr_decision text,
  add column if not exists hr_note text,
  add column if not exists final_status text;

alter table if exists public.missions
  add column if not exists workflow_status text default 'pending_manager_review',
  add column if not exists direct_manager_id uuid,
  add column if not exists manager_reviewed_at timestamptz,
  add column if not exists manager_decision text,
  add column if not exists manager_note text,
  add column if not exists hr_reviewed_at timestamptz,
  add column if not exists hr_decision text,
  add column if not exists hr_note text,
  add column if not exists final_status text;

create index if not exists idx_leave_requests_workflow_status on public.leave_requests(workflow_status, created_at desc);
create index if not exists idx_missions_workflow_status on public.missions(workflow_status, created_at desc);

commit;

-- =========================================================
-- END PATCH: 057_employee_requests_two_stage_workflow.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 058_kpi_advanced_workflow_percentages.sql
-- =========================================================
-- Patch 058: Advanced KPI workflow with percentage sliders and staged approvals
begin;

create table if not exists public.kpi_cycles (
  id uuid primary key default gen_random_uuid(),
  cycle_name text not null,
  month_key text not null unique,
  status text not null default 'closed',
  employee_opened_at timestamptz,
  employee_closes_at timestamptz,
  hr_opened_at timestamptz,
  manager_opened_at timestamptz,
  manager_deadline_at timestamptz,
  secretary_reviewed_at timestamptz,
  executive_approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.kpi_evaluations
  add column if not exists cycle_id uuid references public.kpi_cycles(id),
  add column if not exists cycle_name text,
  add column if not exists target_percent numeric default 0,
  add column if not exists efficiency_percent numeric default 0,
  add column if not exists conduct_percent numeric default 0,
  add column if not exists initiatives_percent numeric default 0,
  add column if not exists attendance_percent numeric default 0,
  add column if not exists quran_percent numeric default 0,
  add column if not exists prayer_percent numeric default 0,
  add column if not exists weighted_total numeric default 0,
  add column if not exists hr_notes text,
  add column if not exists manager_notes text,
  add column if not exists secretary_notes text,
  add column if not exists manager_deadline_at timestamptz,
  add column if not exists pdf_exported_at timestamptz;

create or replace function public.calculate_kpi_weighted_total(
  p_target numeric,
  p_efficiency numeric,
  p_conduct numeric,
  p_initiatives numeric,
  p_attendance numeric,
  p_quran numeric,
  p_prayer numeric
) returns numeric language sql immutable as $$
  select round((coalesce(p_target,0) * 40 + coalesce(p_efficiency,0) * 20 + coalesce(p_conduct,0) * 5 + coalesce(p_initiatives,0) * 5 + coalesce(p_attendance,0) * 20 + coalesce(p_quran,0) * 5 + coalesce(p_prayer,0) * 5) / 100, 2);
$$;

create index if not exists idx_kpi_evaluations_status_cycle on public.kpi_evaluations(status, cycle_id, employee_id);

commit;

-- =========================================================
-- END PATCH: 058_kpi_advanced_workflow_percentages.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 059_dispute_committee_privacy_workflow.sql
-- =========================================================
-- Patch 059: Dispute committee privacy workflow
begin;

alter table if exists public.dispute_cases
  add column if not exists related_employee_id uuid,
  add column if not exists has_related_employee boolean default false,
  add column if not exists repeated_before boolean default false,
  add column if not exists repeated_with_same_person boolean default false,
  add column if not exists privacy_level text default 'committee_only',
  add column if not exists public_update text default 'قيد مراجعة اللجنة',
  add column if not exists escalated_to_secretary_at timestamptz,
  add column if not exists secretary_extended_until timestamptz,
  add column if not exists escalated_to_executive_at timestamptz,
  add column if not exists due_at timestamptz default (now() + interval '48 hours');

create table if not exists public.dispute_committee_minutes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.dispute_cases(id) on delete cascade,
  meeting_at timestamptz default now(),
  attendees text[] default '{}',
  summary text default '',
  decision text default '',
  notes text default '',
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_dispute_cases_committee_due on public.dispute_cases(status, due_at);
create index if not exists idx_dispute_cases_related_employee on public.dispute_cases(related_employee_id);

commit;

-- =========================================================
-- END PATCH: 059_dispute_committee_privacy_workflow.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 060_location_readable_labels_and_policy_ack.sql
-- =========================================================
-- Patch 060: Readable location labels and policy acknowledgements metadata
begin;

alter table if exists public.attendance_events
  add column if not exists address_label text,
  add column if not exists location_status text,
  add column if not exists distance_from_branch numeric,
  add column if not exists employee_note text;

alter table if exists public.employee_locations
  add column if not exists address_label text,
  add column if not exists location_status text,
  add column if not exists distance_from_branch numeric;

alter table if exists public.policy_acknowledgements
  add column if not exists device_id text,
  add column if not exists browser_install_id text,
  add column if not exists ip_hash text;

create index if not exists idx_attendance_events_location_status on public.attendance_events(location_status, event_at desc);
commit;

-- =========================================================
-- END PATCH: 060_location_readable_labels_and_policy_ack.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 061_trusted_device_policy_enforcement.sql
-- =========================================================
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

-- =========================================================
-- END PATCH: 061_trusted_device_policy_enforcement.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 062_branch_qr_station_rotation.sql
-- =========================================================
-- Patch 058: Branch QR station rotation settings and admin station view
-- Purpose: make the branch QR challenge operational for an on-site screen/tablet.
begin;

create table if not exists public.branch_qr_station_settings (
  branch_id uuid primary key references public.branches(id) on delete cascade,
  rotate_seconds integer not null default 60 check (rotate_seconds between 30 and 300),
  require_qr_for_punch boolean not null default true,
  station_label text not null default 'شاشة QR الفرع',
  is_active boolean not null default true,
  last_challenge_id uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.branch_qr_station_settings enable row level security;

drop policy if exists branch_qr_station_settings_read on public.branch_qr_station_settings;
create policy branch_qr_station_settings_read on public.branch_qr_station_settings
  for select using (auth.uid() is not null);

drop policy if exists branch_qr_station_settings_admin_write on public.branch_qr_station_settings;
create policy branch_qr_station_settings_admin_write on public.branch_qr_station_settings
  for all using (
    public.has_app_permission('attendance:manage')
    or public.has_app_permission('settings:manage')
    or public.has_app_permission('users:manage')
  ) with check (
    public.has_app_permission('attendance:manage')
    or public.has_app_permission('settings:manage')
    or public.has_app_permission('users:manage')
  );

create or replace view public.branch_qr_station_board as
select
  b.id as branch_id,
  b.name as branch_name,
  coalesce(s.rotate_seconds, 60) as rotate_seconds,
  coalesce(s.require_qr_for_punch, true) as require_qr_for_punch,
  coalesce(s.station_label, 'شاشة QR الفرع') as station_label,
  coalesce(s.is_active, true) as is_active,
  c.id as challenge_id,
  c.challenge_code,
  c.valid_until,
  c.created_at as challenge_created_at
from public.branches b
left join public.branch_qr_station_settings s on s.branch_id = b.id
left join lateral (
  select * from public.branch_qr_challenges c
  where c.branch_id = b.id
    and c.valid_until > now()
  order by c.created_at desc
  limit 1
) c on true;

create or replace function public.ensure_branch_qr_station_challenge(p_branch_id uuid)
returns table (
  branch_id uuid,
  challenge_id uuid,
  challenge_code text,
  valid_until timestamptz,
  rotate_seconds integer,
  require_qr_for_punch boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_setting public.branch_qr_station_settings%rowtype;
  v_row record;
begin
  if not (public.has_app_permission('attendance:manage') or public.has_app_permission('settings:manage') or public.has_app_permission('executive:report')) then
    raise exception 'not authorized';
  end if;

  select * into v_setting from public.branch_qr_station_settings where branch_id = p_branch_id;
  if not found then
    insert into public.branch_qr_station_settings(branch_id, updated_by)
    values (p_branch_id, auth.uid())
    on conflict (branch_id) do nothing;
    select * into v_setting from public.branch_qr_station_settings where branch_id = p_branch_id;
  end if;

  select * into v_row
  from public.branch_qr_challenges
  where branch_id = p_branch_id and valid_until > now() + interval '10 seconds'
  order by created_at desc
  limit 1;

  if not found then
    select * into v_row
    from public.create_branch_qr_challenge(p_branch_id)
    limit 1;
    update public.branch_qr_station_settings
      set last_challenge_id = v_row.challenge_id,
          updated_at = now(),
          updated_by = auth.uid()
    where branch_id = p_branch_id;
  end if;

  return query select
    p_branch_id,
    v_row.challenge_id,
    v_row.challenge_code,
    v_row.valid_until,
    coalesce(v_setting.rotate_seconds, 60),
    coalesce(v_setting.require_qr_for_punch, true);
end;
$$;

comment on view public.branch_qr_station_board is
  'Operational screen data for rotating branch QR punch challenges.';

commit;

-- =========================================================
-- END PATCH: 062_branch_qr_station_rotation.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 063_attendance_fraud_ops_snapshot.sql
-- =========================================================
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
left join lateral unnest(coalesce(e.risk_flags, '{}'::text[]) || coalesce(c.risk_flags, '{}'::text[])) flag on true
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

-- =========================================================
-- END PATCH: 063_attendance_fraud_ops_snapshot.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 064_attendance_fallback_workflow.sql
-- =========================================================
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

-- =========================================================
-- END PATCH: 064_attendance_fallback_workflow.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 065_live_operations_center.sql
-- =========================================================
-- Patch 065: Live Operations Center views and summaries
begin;

create or replace view public.live_operations_center as
select
  now() as generated_at,
  (select count(*) from public.employees where coalesce(is_active, true) = true) as active_employees,
  (select count(*) from public.attendance_events where created_at::date = current_date) as today_attendance_events,
  (select count(*) from public.attendance_identity_checks where requires_review = true and coalesce(review_status,'PENDING') = 'PENDING') as pending_identity_reviews,
  (select count(*) from public.leave_requests where status in ('pending_manager_review','pending_hr_review','PENDING')) as pending_leave_requests,
  (select count(*) from public.mission_requests where status in ('pending_manager_review','pending_hr_review','PENDING')) as pending_mission_requests;

comment on view public.live_operations_center is 'Live command center counters for HR/admin/executive dashboards.';
commit;

-- =========================================================
-- END PATCH: 065_live_operations_center.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 066_face_match_optional_metadata.sql
-- =========================================================
-- Patch 066: Optional face-match metadata for punch selfies
begin;

alter table if exists public.attendance_identity_checks
  add column if not exists face_match_score numeric,
  add column if not exists face_match_status text default 'NOT_RUN'
    check (face_match_status in ('NOT_RUN','MATCH','WEAK_MATCH','NO_MATCH','MANUAL_REVIEW','ERROR')),
  add column if not exists liveness_status text default 'NOT_RUN'
    check (liveness_status in ('NOT_RUN','PASS','FAIL','MANUAL_REVIEW','ERROR'));

create index if not exists idx_attendance_identity_face_status
  on public.attendance_identity_checks(face_match_status, created_at desc);

commit;

-- =========================================================
-- END PATCH: 066_face_match_optional_metadata.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 067_smart_alerts_engine.sql
-- =========================================================
-- Patch 067: Smart alerts engine rules and event queue
begin;

create table if not exists public.smart_alert_rules (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  title text not null,
  description text default '',
  target_role text default 'hr',
  is_active boolean not null default true,
  severity text not null default 'INFO' check (severity in ('INFO','WARNING','CRITICAL')),
  schedule_hint text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.smart_alert_events (
  id uuid primary key default gen_random_uuid(),
  rule_code text not null,
  employee_id uuid null,
  title text not null,
  body text not null,
  severity text not null default 'INFO' check (severity in ('INFO','WARNING','CRITICAL')),
  status text not null default 'PENDING' check (status in ('PENDING','SENT','FAILED','DISMISSED')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz null
);

insert into public.smart_alert_rules(code,title,description,target_role,severity,schedule_hint)
values
('MISSING_PUNCH_0930','تذكير بصمة 9:30','تنبيه للموظفين الذين لم يسجلوا حضورهم حتى 9:30','employee','WARNING','daily 09:30'),
('HIGH_RISK_ATTENDANCE','بصمة عالية الخطورة','تصعيد بصمات الحضور ذات درجة خطر عالية','hr','CRITICAL','realtime'),
('PENDING_MANAGER_APPROVAL','موافقات مدير معلقة','تنبيه المدير بطلبات فريقه المعلقة','direct_manager','WARNING','hourly')
on conflict (code) do update set title=excluded.title, description=excluded.description, target_role=excluded.target_role, severity=excluded.severity, schedule_hint=excluded.schedule_hint;

commit;

-- =========================================================
-- END PATCH: 067_smart_alerts_engine.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 068_monthly_reports_exports.sql
-- =========================================================
-- Patch 068: Monthly HR report snapshots and export log
begin;

create table if not exists public.monthly_report_exports (
  id uuid primary key default gen_random_uuid(),
  report_month date not null,
  report_type text not null default 'FULL_HR_MONTHLY',
  generated_by uuid null references auth.users(id),
  status text not null default 'PENDING' check (status in ('PENDING','GENERATED','FAILED')),
  file_url text default '',
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  generated_at timestamptz null
);

create index if not exists idx_monthly_report_exports_month
  on public.monthly_report_exports(report_month desc, report_type);

commit;

-- =========================================================
-- END PATCH: 068_monthly_reports_exports.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 069_visual_permissions_matrix.sql
-- =========================================================
-- Patch 069: Visual permissions matrix support
begin;

create table if not exists public.permission_catalog (
  permission_key text primary key,
  title_ar text not null,
  category text not null default 'general',
  description text default '',
  is_sensitive boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.permission_catalog(permission_key,title_ar,category,is_sensitive)
values
('employees:read','عرض الموظفين','employees',false),
('employees:manage','إدارة الموظفين','employees',true),
('attendance:review','مراجعة الحضور','attendance',true),
('reports:export','تصدير التقارير','reports',true),
('settings:manage','إدارة الإعدادات','settings',true),
('disputes:committee','لجنة الخلافات','disputes',true)
on conflict (permission_key) do update set title_ar=excluded.title_ar, category=excluded.category, is_sensitive=excluded.is_sensitive;

commit;

-- =========================================================
-- END PATCH: 069_visual_permissions_matrix.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 070_backup_restore_status_center.sql
-- =========================================================
-- Patch 070: Backup and restore status center
begin;

create table if not exists public.backup_restore_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('BACKUP','RESTORE','VERIFY')),
  status text not null default 'PENDING' check (status in ('PENDING','RUNNING','SUCCESS','FAILED','CANCELLED')),
  started_by uuid null references auth.users(id),
  file_url text default '',
  size_bytes bigint default 0,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz null
);

create index if not exists idx_backup_restore_jobs_status
  on public.backup_restore_jobs(status, created_at desc);

commit;

-- =========================================================
-- END PATCH: 070_backup_restore_status_center.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 071_internal_tasks_enhanced.sql
-- =========================================================
-- Patch 071: Enhanced internal tasks system
begin;

create table if not exists public.internal_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text default '',
  assigned_to uuid null,
  assigned_by uuid null,
  due_date date null,
  priority text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','URGENT')),
  status text not null default 'PENDING' check (status in ('PENDING','IN_PROGRESS','COMPLETED','CANCELLED')),
  source text default 'manual',
  metadata jsonb not null default '{}'::jsonb,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_internal_tasks_assignee_status
  on public.internal_tasks(assigned_to, status, due_date);

commit;

-- =========================================================
-- END PATCH: 071_internal_tasks_enhanced.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 072_official_messages_read_receipts.sql
-- =========================================================
-- Patch 072: Official internal messages and read receipts
begin;

create table if not exists public.official_messages (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  audience text not null default 'all',
  created_by uuid null references auth.users(id),
  is_formal_decision boolean not null default false,
  requires_ack boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.official_message_receipts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.official_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz null,
  acknowledged_at timestamptz null,
  device_id text default '',
  unique(message_id, user_id)
);

create index if not exists idx_official_message_receipts_user
  on public.official_message_receipts(user_id, read_at desc);

commit;

-- =========================================================
-- END PATCH: 072_official_messages_read_receipts.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 073_offline_attendance_sync_queue.sql
-- =========================================================
-- Patch 073: Offline attendance sync queue
begin;

create table if not exists public.offline_attendance_sync_queue (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid null,
  user_id uuid null references auth.users(id),
  client_attempt_id text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING_REVIEW' check (status in ('PENDING_REVIEW','SYNCED','REJECTED','DUPLICATE')),
  review_note text default '',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz null,
  unique(client_attempt_id)
);

create index if not exists idx_offline_attendance_sync_status
  on public.offline_attendance_sync_queue(status, created_at desc);

commit;

-- =========================================================
-- END PATCH: 073_offline_attendance_sync_queue.sql
-- =========================================================


-- =========================================================
-- BEGIN PATCH: 074_e2e_and_health_tracking.sql
-- =========================================================
-- Patch 074: E2E smoke test and health tracking log
begin;

create table if not exists public.system_health_checks (
  id uuid primary key default gen_random_uuid(),
  check_code text not null,
  status text not null check (status in ('PASS','WARN','FAIL')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_system_health_checks_code_time
  on public.system_health_checks(check_code, created_at desc);

commit;

-- =========================================================
-- END PATCH: 074_e2e_and_health_tracking.sql
-- =========================================================


-- =========================================================
-- 077 V24 Location Request + Push/CORS Runtime Alignment
-- Safe/idempotent: fixes notification 400s and push subscription shape used by Edge Functions.
-- =========================================================

begin;

alter table if exists public.notifications
  add column if not exists route text default '',
  add column if not exists push_sent_at timestamptz,
  add column if not exists push_status text default '',
  add column if not exists push_error text default '';

alter table if exists public.push_subscriptions
  add column if not exists employee_id uuid references public.employees(id) on delete cascade,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists keys jsonb not null default '{}'::jsonb,
  add column if not exists p256dh text default '',
  add column if not exists auth text default '',
  add column if not exists endpoint_hash text default '',
  add column if not exists user_agent text default '',
  add column if not exists platform text default '',
  add column if not exists permission text default 'granted',
  add column if not exists is_active boolean not null default true,
  add column if not exists status text not null default 'ACTIVE',
  add column if not exists last_seen_at timestamptz,
  add column if not exists last_sent_at timestamptz,
  add column if not exists last_error text default '',
  add column if not exists updated_at timestamptz not null default now();

update public.push_subscriptions
set keys = coalesce(nullif(keys, '{}'::jsonb), payload -> 'keys', '{}'::jsonb),
    p256dh = coalesce(nullif(p256dh, ''), payload #>> '{keys,p256dh}', keys ->> 'p256dh', ''),
    auth = coalesce(nullif(auth, ''), payload #>> '{keys,auth}', keys ->> 'auth', ''),
    endpoint_hash = coalesce(nullif(endpoint_hash, ''), md5(endpoint)),
    status = coalesce(nullif(status, ''), case when is_active then 'ACTIVE' else 'EXPIRED' end),
    last_seen_at = coalesce(last_seen_at, created_at),
    updated_at = now()
where endpoint is not null;

create unique index if not exists push_subscriptions_endpoint_hash_idx
  on public.push_subscriptions(endpoint_hash)
  where endpoint_hash <> '';
create index if not exists idx_push_subscriptions_employee_active
  on public.push_subscriptions(employee_id, is_active, status);
create index if not exists idx_push_subscriptions_user_active
  on public.push_subscriptions(user_id, is_active, status);
create index if not exists idx_notifications_employee_created
  on public.notifications(employee_id, created_at desc);

alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "notifications_live_location_insert_scope" on public.notifications;
create policy "notifications_live_location_insert_scope"
  on public.notifications
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    or employee_id = public.current_employee_id()
    or public.current_is_full_access()
    or public.has_any_permission(array['notifications:manage','alerts:manage','live-location:request','executive:report'])
  );

drop policy if exists "notifications_live_location_read_scope" on public.notifications;
create policy "notifications_live_location_read_scope"
  on public.notifications
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or employee_id = public.current_employee_id()
    or public.current_is_full_access()
    or public.has_any_permission(array['notifications:manage','alerts:manage','executive:report'])
  );

drop policy if exists "notifications_live_location_update_scope" on public.notifications;
create policy "notifications_live_location_update_scope"
  on public.notifications
  for update
  to authenticated
  using (
    user_id = auth.uid()
    or employee_id = public.current_employee_id()
    or public.current_is_full_access()
    or public.has_any_permission(array['notifications:manage','alerts:manage','executive:report'])
  )
  with check (
    user_id = auth.uid()
    or employee_id = public.current_employee_id()
    or public.current_is_full_access()
    or public.has_any_permission(array['notifications:manage','alerts:manage','executive:report'])
  );

drop policy if exists "push_subscriptions_runtime_scope" on public.push_subscriptions;
create policy "push_subscriptions_runtime_scope"
  on public.push_subscriptions
  for all
  to authenticated
  using (
    user_id = auth.uid()
    or employee_id = public.current_employee_id()
    or public.current_is_full_access()
    or public.has_any_permission(array['notifications:manage','alerts:manage','live-location:request','executive:report'])
  )
  with check (
    user_id = auth.uid()
    or employee_id = public.current_employee_id()
    or public.current_is_full_access()
    or public.has_any_permission(array['notifications:manage','alerts:manage','live-location:request','executive:report'])
  );

insert into public.database_migration_status (name, status, notes)
values ('077_v24_location_push_cors', 'APPLIED', 'Aligned notifications, push subscriptions, and live location request policies for v24')
on conflict (name) do update set status = excluded.status, notes = excluded.notes, applied_at = now();

commit;
