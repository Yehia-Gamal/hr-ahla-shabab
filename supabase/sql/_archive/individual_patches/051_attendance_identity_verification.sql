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
