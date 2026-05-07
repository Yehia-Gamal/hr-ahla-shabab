-- HR Supabase Web Management HR Reports - Production SQL Editor bundle
-- Includes base schema 001 and patches 002 through 043 in order.
-- Generated locally; contains no service role key, VAPID private key, or Supabase access token.
-- Run the whole file once in Supabase Dashboard > SQL Editor, then run PRODUCTION_POST_DEPLOY_VERIFY.sql.


-- =========================================================
-- BEGIN PATCH: 001_schema_rls_seed.sql
-- =========================================================

-- =========================================================
-- HR Attendance Supabase Backend
-- جمعية خواطر أحلى شباب الخيرية
-- Vanilla Web + Supabase Auth + Postgres + Storage + Realtime
-- شغّل هذا الملف مرة واحدة داخل Supabase SQL Editor.
-- =========================================================

create extension if not exists pgcrypto;

-- =========================
-- 1) Core lookup tables
-- =========================
create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  scope text unique not null,
  name text not null,
  description text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  key text,
  name text not null,
  permissions text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.governorates (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  active boolean not null default true,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.complexes (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  governorate_id uuid references public.governorates(id),
  active boolean not null default true,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  address text default '',
  governorate_id uuid references public.governorates(id),
  complex_id uuid references public.complexes(id),
  latitude numeric(18,15),
  longitude numeric(18,15),
  geofence_radius_meters integer not null default 200,
  max_accuracy_meters integer not null default 300,
  timezone text not null default 'Africa/Cairo',
  active boolean not null default true,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  branch_id uuid references public.branches(id),
  active boolean not null default true,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id),
  name text not null,
  start_time text not null default '09:00',
  end_time text not null default '17:00',
  grace_minutes integer not null default 15,
  late_after_minutes integer not null default 15,
  half_day_after_minutes integer not null default 240,
  days_mask text not null default 'SAT,SUN,MON,TUE,WED,THU',
  is_night_shift boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================
-- 2) People and profiles
-- =========================
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text unique,
  full_name text not null,
  phone text,
  email text,
  photo_url text default '',
  job_title text default '',
  role_id uuid references public.roles(id),
  branch_id uuid references public.branches(id),
  department_id uuid references public.departments(id),
  governorate_id uuid references public.governorates(id),
  complex_id uuid references public.complexes(id),
  manager_employee_id uuid references public.employees(id),
  shift_id uuid references public.shifts(id),
  status text not null default 'ACTIVE',
  is_active boolean not null default true,
  is_deleted boolean not null default false,
  hire_date date,
  user_id uuid references auth.users(id) on delete set null,
  last_location_latitude numeric(18,15),
  last_location_longitude numeric(18,15),
  last_location_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Security hardening for existing databases that previously ran older schema versions
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='branches' and column_name='radius_meters') then
    alter table public.branches drop column radius_meters;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employees_user_id_fkey') then
    alter table public.employees add constraint employees_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;
  end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='profiles') and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='avatar_url') then
    alter table public.profiles add column avatar_url text default '';
  end if;
exception when duplicate_object then null;
end $$;

create index if not exists employees_email_idx on public.employees (lower(email));
create index if not exists employees_phone_idx on public.employees (phone);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  employee_id uuid references public.employees(id),
  email text unique not null,
  phone text,
  full_name text not null default '',
  avatar_url text default '',
  role_id uuid references public.roles(id),
  branch_id uuid references public.branches(id),
  department_id uuid references public.departments(id),
  governorate_id uuid references public.governorates(id),
  complex_id uuid references public.complexes(id),
  status text not null default 'ACTIVE',
  temporary_password boolean not null default true,
  must_change_password boolean not null default true,
  passkey_enabled boolean not null default false,
  failed_logins integer not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  last_seen_at timestamptz,
  password_changed_at timestamptz,
  last_ip text,
  last_user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================
-- 3) Attendance, requests, KPI
-- =========================
create table if not exists public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  user_id uuid references auth.users(id),
  type text not null,
  status text default '',
  event_at timestamptz not null default now(),
  latitude numeric(18,15),
  longitude numeric(18,15),
  accuracy_meters numeric(10,2),
  geofence_status text not null default 'unknown',
  distance_from_branch_meters integer,
  branch_id uuid references public.branches(id),
  verification_status text default 'verified',
  biometric_method text default 'passkey',
  passkey_credential_id text,
  passkey_verified_at timestamptz,
  selfie_url text default '',
  notes text default '',
  late_minutes integer not null default 0,
  requires_review boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.attendance_daily (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  date date not null,
  status text not null default 'ABSENT',
  first_check_in_at timestamptz,
  last_check_out_at timestamptz,
  late_minutes integer not null default 0,
  work_minutes integer not null default 0,
  requires_review boolean not null default false,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, date)
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  type text default 'ANNUAL',
  start_date date not null,
  end_date date not null,
  reason text default '',
  status text not null default 'PENDING',
  manager_employee_id uuid references public.employees(id),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.missions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  title text not null default 'مأمورية',
  destination text default '',
  planned_start timestamptz,
  planned_end timestamptz,
  status text not null default 'PENDING',
  notes text default '',
  manager_employee_id uuid references public.employees(id),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_exceptions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  date date not null default current_date,
  type text not null default 'ADJUSTMENT',
  reason text default '',
  status text not null default 'PENDING',
  created_by uuid references auth.users(id),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.location_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  purpose text default '',
  request_reason text default '',
  status text not null default 'PENDING',
  requested_by uuid references auth.users(id),
  decided_by uuid references auth.users(id),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_locations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  latitude numeric(18,15),
  longitude numeric(18,15),
  accuracy_meters numeric(10,2),
  source text default 'manual',
  attendance_event_id uuid references public.attendance_events(id),
  created_at timestamptz not null default now()
);

create table if not exists public.kpi_evaluations (
  id uuid primary key default gen_random_uuid(),
  cycle_id text not null default to_char(now(), 'YYYY-MM'),
  employee_id uuid not null references public.employees(id) on delete cascade,
  manager_employee_id uuid references public.employees(id),
  evaluation_date date not null default current_date,
  meeting_held boolean not null default false,
  status text not null default 'DRAFT',
  target_score numeric(5,2) not null default 0,
  efficiency_score numeric(5,2) not null default 0,
  attendance_score numeric(5,2) not null default 0,
  conduct_score numeric(5,2) not null default 0,
  prayer_score numeric(5,2) not null default 0,
  quran_circle_score numeric(5,2) not null default 0,
  initiatives_score numeric(5,2) not null default 0,
  total_score numeric(5,2) generated always as (target_score + efficiency_score + attendance_score + conduct_score + prayer_score + quran_circle_score + initiatives_score) stored,
  grade text,
  rating text,
  employee_notes text default '',
  manager_notes text default '',
  submitted_at timestamptz,
  approved_at timestamptz,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(cycle_id, employee_id)
);

create table if not exists public.dispute_cases (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text default '',
  employee_id uuid references public.employees(id),
  status text not null default 'OPEN',
  severity text default 'MEDIUM',
  committee_decision text default '',
  escalated_to_executive boolean not null default false,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================
-- 4) System tables
-- =========================
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  employee_id uuid references public.employees(id),
  title text not null,
  body text default '',
  type text default 'INFO',
  status text not null default 'UNREAD',
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  actor text default '',
  actor_user_id uuid references auth.users(id),
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'EMPLOYEE',
  entity_id uuid,
  employee_id uuid references public.employees(id),
  file_name text default '',
  original_name text default '',
  mime_type text default '',
  size_bytes bigint default 0,
  bucket_id text default '',
  storage_path text default '',
  url text not null default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.passkey_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text default 'Passkey',
  credential_id text not null,
  public_key text,
  counter bigint not null default 0,
  transports text[],
  platform text default '',
  browser_supported boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, credential_id)
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  endpoint text not null,
  payload jsonb not null default '{}',
  permission text default '',
  created_at timestamptz not null default now(),
  unique(endpoint)
);

create table if not exists public.integration_settings (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name text not null,
  provider text default 'custom',
  enabled boolean not null default false,
  status text default 'CONFIGURED',
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.login_identifier_attempts (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  identifier_hash text not null,
  attempts integer not null default 1,
  blocked_until timestamptz,
  last_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(ip_hash, identifier_hash)
);

create table if not exists public.payroll_exports (
  id uuid primary key default gen_random_uuid(),
  provider text default 'manual-csv',
  status text default 'READY',
  from_date date,
  to_date date,
  payload jsonb not null default '{}',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.access_control_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id),
  device_id text default 'main-gate',
  direction text default 'ENTRY',
  decision text default 'ALLOW',
  reason text default '',
  created_at timestamptz not null default now()
);

-- =========================
-- 5) Indexes
-- =========================
create index if not exists idx_employees_email on public.employees(lower(email));
create index if not exists idx_employees_phone on public.employees(phone);
create index if not exists idx_employees_manager on public.employees(manager_employee_id);
create index if not exists idx_profiles_employee on public.profiles(employee_id);
create index if not exists idx_profiles_phone on public.profiles(phone);
create index if not exists idx_attendance_events_employee_at on public.attendance_events(employee_id, event_at desc);
create index if not exists idx_attendance_daily_employee_date on public.attendance_daily(employee_id, date desc);
create index if not exists idx_leave_requests_employee_status on public.leave_requests(employee_id, status);
create index if not exists idx_missions_employee_status on public.missions(employee_id, status);
create index if not exists idx_audit_logs_created_at on public.audit_logs(created_at desc);
create index if not exists idx_employee_locations_employee_created on public.employee_locations(employee_id, created_at desc);
create index if not exists idx_login_identifier_attempts_last on public.login_identifier_attempts(last_attempt_at desc);

-- =========================
-- 6) Helper functions for RLS
-- =========================
create or replace function public.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select p from public.profiles p where p.id = auth.uid() limit 1;
$$;

create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select employee_id from public.profiles where id = auth.uid() limit 1;
$$;

create or replace function public.current_role_permissions()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(r.permissions, '{}')
  from public.profiles p
  left join public.roles r on r.id = p.role_id
  where p.id = auth.uid()
  limit 1;
$$;

create or replace function public.current_is_full_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select coalesce(
      '*' = any(coalesce(r.permissions, '{}'))
      or r.slug in ('admin', 'executive', 'executive-secretary', 'hr-manager'),
      false
    )
    from public.profiles p
    left join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
    limit 1
  ), false);
$$;

create or replace function public.has_permission(scope text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_is_full_access() or scope = any(public.current_role_permissions());
$$;

create or replace function public.can_access_employee(emp_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_is_full_access()
    or emp_id = public.current_employee_id()
    or exists (
      select 1 from public.employees e
      where e.id = emp_id and e.manager_employee_id = public.current_employee_id()
    ), false
  );
$$;

-- =========================
-- 7) Auth profile trigger
-- =========================
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  emp public.employees;
  fallback_role uuid;
begin
  select * into emp from public.employees where lower(email) = lower(new.email) limit 1;
  select id into fallback_role from public.roles where slug = 'employee' limit 1;
  insert into public.profiles (
    id, email, phone, full_name, avatar_url, employee_id, role_id, branch_id, department_id, governorate_id, complex_id,
    status, temporary_password, must_change_password
  ) values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'phone', emp.phone, null),
    coalesce(emp.full_name, new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'avatar_url', emp.photo_url, ''),
    emp.id,
    coalesce(emp.role_id, fallback_role),
    emp.branch_id,
    emp.department_id,
    emp.governorate_id,
    emp.complex_id,
    'ACTIVE',
    true,
    true
  )
  on conflict (id) do update set
    email = excluded.email,
    phone = coalesce(nullif(excluded.phone, ''), public.profiles.phone),
    full_name = excluded.full_name,
    avatar_url = coalesce(nullif(excluded.avatar_url, ''), public.profiles.avatar_url),
    employee_id = coalesce(public.profiles.employee_id, excluded.employee_id),
    -- عند وجود موظف مطابق للبريد، نعتمد دور الموظف كمرجع صلاحيات حتى لا يبقى الحساب على دور قديم/خاطئ.
    role_id = coalesce(excluded.role_id, public.profiles.role_id),
    branch_id = coalesce(excluded.branch_id, public.profiles.branch_id),
    department_id = coalesce(excluded.department_id, public.profiles.department_id),
    governorate_id = coalesce(excluded.governorate_id, public.profiles.governorate_id),
    complex_id = coalesce(excluded.complex_id, public.profiles.complex_id),
    status = coalesce(public.profiles.status, excluded.status),
    updated_at = now();

  if emp.id is not null then
    update public.employees set user_id = new.id, updated_at = now() where id = emp.id;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_hr_profile on auth.users;
create trigger on_auth_user_created_hr_profile
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- =========================
-- 7.5) Server-side triggers and attendance helpers
-- =========================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['roles','governorates','complexes','branches','departments','shifts','employees','profiles','attendance_daily','leave_requests','missions','attendance_exceptions','location_requests','kpi_evaluations','dispute_cases','integration_settings'] loop
    execute format('drop trigger if exists set_updated_at_%1$s on public.%1$I', t);
    execute format('create trigger set_updated_at_%1$s before update on public.%1$I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

create or replace function public.server_now()
returns timestamptz
language sql
stable
as $$ select now(); $$;

create or replace function public.calculate_late_minutes(p_employee_id uuid, p_event_at timestamptz default now())
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  emp public.employees;
  sh public.shifts;
  start_text text;
  start_ts timestamptz;
  tz text := 'Africa/Cairo';
  grace integer := 15;
begin
  select * into emp from public.employees where id = p_employee_id;
  if emp.id is null then return 0; end if;
  select * into sh from public.shifts where id = emp.shift_id;
  start_text := coalesce(sh.start_time, '09:00');
  grace := coalesce(sh.grace_minutes, 15);
  start_ts := ((p_event_at at time zone tz)::date::text || ' ' || start_text)::timestamp at time zone tz;
  return greatest(0, floor(extract(epoch from (p_event_at - start_ts)) / 60)::integer - grace);
end;
$$;

create or replace function public.upsert_attendance_daily_from_event(
  p_employee_id uuid,
  p_type text,
  p_event_at timestamptz,
  p_status text,
  p_late_minutes integer default 0,
  p_requires_review boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p_date date := (p_event_at at time zone 'Africa/Cairo')::date;
begin
  insert into public.attendance_daily (employee_id, date, status, first_check_in_at, last_check_out_at, late_minutes, work_minutes, requires_review)
  values (
    p_employee_id,
    p_date,
    case when p_type = 'CHECK_OUT' then 'PRESENT' else coalesce(p_status, p_type) end,
    case when p_type = 'CHECK_IN' then p_event_at else null end,
    case when p_type = 'CHECK_OUT' then p_event_at else null end,
    coalesce(p_late_minutes, 0),
    0,
    coalesce(p_requires_review, false)
  )
  on conflict (employee_id, date) do update set
    status = case when p_type = 'CHECK_OUT' then coalesce(attendance_daily.status, 'PRESENT') else coalesce(p_status, attendance_daily.status) end,
    first_check_in_at = case when p_type = 'CHECK_IN' then least(coalesce(attendance_daily.first_check_in_at, p_event_at), p_event_at) else attendance_daily.first_check_in_at end,
    last_check_out_at = case when p_type = 'CHECK_OUT' then greatest(coalesce(attendance_daily.last_check_out_at, p_event_at), p_event_at) else attendance_daily.last_check_out_at end,
    late_minutes = greatest(coalesce(attendance_daily.late_minutes, 0), coalesce(p_late_minutes, 0)),
    requires_review = attendance_daily.requires_review or coalesce(p_requires_review, false),
    work_minutes = case
      when coalesce(attendance_daily.first_check_in_at, case when p_type='CHECK_IN' then p_event_at end) is not null
       and coalesce(case when p_type='CHECK_OUT' then p_event_at end, attendance_daily.last_check_out_at) is not null
      then greatest(0, floor(extract(epoch from (coalesce(case when p_type='CHECK_OUT' then p_event_at end, attendance_daily.last_check_out_at) - coalesce(attendance_daily.first_check_in_at, case when p_type='CHECK_IN' then p_event_at end))) / 60)::integer)
      else attendance_daily.work_minutes
    end,
    updated_at = now();
end;
$$;

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs(action, entity_type, entity_id, actor_user_id, actor, before_data, after_data, metadata)
  values (
    lower(tg_op),
    tg_table_name,
    coalesce(new.id, old.id),
    auth.uid(),
    coalesce((select full_name from public.profiles where id = auth.uid()), 'system'),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end,
    jsonb_build_object('schema', tg_table_schema)
  );
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['employees','profiles','attendance_events','attendance_daily','leave_requests','missions','attendance_exceptions','location_requests','employee_locations','kpi_evaluations','dispute_cases','attachments','passkey_credentials','push_subscriptions','integration_settings','payroll_exports','access_control_events'] loop
    execute format('drop trigger if exists audit_row_change_%1$s on public.%1$I', t);
    execute format('create trigger audit_row_change_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- =========================
-- 8) Enable RLS
-- =========================
alter table public.permissions enable row level security;
alter table public.roles enable row level security;
alter table public.governorates enable row level security;
alter table public.complexes enable row level security;
alter table public.branches enable row level security;
alter table public.departments enable row level security;
alter table public.shifts enable row level security;
alter table public.employees enable row level security;
alter table public.profiles enable row level security;
alter table public.attendance_events enable row level security;
alter table public.attendance_daily enable row level security;
alter table public.leave_requests enable row level security;
alter table public.missions enable row level security;
alter table public.attendance_exceptions enable row level security;
alter table public.location_requests enable row level security;
alter table public.employee_locations enable row level security;
alter table public.kpi_evaluations enable row level security;
alter table public.dispute_cases enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.login_identifier_attempts enable row level security;
alter table public.attachments enable row level security;
alter table public.passkey_credentials enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.integration_settings enable row level security;
alter table public.payroll_exports enable row level security;
alter table public.access_control_events enable row level security;

-- =========================
-- 9) Policies
-- =========================
-- lookups: authenticated read, full-access write
do $$
declare t text;
begin
  foreach t in array array['permissions','roles','governorates','complexes','branches','departments','shifts','integration_settings'] loop
    execute format('drop policy if exists "lookup_read_%1$s" on public.%1$I', t);
    execute format('drop policy if exists "lookup_write_%1$s" on public.%1$I', t);
    execute format('create policy "lookup_read_%1$s" on public.%1$I for select to authenticated using (true)', t);
    execute format('create policy "lookup_write_%1$s" on public.%1$I for all to authenticated using (public.current_is_full_access()) with check (public.current_is_full_access())', t);
  end loop;
end $$;

-- employees
drop policy if exists "employees_read_scope" on public.employees;
create policy "employees_read_scope" on public.employees for select to authenticated using (public.can_access_employee(id));
drop policy if exists "employees_write_full" on public.employees;
create policy "employees_write_full" on public.employees for all to authenticated using (public.current_is_full_access()) with check (public.current_is_full_access());

-- profiles
drop policy if exists "profiles_read_scope" on public.profiles;
create policy "profiles_read_scope" on public.profiles for select to authenticated using (id = auth.uid() or public.current_is_full_access() or public.can_access_employee(employee_id));
drop policy if exists "profiles_update_full" on public.profiles;
create policy "profiles_update_full" on public.profiles for update to authenticated using (id = auth.uid() or public.current_is_full_access()) with check (id = auth.uid() or public.current_is_full_access());
drop policy if exists "profiles_insert_full" on public.profiles;
create policy "profiles_insert_full" on public.profiles for insert to authenticated with check (public.current_is_full_access());

-- employee-scoped tables
do $$
declare t text;
begin
  foreach t in array array['attendance_events','attendance_daily','leave_requests','missions','attendance_exceptions','location_requests','employee_locations','kpi_evaluations','attachments','access_control_events'] loop
    execute format('drop policy if exists "employee_scope_read_%1$s" on public.%1$I', t);
    execute format('drop policy if exists "employee_scope_insert_%1$s" on public.%1$I', t);
    execute format('drop policy if exists "employee_scope_update_%1$s" on public.%1$I', t);
    execute format('drop policy if exists "employee_scope_delete_%1$s" on public.%1$I', t);
    execute format('create policy "employee_scope_read_%1$s" on public.%1$I for select to authenticated using (public.can_access_employee(employee_id))', t);
    execute format('create policy "employee_scope_insert_%1$s" on public.%1$I for insert to authenticated with check (public.current_is_full_access() or employee_id = public.current_employee_id() or public.has_permission(''kpi:team'') or public.has_permission(''requests:approve''))', t);
    execute format('create policy "employee_scope_update_%1$s" on public.%1$I for update to authenticated using (public.current_is_full_access() or public.can_access_employee(employee_id)) with check (public.current_is_full_access() or public.can_access_employee(employee_id))', t);
    execute format('create policy "employee_scope_delete_%1$s" on public.%1$I for delete to authenticated using (public.current_is_full_access())', t);
  end loop;
end $$;

-- disputes, notifications, audit, passkeys, push, payroll
drop policy if exists "disputes_read" on public.dispute_cases;
create policy "disputes_read" on public.dispute_cases for select to authenticated using (public.current_is_full_access() or created_by = auth.uid() or public.can_access_employee(employee_id));
drop policy if exists "disputes_write" on public.dispute_cases;
create policy "disputes_write" on public.dispute_cases for all to authenticated using (public.current_is_full_access() or created_by = auth.uid()) with check (public.current_is_full_access() or created_by = auth.uid());

drop policy if exists "notifications_read" on public.notifications;
create policy "notifications_read" on public.notifications for select to authenticated using (user_id = auth.uid() or public.current_is_full_access());
drop policy if exists "notifications_write" on public.notifications;
create policy "notifications_write" on public.notifications for all to authenticated using (user_id = auth.uid() or public.current_is_full_access()) with check (user_id = auth.uid() or public.current_is_full_access());

drop policy if exists "audit_read_full" on public.audit_logs;
create policy "audit_read_full" on public.audit_logs for select to authenticated using (public.current_is_full_access() or public.has_permission('audit:view'));
drop policy if exists "audit_insert_auth" on public.audit_logs;
-- Direct INSERT is intentionally disabled; tamper-resistant audit rows are written by database triggers.

drop policy if exists "passkeys_own" on public.passkey_credentials;
drop policy if exists "login_identifier_attempts_service_only" on public.login_identifier_attempts;
create policy "login_identifier_attempts_service_only" on public.login_identifier_attempts for all to service_role using (true) with check (true);

create policy "passkeys_own" on public.passkey_credentials for all to authenticated using (user_id = auth.uid() or public.current_is_full_access()) with check (user_id = auth.uid() or public.current_is_full_access());

drop policy if exists "push_own" on public.push_subscriptions;
create policy "push_own" on public.push_subscriptions for all to authenticated using (user_id = auth.uid() or public.current_is_full_access()) with check (user_id = auth.uid() or public.current_is_full_access());

drop policy if exists "payroll_full" on public.payroll_exports;
create policy "payroll_full" on public.payroll_exports for all to authenticated using (public.current_is_full_access() or public.has_permission('payroll:manage')) with check (public.current_is_full_access() or public.has_permission('payroll:manage'));

-- =========================
-- 10) Storage buckets and policies
-- =========================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 2097152, array['image/png','image/jpeg','image/webp','image/gif']),
  ('punch-selfies', 'punch-selfies', false, 3145728, array['image/png','image/jpeg','image/webp']),
  ('employee-attachments', 'employee-attachments', false, 8388608, null)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists "avatars_upload_auth" on storage.objects;
create policy "avatars_upload_auth" on storage.objects for insert to authenticated with check (bucket_id = 'avatars');
drop policy if exists "selfies_auth_read" on storage.objects;
create policy "selfies_auth_read" on storage.objects for select to authenticated using (bucket_id = 'punch-selfies' and (owner = auth.uid() or public.current_is_full_access()));
drop policy if exists "selfies_upload_auth" on storage.objects;
create policy "selfies_upload_auth" on storage.objects for insert to authenticated with check (bucket_id = 'punch-selfies');
drop policy if exists "attachments_auth_read" on storage.objects;
create policy "attachments_auth_read" on storage.objects for select to authenticated using (bucket_id = 'employee-attachments' and (owner = auth.uid() or public.current_is_full_access()));
drop policy if exists "attachments_upload_auth" on storage.objects;
create policy "attachments_upload_auth" on storage.objects for insert to authenticated with check (bucket_id = 'employee-attachments');

-- =========================
-- 11) Realtime publication
-- =========================
do $$
begin
  alter publication supabase_realtime add table public.attendance_events;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.employee_locations;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.leave_requests;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.missions;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.kpi_evaluations;
exception when duplicate_object then null;
end $$;

-- =========================
-- 12) Seed: roles, org, shifts, people
-- =========================
insert into public.permissions (scope, name) values
('*','كل الصلاحيات'),
('dashboard:view','عرض لوحة المتابعة'),
('employees:view','عرض الموظفين'),
('employees:write','إدارة الموظفين'),
('users:manage','إدارة المستخدمين'),
('organization:manage','إدارة الهيكل الإداري'),
('attendance:self','بصمة الموظف'),
('attendance:manage','إدارة الحضور'),
('requests:approve','اعتماد الطلبات'),
('kpi:self','تقييم ذاتي'),
('kpi:team','اعتماد تقييمات الفريق'),
('kpi:manage','إدارة كل التقييمات'),
('reports:export','التقارير والتصدير'),
('audit:view','سجل التدقيق'),
('settings:manage','إعدادات النظام'),
('realtime:view','لوحة Live'),
('integrations:manage','إدارة التكاملات'),
('payroll:manage','تكامل الرواتب'),
('ai:view','تحليلات AI'),
('access_control:manage','الأجهزة والبوابات'),
('offline:manage','مزامنة Offline'),
('executive:report','تقارير المدير التنفيذي'),
('executive:mobile','المتابعة التنفيذية المختصرة'),
('executive:presence-map','خريطة التواجد التنفيذية'),
('live-location:request','طلب موقع مباشر من موظف'),
('sensitive-actions:approve','اعتماد إجراءات حساسة'),
('sensitive-actions:request','طلب اعتماد إجراء حساس'),
('approvals:manage','إدارة الاعتمادات'),
('alerts:manage','إدارة التنبيهات'),
('control-room:view','عرض غرفة التحكم'),
('daily-report:review','مراجعة التقارير اليومية')
on conflict (scope) do update set name = excluded.name;

insert into public.roles (slug, key, name, permissions) values
('admin','ADMIN','مدير النظام', array['*']),
('executive','EXECUTIVE','المدير التنفيذي', array['dashboard:view','employees:view','reports:export','executive:report','executive:mobile','executive:presence-map','live-location:request','sensitive-actions:approve','approvals:manage','alerts:manage','control-room:view','daily-report:review']),
('executive-secretary','EXECUTIVE_SECRETARY','السكرتير التنفيذي', array['dashboard:view','employees:view','reports:export','executive:report','executive:mobile','executive:presence-map','live-location:request','sensitive-actions:request','daily-report:review','alerts:manage']),
('hr-manager','HR','الموارد البشرية', array['*']),
('manager','MANAGER','مدير مباشر', array['dashboard:view','employees:view','attendance:manage','requests:approve','kpi:team','reports:export','realtime:view']),
('employee','EMPLOYEE','موظف', array['dashboard:view','attendance:self','kpi:self'])
on conflict (slug) do update set name = excluded.name, permissions = excluded.permissions, active = true;

insert into public.governorates (code, name) values ('GZ','الجيزة') on conflict (code) do update set name = excluded.name;

insert into public.complexes (code, name, governorate_id)
select 'AHLA-MANIL', 'مجمع منيل شيحة', g.id from public.governorates g where g.code='GZ'
on conflict (code) do update set name = excluded.name, governorate_id = excluded.governorate_id;

insert into public.branches (code, name, address, governorate_id, complex_id, latitude, longitude, geofence_radius_meters, max_accuracy_meters)
select 'MAIN', 'مجمع منيل شيحة', 'شارع مزلقان العرب, Manil Shihah, Abu El Numrus, Giza Governorate 12912', g.id, c.id, 29.951196809090636::numeric, 31.238367688465857::numeric, 300, 500
from public.governorates g cross join public.complexes c where g.code='GZ' and c.code='AHLA-MANIL'
on conflict (code) do update set name = excluded.name, address = excluded.address, governorate_id = excluded.governorate_id, complex_id = excluded.complex_id, latitude = excluded.latitude, longitude = excluded.longitude, geofence_radius_meters = excluded.geofence_radius_meters, max_accuracy_meters = excluded.max_accuracy_meters;

-- تثبيت إحداثيات الفرع الفعلية للبصمة الجغرافية حسب Google Maps.
update public.branches
set latitude = 29.951196809090636::numeric,
    longitude = 31.238367688465857::numeric,
    geofence_radius_meters = 300,
    max_accuracy_meters = 500,
    address = 'شارع مزلقان العرب, Manil Shihah, Abu El Numrus, Giza Governorate 12912'
where code = 'MAIN';


insert into public.departments (code, name, branch_id)
select code, name, (select id from public.branches where code='MAIN') from (values
('EXEC','الإدارة التنفيذية'),
('HR','الموارد البشرية'),
('OPS','التشغيل'),
('QURAN','القرآن والتجويد'),
('FIN','الحسابات')
) as d(code,name)
on conflict (code) do update set name = excluded.name, branch_id = excluded.branch_id;

insert into public.shifts (branch_id, name, start_time, end_time, grace_minutes, days_mask)
select b.id, 'وردية 9ص إلى 5م', '09:00', '17:00', 15, 'SAT,SUN,MON,TUE,WED,THU' from public.branches b where b.code='MAIN'
on conflict do nothing;
insert into public.shifts (branch_id, name, start_time, end_time, grace_minutes, days_mask)
select b.id, 'وردية 10ص إلى 6م', '10:00', '18:00', 15, 'SAT,SUN,MON,TUE,WED,THU' from public.branches b where b.code='MAIN'
on conflict do nothing;

-- موظفون مبدئيون. أنشئ مستخدمي Auth بنفس الإيميلات، وسيتم ربط profile تلقائيًا.
insert into public.employees (employee_code, full_name, phone, email, job_title, role_id, branch_id, department_id, governorate_id, complex_id, shift_id, status, hire_date)
select * from (
  select 'EMP-001' employee_code, 'المدير التنفيذي' full_name, 'PHONE_PLACEHOLDER_002' phone, 'executive.director@organization.local' email, 'المدير التنفيذي' job_title, (select id from public.roles where slug='executive') role_id, (select id from public.branches where code='MAIN') branch_id, (select id from public.departments where code='EXEC') department_id, (select id from public.governorates where code='GZ') governorate_id, (select id from public.complexes where code='AHLA-MANIL') complex_id, (select id from public.shifts where name='وردية 9ص إلى 5م' limit 1) shift_id, 'ACTIVE' status, current_date hire_date
  union all select 'EMP-002','السكرتير التنفيذي','PHONE_PLACEHOLDER_003','executive.secretary@organization.local','السكرتير التنفيذي',(select id from public.roles where slug='executive-secretary'),(select id from public.branches where code='MAIN'),(select id from public.departments where code='EXEC'),(select id from public.governorates where code='GZ'),(select id from public.complexes where code='AHLA-MANIL'),(select id from public.shifts where name='وردية 9ص إلى 5م' limit 1),'ACTIVE',current_date
  union all select 'EMP-003','مسؤول الموارد البشرية','PHONE_PLACEHOLDER_004','hr@ahla.local','HR',(select id from public.roles where slug='hr-manager'),(select id from public.branches where code='MAIN'),(select id from public.departments where code='HR'),(select id from public.governorates where code='GZ'),(select id from public.complexes where code='AHLA-MANIL'),(select id from public.shifts where name='وردية 9ص إلى 5م' limit 1),'ACTIVE',current_date
  union all select 'EMP-004','مدير التشغيل','PHONE_PLACEHOLDER_005','manager.ops@ahla.local','مدير مباشر',(select id from public.roles where slug='manager'),(select id from public.branches where code='MAIN'),(select id from public.departments where code='OPS'),(select id from public.governorates where code='GZ'),(select id from public.complexes where code='AHLA-MANIL'),(select id from public.shifts where name='وردية 10ص إلى 6م' limit 1),'ACTIVE',current_date
  union all select 'EMP-005','موظف تجريبي','PHONE_PLACEHOLDER_006','employee@ahla.local','موظف',(select id from public.roles where slug='employee'),(select id from public.branches where code='MAIN'),(select id from public.departments where code='OPS'),(select id from public.governorates where code='GZ'),(select id from public.complexes where code='AHLA-MANIL'),(select id from public.shifts where name='وردية 10ص إلى 6م' limit 1),'ACTIVE',current_date
) s
on conflict (employee_code) do update set full_name = excluded.full_name, email = excluded.email, role_id = excluded.role_id, branch_id = excluded.branch_id, department_id = excluded.department_id, shift_id = excluded.shift_id;

update public.employees e set manager_employee_id = (select id from public.employees where employee_code='EMP-004') where e.employee_code = 'EMP-005';

-- إصلاح تلقائي للأدوار والصلاحيات للحسابات الموجودة بالفعل في Auth/Profiles.
-- يعالج حالة ظهور دور خاطئ مثل "باحث/مدخل بيانات" رغم أن الموظف في جدول employees له دور إداري.
update public.profiles p
set employee_id = e.id,
    full_name = coalesce(nullif(e.full_name, ''), p.full_name),
    role_id = e.role_id,
    branch_id = e.branch_id,
    department_id = e.department_id,
    governorate_id = e.governorate_id,
    complex_id = e.complex_id,
    status = 'ACTIVE',
    updated_at = now()
from public.employees e
where lower(p.email) = lower(e.email)
  and e.is_deleted = false
  and (
    p.employee_id is distinct from e.id
    or p.role_id is distinct from e.role_id
    or p.branch_id is distinct from e.branch_id
    or p.department_id is distinct from e.department_id
  );

insert into public.integration_settings (key, name, provider, enabled, status, notes) values
('odoo-payroll','Odoo Payroll','odoo',false,'NEEDS_API_KEY','أضف مفاتيح API من Edge Function عند التفعيل'),
('xero-payroll','Xero Payroll','xero',false,'NEEDS_API_KEY','جاهز للتكامل لاحقًا'),
('access-control','بوابات الدخول','custom',false,'NEEDS_DEVICE','يتطلب جهاز أو API من مزود البوابة')
on conflict (key) do update set name = excluded.name, provider = excluded.provider, notes = excluded.notes;

-- نهاية الملف


-- END PATCH: 001_schema_rls_seed.sql


-- =========================================================
-- BEGIN PATCH: 002_repair_profile_roles.sql
-- =========================================================

-- =========================================================
-- Patch: إصلاح أدوار Profiles وربطها بجدول Employees
-- شغّل هذا الملف في Supabase SQL Editor إذا ظهر للمستخدم دور خاطئ
-- مثل: باحث/مدخل بيانات بدلاً من المدير/الأدمن.
-- =========================================================

update public.profiles p
set employee_id = e.id,
    full_name = coalesce(nullif(e.full_name, ''), p.full_name),
    role_id = e.role_id,
    branch_id = e.branch_id,
    department_id = e.department_id,
    governorate_id = e.governorate_id,
    complex_id = e.complex_id,
    status = 'ACTIVE',
    updated_at = now()
from public.employees e
where lower(p.email) = lower(e.email)
  and e.is_deleted = false
  and (
    p.employee_id is distinct from e.id
    or p.role_id is distinct from e.role_id
    or p.branch_id is distinct from e.branch_id
    or p.department_id is distinct from e.department_id
  );

-- تأكيد أن الأدوار العليا لها صلاحية كاملة.
update public.roles
set permissions = array['*'], active = true, updated_at = now()
where slug in ('admin', 'executive', 'executive-secretary', 'hr-manager');

-- فحص سريع بعد التنفيذ.
select p.email,
       p.full_name,
       r.slug as role_slug,
       r.name as role_name,
       r.permissions
from public.profiles p
left join public.roles r on r.id = p.role_id
order by p.updated_at desc;


-- END PATCH: 002_repair_profile_roles.sql


-- =========================================================
-- BEGIN PATCH: 003_user_avatar_and_mobile_ui.sql
-- =========================================================

-- =========================================================
-- Patch 003 — User Avatar support
-- شغّل هذا الملف في Supabase SQL Editor على قاعدة موجودة بالفعل.
-- يضيف avatar_url إلى profiles حتى يمكن حفظ صورة المستخدم المستقلة.
-- =========================================================

alter table public.profiles
  add column if not exists avatar_url text default '';

-- مزامنة أولية: لو المستخدم مربوط بموظف لديه photo_url ولا توجد صورة مستخدم، استخدم صورة الموظف كافتراض.
update public.profiles p
set avatar_url = e.photo_url
from public.employees e
where p.employee_id = e.id
  and coalesce(p.avatar_url, '') = ''
  and coalesce(e.photo_url, '') <> '';

-- التأكد من وجود Bucket avatars وسياسات التخزين الأساسية.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
for select using (bucket_id = 'avatars');

drop policy if exists "avatars_upload_auth" on storage.objects;
create policy "avatars_upload_auth" on storage.objects
for insert to authenticated
with check (bucket_id = 'avatars');


-- END PATCH: 003_user_avatar_and_mobile_ui.sql


-- =========================================================
-- BEGIN PATCH: 004_emergency_admin_access.sql
-- =========================================================

-- =========================================================
-- 004_emergency_admin_access.sql
-- إصلاح دخول أدمن طارئ بكامل الصلاحيات لاختبار النظام
--
-- قبل التشغيل: غيّر v_email و v_password إذا أردت.
-- بعد الدخول: غيّر كلمة المرور فورًا من Supabase Auth أو من النظام بعد التأكد من عمل صفحة تغيير كلمة المرور.
-- =========================================================

create extension if not exists pgcrypto;

do $$
declare
  v_email text := 'admin@example.local';
  v_password text := 'ChangeMe_Admin#2026!';
  v_full_name text := 'مدير النظام';
  v_user_id uuid;
  v_role_id uuid;
  v_employee_id uuid;
  v_branch_id uuid;
  v_department_id uuid;
  v_governorate_id uuid;
  v_complex_id uuid;
begin
  -- 1) تأكيد وجود دور أدمن كامل الصلاحيات
  insert into public.roles (slug, key, name, permissions, active)
  values ('admin', 'ADMIN', 'مدير النظام', array['*']::text[], true)
  on conflict (slug) do update set
    key = excluded.key,
    name = excluded.name,
    permissions = array['*']::text[],
    active = true,
    updated_at = now();

  select id into v_role_id
  from public.roles
  where slug = 'admin'
  limit 1;

  -- 2) التقاط مراجع اختيارية للفرع/القسم حتى يكون الحساب مربوطًا بالنظام
  select id into v_branch_id from public.branches where code = 'MAIN' limit 1;
  select id into v_department_id from public.departments where code in ('EXEC','HR') order by case when code='EXEC' then 0 else 1 end limit 1;
  select id into v_governorate_id from public.governorates where code = 'GZ' limit 1;
  select id into v_complex_id from public.complexes where code = 'AHLA-MANIL' limit 1;

  -- 3) إنشاء أو إصلاح مستخدم Supabase Auth
  select id into v_user_id
  from auth.users
  where lower(email) = lower(v_email)
  limit 1;

  if v_user_id is null then
    v_user_id := gen_random_uuid();

    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      confirmation_sent_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      is_super_admin
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      crypt(v_password, gen_salt('bf')),
      now(),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_full_name, 'role', 'admin'),
      now(),
      now(),
      false
    );
  else
    update auth.users
    set encrypted_password = crypt(v_password, gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        aud = 'authenticated',
        role = 'authenticated',
        banned_until = null,
        raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"provider":"email","providers":["email"]}'::jsonb,
        raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', v_full_name, 'role', 'admin'),
        updated_at = now()
    where id = v_user_id;
  end if;

  -- 4) تأكيد وجود Identity email حتى يستطيع Supabase Auth تسجيل الدخول بالبريد/الباسورد
  if exists (select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'identities') then
    if exists (select 1 from auth.identities where user_id = v_user_id and provider = 'email') then
      update auth.identities
      set identity_data = jsonb_build_object(
            'sub', v_user_id::text,
            'email', v_email,
            'email_verified', true,
            'phone_verified', false
          ),
          provider_id = v_user_id::text,
          last_sign_in_at = coalesce(last_sign_in_at, now()),
          updated_at = now()
      where user_id = v_user_id and provider = 'email';
    else
      insert into auth.identities (
        id,
        user_id,
        provider_id,
        identity_data,
        provider,
        last_sign_in_at,
        created_at,
        updated_at
      ) values (
        gen_random_uuid(),
        v_user_id,
        v_user_id::text,
        jsonb_build_object(
          'sub', v_user_id::text,
          'email', v_email,
          'email_verified', true,
          'phone_verified', false
        ),
        'email',
        now(),
        now(),
        now()
      );
    end if;
  end if;

  -- 5) إنشاء أو ربط Employee أدمن
  select id into v_employee_id
  from public.employees
  where user_id = v_user_id or lower(email) = lower(v_email)
  order by case when user_id = v_user_id then 0 else 1 end
  limit 1;

  if v_employee_id is null then
    insert into public.employees (
      employee_code,
      full_name,
      phone,
      email,
      job_title,
      role_id,
      branch_id,
      department_id,
      governorate_id,
      complex_id,
      status,
      is_active,
      is_deleted,
      hire_date,
      user_id
    ) values (
      'ADMIN-001',
      v_full_name,
      'PHONE_PLACEHOLDER_001',
      v_email,
      'أدمن رئيسي',
      v_role_id,
      v_branch_id,
      v_department_id,
      v_governorate_id,
      v_complex_id,
      'ACTIVE',
      true,
      false,
      current_date,
      v_user_id
    )
    on conflict (employee_code) do update set
      full_name = excluded.full_name,
      email = excluded.email,
      job_title = excluded.job_title,
      role_id = excluded.role_id,
      branch_id = excluded.branch_id,
      department_id = excluded.department_id,
      governorate_id = excluded.governorate_id,
      complex_id = excluded.complex_id,
      status = 'ACTIVE',
      is_active = true,
      is_deleted = false,
      user_id = excluded.user_id,
      updated_at = now()
    returning id into v_employee_id;
  else
    update public.employees
    set full_name = coalesce(nullif(full_name, ''), v_full_name),
        email = v_email,
        job_title = 'أدمن رئيسي',
        role_id = v_role_id,
        branch_id = coalesce(branch_id, v_branch_id),
        department_id = coalesce(department_id, v_department_id),
        governorate_id = coalesce(governorate_id, v_governorate_id),
        complex_id = coalesce(complex_id, v_complex_id),
        status = 'ACTIVE',
        is_active = true,
        is_deleted = false,
        user_id = v_user_id,
        updated_at = now()
    where id = v_employee_id;
  end if;

  -- 6) إنشاء/إصلاح Profile وربطه بدور الأدمن
  insert into public.profiles (
    id,
    employee_id,
    email,
    full_name,
    avatar_url,
    role_id,
    branch_id,
    department_id,
    governorate_id,
    complex_id,
    status,
    temporary_password,
    must_change_password,
    password_changed_at,
    created_at,
    updated_at
  ) values (
    v_user_id,
    v_employee_id,
    v_email,
    v_full_name,
    '',
    v_role_id,
    v_branch_id,
    v_department_id,
    v_governorate_id,
    v_complex_id,
    'ACTIVE',
    false,
    false,
    now(),
    now(),
    now()
  )
  on conflict (id) do update set
    employee_id = excluded.employee_id,
    email = excluded.email,
    full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name),
    role_id = excluded.role_id,
    branch_id = coalesce(public.profiles.branch_id, excluded.branch_id),
    department_id = coalesce(public.profiles.department_id, excluded.department_id),
    governorate_id = coalesce(public.profiles.governorate_id, excluded.governorate_id),
    complex_id = coalesce(public.profiles.complex_id, excluded.complex_id),
    status = 'ACTIVE',
    temporary_password = false,
    must_change_password = false,
    password_changed_at = now(),
    failed_logins = 0,
    locked_until = null,
    updated_at = now();

  -- 7) دعم قواعد قديمة لو كان profiles يحتوي permissions jsonb من نسخة سابقة
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'permissions'
  ) then
    execute 'update public.profiles set permissions = $1::jsonb where id = $2'
    using jsonb_build_object(
      'role', 'admin',
      'fullAccess', true,
      'system', true,
      'employees', true,
      'attendance', true,
      'reports', true,
      'settings', true
    ), v_user_id;
  end if;

  raise notice 'Emergency admin is ready. Email: %, Temporary password: %. Change it immediately after login.', v_email, v_password;
end $$;

-- 8) فحص نهائي سريع
select
  u.id as auth_user_id,
  u.email,
  u.email_confirmed_at,
  p.status as profile_status,
  p.temporary_password,
  p.must_change_password,
  e.employee_code,
  e.full_name as employee_name,
  e.is_active as employee_active,
  e.is_deleted as employee_deleted,
  r.slug as role_slug,
  r.permissions as role_permissions
from auth.users u
left join public.profiles p on p.id = u.id
left join public.employees e on e.user_id = u.id
left join public.roles r on r.id = p.role_id
where lower(u.email) = lower('admin@example.local');


-- END PATCH: 004_emergency_admin_access.sql


-- =========================================================
-- BEGIN PATCH: 005_simplify_employee_punch_fields.sql
-- =========================================================

-- =========================================================
-- Patch 005: تبسيط بيانات الموظفين والبصمة
-- - الحالة دائمًا ACTIVE
-- - لا نعتمد على الوردية في قبول البصمة
-- - وقت الدوام الرسمي للتقارير فقط: 10:00 إلى 18:00 بتوقيت القاهرة
-- - إنشاء عمود passkey_credential_id إن لم يكن موجودًا لتسجيل مرجع بصمة الجهاز
-- =========================================================

alter table public.attendance_events
  add column if not exists passkey_credential_id text;

update public.employees
set status = 'ACTIVE',
    is_active = true,
    shift_id = null
where is_deleted is not true;

create or replace function public.calculate_late_minutes(p_employee_id uuid, p_event_at timestamptz default now())
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  start_ts timestamptz;
  tz text := 'Africa/Cairo';
begin
  -- لا نستخدم الورديات. البداية الرسمية 10:00 صباحًا للتقارير فقط.
  start_ts := ((p_event_at at time zone tz)::date::text || ' 10:00')::timestamp at time zone tz;
  return greatest(0, floor(extract(epoch from (p_event_at - start_ts)) / 60)::integer);
end;
$$;

create or replace function public.force_employee_active_defaults()
returns trigger
language plpgsql
as $$
begin
  new.status := 'ACTIVE';
  new.is_active := true;
  new.shift_id := null;
  if new.employee_code is null or btrim(new.employee_code) = '' then
    new.employee_code := 'EMP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_force_employee_active_defaults on public.employees;
create trigger trg_force_employee_active_defaults
before insert or update on public.employees
for each row execute function public.force_employee_active_defaults();


-- END PATCH: 005_simplify_employee_punch_fields.sql


-- =========================================================
-- BEGIN PATCH: 006_single_branch_locations_disputes_cleanup.sql
-- =========================================================

-- =========================================================
-- Patch 006 — Single Branch + Live Location Requests + Complaint Flow
-- تاريخ التنفيذ: 27 أبريل 2026
-- =========================================================

-- 1) اعتماد مجمع واحد فقط بإحداثيات منيل شيحة الصحيحة
update public.governorates
set name = 'الجيزة'
where code in ('GZ', 'GIZ') or name ilike '%جيزة%';

update public.complexes
set name = 'مجمع منيل شيحة'
where code in ('AHLA-MANIL', 'CX-AHLA-MANIL') or name ilike '%منيل%';

update public.branches
set name = 'مجمع منيل شيحة',
    address = 'مجمع منيل شيحة - الجيزة',
    latitude = 29.95109939158933,
    longitude = 31.238741920853883,
    geofence_radius_meters = 300,
    max_accuracy_meters = 2000,
    active = true,
    is_deleted = false
where code in ('MAIN', 'AHLA-MANIL') or name ilike '%منيل%';

-- 2) تثبيت أن كل الموظفين نشطون ومرتبطون بالمجمع الواحد
update public.employees
set status = 'ACTIVE',
    is_active = true,
    branch_id = coalesce(branch_id, (select id from public.branches where code in ('MAIN','AHLA-MANIL') or name ilike '%منيل%' order by created_at nulls last limit 1)),
    complex_id = coalesce(complex_id, (select id from public.complexes where code in ('AHLA-MANIL','CX-AHLA-MANIL') or name ilike '%منيل%' order by created_at nulls last limit 1)),
    governorate_id = coalesce(governorate_id, (select id from public.governorates where code in ('GZ','GIZ') or name ilike '%جيزة%' order by created_at nulls last limit 1)),
    shift_id = null
where is_deleted is not true;

-- 3) تبسيط طلبات المواقع: لا سبب ولا غرض مطلوب من الواجهة
alter table public.location_requests
  alter column purpose set default 'فتح الموقع وإرسال اللوكيشن المباشر',
  alter column request_reason set default '';

update public.location_requests
set purpose = 'فتح الموقع وإرسال اللوكيشن المباشر',
    request_reason = ''
where purpose is null or trim(purpose) = '' or request_reason is not null;

-- 4) توحيد حالة الشكاوى الجديدة لتذهب للجنة مباشرة
alter table public.dispute_cases
  alter column status set default 'IN_REVIEW',
  alter column severity set default 'MEDIUM';

-- 5) صلاحيات أساسية للموظف لاستخدام الشكاوى وإرسال الموقع
insert into public.permissions (scope, name)
values
  ('disputes:create', 'تسجيل شكوى ذاتية'),
  ('location:self', 'إرسال موقعي الحالي')
on conflict (scope) do update set name = excluded.name;

update public.roles
set permissions = array(
  select distinct unnest(coalesce(public.roles.permissions, '{}'::text[]) || array['dashboard:view','attendance:self','kpi:self','disputes:create','location:self'])
)
where slug = 'employee' or key = 'EMPLOYEE';

-- 6) ملاحظة تشغيلية:
-- بعد تشغيل هذا الملف افتح tools/reset-cache.html لمسح الكاش ثم أعد فتح النظام.


-- END PATCH: 006_single_branch_locations_disputes_cleanup.sql


-- =========================================================
-- BEGIN PATCH: 007_login_punch_gps_layout_fix.sql
-- =========================================================

-- =========================================================
-- Patch 007: Login UX + Punch GPS tolerance + clean location display
-- Date: 27 Apr 2026
-- =========================================================

-- تنظيف عنوان المجمع من رابط Google Maps الطويل حتى لا يكسر واجهة البصمة
-- وتوسيع نطاق ودقة GPS المسموحة للاختبار العملي على الموبايل وأجهزة المكتب.
update public.branches
set name = 'مجمع منيل شيحة',
    address = 'مجمع منيل شيحة - الجيزة',
    latitude = 29.95109939158933,
    longitude = 31.238741920853883,
    geofence_radius_meters = 300,
    max_accuracy_meters = 2000,
    active = true,
    is_deleted = false,
    updated_at = now()
where code in ('MAIN', 'AHLA-MANIL')
   or name ilike '%منيل شيحة%';

-- ضمان أن أي موظف بدون فرع يعود للمجمع الواحد المعتمد.
update public.employees e
set branch_id = b.id,
    is_active = true,
    status = 'ACTIVE',
    updated_at = now()
from public.branches b
where b.name = 'مجمع منيل شيحة'
  and (e.branch_id is null or e.is_active is distinct from true or e.status is distinct from 'ACTIVE');

-- ملاحظة:
-- البصمة أصبحت تقبل inside_branch_low_accuracy عند وجود GPS ضعيف لكن الموقع داخل نطاق المجمع مع هامش الدقة.


-- END PATCH: 007_login_punch_gps_layout_fix.sql


-- =========================================================
-- BEGIN PATCH: 008_supabase_cli_advisor_hardening.sql
-- =========================================================

-- Advisor hardening applied after Supabase CLI checks.
-- Keeps application-facing RPCs available for signed-in users, but removes public anon execution.

alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.server_now() set search_path = public, pg_temp;
alter function public.audit_row_change() set search_path = public, pg_temp;
alter function public.calculate_late_minutes(uuid, timestamptz) set search_path = public, pg_temp;
alter function public.can_access_employee(uuid) set search_path = public, pg_temp;
alter function public.current_employee_id() set search_path = public, pg_temp;
alter function public.current_is_full_access() set search_path = public, pg_temp;
alter function public.current_profile() set search_path = public, pg_temp;
alter function public.current_role_permissions() set search_path = public, pg_temp;
alter function public.handle_new_auth_user() set search_path = public, pg_temp;
alter function public.has_permission(text) set search_path = public, pg_temp;
alter function public.upsert_attendance_daily_from_event(uuid, text, timestamptz, text, integer, boolean) set search_path = public, pg_temp;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    execute 'alter function public.rls_auto_enable() set search_path = public, pg_temp';
    execute 'revoke execute on function public.rls_auto_enable() from anon';
    execute 'revoke execute on function public.rls_auto_enable() from public';
    execute 'revoke execute on function public.rls_auto_enable() from authenticated';
  end if;
end $$;

revoke execute on function public.audit_row_change() from anon;
revoke execute on function public.calculate_late_minutes(uuid, timestamptz) from anon;
revoke execute on function public.can_access_employee(uuid) from anon;
revoke execute on function public.current_employee_id() from anon;
revoke execute on function public.current_is_full_access() from anon;
revoke execute on function public.current_profile() from anon;
revoke execute on function public.current_role_permissions() from anon;
revoke execute on function public.handle_new_auth_user() from anon;
revoke execute on function public.has_permission(text) from anon;
revoke execute on function public.upsert_attendance_daily_from_event(uuid, text, timestamptz, text, integer, boolean) from anon;

revoke execute on function public.audit_row_change() from public;
revoke execute on function public.calculate_late_minutes(uuid, timestamptz) from public;
revoke execute on function public.can_access_employee(uuid) from public;
revoke execute on function public.current_employee_id() from public;
revoke execute on function public.current_is_full_access() from public;
revoke execute on function public.current_profile() from public;
revoke execute on function public.current_role_permissions() from public;
revoke execute on function public.handle_new_auth_user() from public;
revoke execute on function public.has_permission(text) from public;
revoke execute on function public.upsert_attendance_daily_from_event(uuid, text, timestamptz, text, integer, boolean) from public;

grant execute on function public.calculate_late_minutes(uuid, timestamptz) to authenticated;
grant execute on function public.can_access_employee(uuid) to authenticated;
grant execute on function public.current_employee_id() to authenticated;
grant execute on function public.current_is_full_access() to authenticated;
grant execute on function public.current_profile() to authenticated;
grant execute on function public.current_role_permissions() to authenticated;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.upsert_attendance_daily_from_event(uuid, text, timestamptz, text, integer, boolean) to authenticated;

revoke execute on function public.audit_row_change() from authenticated;
revoke execute on function public.handle_new_auth_user() from authenticated;

drop policy if exists "avatars_public_read" on storage.objects;

drop index if exists public.idx_employees_email;
drop index if exists public.idx_employees_phone;


-- END PATCH: 008_supabase_cli_advisor_hardening.sql


-- =========================================================
-- BEGIN PATCH: 009_passkey_attendance_activation.sql
-- =========================================================

-- Activate browser passkey attendance fields and refresh PostgREST schema cache.

alter table public.attendance_events
  add column if not exists passkey_credential_id text;

alter table public.attendance_events
  add column if not exists passkey_verified_at timestamptz;

create index if not exists idx_attendance_events_passkey_credential
  on public.attendance_events(passkey_credential_id)
  where passkey_credential_id is not null;

select pg_notify('pgrst', 'reload schema');


-- END PATCH: 009_passkey_attendance_activation.sql


-- =========================================================
-- BEGIN PATCH: 010_simplify_employee_users_remove_payroll_gps_production.sql
-- =========================================================

-- =========================================================
-- 010 - تبسيط بيانات الموظفين والمستخدمين + حذف صلاحيات الرواتب + ضبط GPS للإنتاج
-- لا يحذف .git أو supabase/.temp أو 004_emergency_admin_access.sql
-- =========================================================

-- 1) حذف صلاحيات الرواتب من نظام الصلاحيات لأنها لم تعد مستخدمة في الواجهة.
delete from public.permissions where scope = 'payroll:manage';

do $$
declare
  permissions_type text;
begin
  select udt_name
  into permissions_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'roles'
    and column_name = 'permissions';

  if permissions_type = '_text' then
    update public.roles
    set permissions = array_remove(permissions, 'payroll:manage')
    where permissions::text ilike '%payroll%';
  elsif permissions_type = 'jsonb' then
    update public.roles
    set permissions = case
      when jsonb_typeof(permissions) = 'array' then (
        select coalesce(jsonb_agg(value), '[]'::jsonb)
        from jsonb_array_elements(permissions) as value
        where trim(both '"' from value::text) <> 'payroll:manage'
      )
      when jsonb_typeof(permissions) = 'object' then permissions - 'payroll:manage' - 'payroll'
      else permissions
    end
    where permissions::text ilike '%payroll%';
  end if;
end $$;

-- إزالة تكاملات الرواتب القديمة من شاشة التكاملات إن كانت موجودة.
delete from public.integration_settings
where key ilike '%payroll%'
   or provider ilike '%payroll%'
   or name ilike '%Payroll%'
   or name ilike '%رواتب%';

-- 2) ضبط GPS للإنتاج: نطاق المجمع 300 متر، وأقصى دقة GPS مقبولة 500 متر.
update public.branches
set
  name = 'مجمع منيل شيحة',
  address = 'مجمع منيل شيحة - الجيزة',
  latitude = 29.95109939158933,
  longitude = 31.238741920853883,
  geofence_radius_meters = 300,
  max_accuracy_meters = 500,
  active = true,
  is_deleted = false
where name ilike '%منيل%' or code in ('MAIN', 'AHLA-MANIL');

-- بعض النسخ لديها أعمدة إضافية في complexes من Patches سابقة؛ نحدثها فقط لو موجودة.
do $$
begin
  update public.complexes
  set name = 'مجمع منيل شيحة', active = true, is_deleted = false
  where name ilike '%منيل%' or code in ('AHLA-MANIL', 'CX-AHLA-MANIL');

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='complexes' and column_name='address') then
    execute $sql$update public.complexes set address = 'مجمع منيل شيحة - الجيزة' where name ilike '%منيل%' or code in ('AHLA-MANIL', 'CX-AHLA-MANIL')$sql$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='complexes' and column_name='latitude') then
    execute $sql$update public.complexes set latitude = 29.95109939158933 where name ilike '%منيل%' or code in ('AHLA-MANIL', 'CX-AHLA-MANIL')$sql$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='complexes' and column_name='longitude') then
    execute $sql$update public.complexes set longitude = 31.238741920853883 where name ilike '%منيل%' or code in ('AHLA-MANIL', 'CX-AHLA-MANIL')$sql$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='complexes' and column_name='radius_meters') then
    execute $sql$update public.complexes set radius_meters = 300 where name ilike '%منيل%' or code in ('AHLA-MANIL', 'CX-AHLA-MANIL')$sql$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='complexes' and column_name='max_accuracy_meters') then
    execute $sql$update public.complexes set max_accuracy_meters = 500 where name ilike '%منيل%' or code in ('AHLA-MANIL', 'CX-AHLA-MANIL')$sql$;
  end if;
end $$;

-- 3) إزالة الاعتماد العملي على كود الموظف والدوام المنفصل في البيانات الجديدة.
alter table if exists public.employees alter column employee_code drop not null;
update public.employees set employee_code = null where employee_code is not null;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='employees' and column_name='shift_id') then
    execute 'update public.employees set shift_id = null';
  end if;
end $$;

-- 4) تثبيت الحالة Active لكل الموظفين لأن النظام الحالي لا يحتاج حالات متعددة للموظف.
update public.employees
set status = 'ACTIVE', is_active = true, is_deleted = false
where coalesce(is_deleted, false) = false;

-- 5) حذف trigger قديم كان يعيد توليد employee_code إن وُجد.
drop trigger if exists trg_employee_defaults_single_branch on public.employees;
drop function if exists public.employee_defaults_single_branch();

-- 6) تبسيط profiles: إبقاء الربط والصلاحيات، بدون فرض فرع/قسم ظاهر للمستخدم.
update public.profiles
set status = coalesce(status, 'ACTIVE')
where id is not null;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='is_active') then
    execute 'update public.profiles set is_active = true';
  end if;
end $$;


-- END PATCH: 010_simplify_employee_users_remove_payroll_gps_production.sql


-- =========================================================
-- BEGIN PATCH: 011_advanced_uiux_diagnostics_autolink.sql
-- =========================================================

-- =========================================================
-- 011 Advanced UI/UX diagnostics + single complex settings + rejected punch logging support
-- Safe patch for testing. Does not delete .git, .temp, or emergency admin files.
-- =========================================================

-- 1) Single complex/branch production coordinates
update public.branches
set
  name = 'مجمع منيل شيحة',
  address = 'مجمع منيل شيحة - الجيزة',
  latitude = 29.95109939158933,
  longitude = 31.238741920853883,
  geofence_radius_meters = 300,
  max_accuracy_meters = 500,
  active = true,
  is_deleted = false,
  updated_at = now()
where id = (select id from public.branches order by created_at nulls last limit 1);

insert into public.branches (code, name, address, latitude, longitude, geofence_radius_meters, max_accuracy_meters, active, is_deleted)
select 'AHLA-MANIL', 'مجمع منيل شيحة', 'مجمع منيل شيحة - الجيزة', 29.95109939158933, 31.238741920853883, 300, 500, true, false
where not exists (select 1 from public.branches);

update public.complexes
set name = 'مجمع منيل شيحة', active = true, is_deleted = false, updated_at = now()
where id = (select id from public.complexes order by created_at nulls last limit 1);

insert into public.complexes (code, name, active, is_deleted)
select 'CX-AHLA-MANIL', 'مجمع منيل شيحة', true, false
where not exists (select 1 from public.complexes);

-- 2) Auto-link profiles to employees by matching e-mail.
update public.profiles p
set
  employee_id = e.id,
  full_name = coalesce(nullif(p.full_name, ''), e.full_name),
  role_id = coalesce(p.role_id, e.role_id),
  branch_id = coalesce(p.branch_id, e.branch_id),
  department_id = coalesce(p.department_id, e.department_id),
  governorate_id = coalesce(p.governorate_id, e.governorate_id),
  complex_id = coalesce(p.complex_id, e.complex_id),
  status = 'ACTIVE',
  updated_at = now()
from public.employees e
where lower(p.email) = lower(e.email)
  and (p.employee_id is null or p.employee_id <> e.id);

update public.employees e
set user_id = p.id, updated_at = now()
from public.profiles p
where p.employee_id = e.id
  and (e.user_id is null or e.user_id <> p.id);

-- 3) Ensure rejected punch rows can be reviewed through attendance_events.
-- This table already supports status='REJECTED', requires_review=true, geofence_status, distance, and accuracy.
create index if not exists idx_attendance_events_rejected_review
on public.attendance_events (requires_review, status, event_at desc)
where requires_review = true or status = 'REJECTED';

-- 4) Keep all employees active in this simplified single-branch model.
update public.employees
set status = 'ACTIVE', is_active = true, is_deleted = false, updated_at = now()
where is_deleted is distinct from true;



-- END PATCH: 011_advanced_uiux_diagnostics_autolink.sql


-- =========================================================
-- BEGIN PATCH: 012_strong_features_review_devices_reports_demo.sql
-- =========================================================

-- =========================================================
-- Patch 012 — Strong HR Features
-- مراجعة البصمات المرفوضة + الأجهزة المعتمدة + التقارير + سجل الأمان
-- يحافظ على ملفات الاختبار والطوارئ ولا يحذف أي بيانات.
-- =========================================================

-- 1) توسيع جدول الحضور لدعم مراجعة البصمات المرفوضة
alter table if exists public.attendance_events
  add column if not exists review_decision text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by_user_id uuid,
  add column if not exists biometric_method text,
  add column if not exists passkey_credential_id uuid,
  add column if not exists risk_flags jsonb default '[]'::jsonb;

create index if not exists idx_attendance_events_rejected_review
  on public.attendance_events (status, requires_review, event_at desc);

create index if not exists idx_attendance_events_month_employee
  on public.attendance_events (employee_id, event_at desc);

-- 2) توسيع passkey_credentials لإدارة الأجهزة المعتمدة
alter table if exists public.passkey_credentials
  add column if not exists employee_id uuid references public.employees(id) on delete set null,
  add column if not exists label text,
  add column if not exists platform text,
  add column if not exists user_agent text,
  add column if not exists trusted boolean default true,
  add column if not exists status text default 'DEVICE_TRUSTED',
  add column if not exists trusted_at timestamptz,
  add column if not exists disabled_at timestamptz,
  add column if not exists last_used_at timestamptz;

create index if not exists idx_passkey_credentials_employee_status
  on public.passkey_credentials (employee_id, status);

-- 3) ربط الأجهزة بالمستخدم/الموظف إن كانت البيانات القديمة لا تحتوي employee_id
update public.passkey_credentials pc
set employee_id = p.employee_id
from public.profiles p
where pc.employee_id is null
  and pc.user_id = p.id
  and p.employee_id is not null;

-- 4) صلاحيات الصفحات الجديدة
insert into public.permissions (scope, name, description)
values
  ('attendance:review', 'مراجعة البصمات المرفوضة', 'اعتماد أو رفض محاولات البصمة المرفوضة'),
  ('devices:manage', 'إدارة الأجهزة المعتمدة', 'اعتماد وتعطيل مفاتيح المرور وأجهزة البصمة'),
  ('security:view', 'عرض سجل الأمان', 'مراجعة الدخول الفاشل وتغيير كلمات المرور'),
  ('demo:manage', 'إدارة وضع التدريب', 'تشغيل وضع تدريب محلي دون التأثير على Supabase')
on conflict (scope) do update
set name = excluded.name,
    description = excluded.description;

-- 5) منح المديرين/HR صلاحية مراجعة البصمات، مع ترك الأدمن كما هو
do $$
declare
  permissions_type text;
begin
  select udt_name
  into permissions_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'roles'
    and column_name = 'permissions';

  if permissions_type = '_text' then
    update public.roles
    set permissions = (
      select array_agg(distinct value)
      from unnest(coalesce(permissions, '{}'::text[]) || array['attendance:review']) as value
    )
    where lower(coalesce(slug, key, name, '')) in ('direct-manager','manager','hr-manager','hr');
  elsif permissions_type = 'jsonb' then
    update public.roles
    set permissions = (
      select jsonb_agg(distinct value)
      from jsonb_array_elements_text(coalesce(permissions, '[]'::jsonb) || '["attendance:review"]'::jsonb) as value
    )
    where lower(coalesce(slug, key, name, '')) in ('direct-manager','manager','hr-manager','hr');
  end if;
end $$;

-- 6) إعدادات افتراضية للتنبيهات والتقرير الشهري
insert into public.integration_settings (key, name, provider, enabled, status, notes)
values
  ('missing_punch_alerts', 'تنبيهات عدم تسجيل البصمة', 'internal', true, 'READY', 'تنبيه الموظفين الذين لم يسجلوا حضور اليوم'),
  ('monthly_attendance_report', 'التقرير الشهري بتصميم الجمعية', 'internal-print', true, 'READY', 'PDF عبر نافذة الطباعة من المتصفح')
on conflict (key) do update
set enabled = excluded.enabled,
    status = excluded.status,
    notes = excluded.notes;

-- 7) تثبيت إحداثيات مجمع منيل شيحة
update public.branches
set name = 'مجمع منيل شيحة',
    address = 'مجمع منيل شيحة - الجيزة',
    latitude = 29.95109939158933,
    longitude = 31.238741920853883,
    geofence_radius_meters = 300,
    max_accuracy_meters = 500,
    active = true
where id in (select id from public.branches order by created_at nulls last limit 1);


-- END PATCH: 012_strong_features_review_devices_reports_demo.sql


-- =========================================================
-- BEGIN PATCH: 013_phone_login_identifier.sql
-- =========================================================

-- =========================================================
-- 013 Phone Login Identifier Resolver
-- Allows the frontend to accept phone number OR email at login.
-- =========================================================

alter table if exists public.profiles add column if not exists phone text;

create or replace function public.normalize_egypt_phone(input_phone text)
returns text
language sql
immutable
as $$
  with cleaned as (
    select regexp_replace(coalesce(input_phone, ''), '[^0-9]', '', 'g') as digits
  )
  select case
    when digits = '' then ''
    when digits like '0020%' then '0' || substring(digits from 5)
    when digits like '20%' and length(digits) >= 12 then '0' || substring(digits from 3)
    when digits like '1%' and length(digits) = 10 then '0' || digits
    else digits
  end
  from cleaned;
$$;

create or replace function public.resolve_login_identifier(login_identifier text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_identifier text := trim(coalesce(login_identifier, ''));
  v_phone text := public.normalize_egypt_phone(login_identifier);
  v_email text;
begin
  if v_identifier = '' then
    return null;
  end if;

  if position('@' in v_identifier) > 0 then
    return lower(v_identifier);
  end if;

  select lower(coalesce(e.email, au.email))
    into v_email
  from public.employees e
  left join auth.users au on au.id = e.user_id
  where e.is_deleted is not true
    and coalesce(e.is_active, true) is true
    and coalesce(e.status, 'ACTIVE') in ('ACTIVE', 'INVITED')
    and public.normalize_egypt_phone(e.phone) = v_phone
    and coalesce(e.email, au.email) is not null
  order by e.updated_at desc nulls last, e.created_at desc nulls last
  limit 1;

  if v_email is null then
    select lower(au.email)
      into v_email
    from public.profiles p
    join auth.users au on au.id = p.id
    where coalesce(p.status, 'ACTIVE') in ('ACTIVE', 'INVITED')
      and public.normalize_egypt_phone(coalesce(p.phone, '')) = v_phone
    order by p.updated_at desc nulls last, p.created_at desc nulls last
    limit 1;
  end if;

  return v_email;
end;
$$;

revoke all on function public.resolve_login_identifier(text) from public;
grant execute on function public.resolve_login_identifier(text) to authenticated;
grant execute on function public.resolve_login_identifier(text) to service_role;

create index if not exists idx_employees_phone_normalized on public.employees (public.normalize_egypt_phone(phone));
create index if not exists idx_profiles_phone_normalized on public.profiles (public.normalize_egypt_phone(phone));


-- END PATCH: 013_phone_login_identifier.sql


-- =========================================================
-- BEGIN PATCH: 014_location_schema_contact_and_precise_coordinates.sql
-- =========================================================

-- =========================================================
-- 014 - Fix employee location payload compatibility + contact fields + precise coordinates
-- Date: 28 Apr 2026
-- =========================================================

-- Keep high precision for the exact Google Maps coordinates supplied by operations.
alter table if exists public.branches
  alter column latitude type numeric(18,15) using latitude::numeric,
  alter column longitude type numeric(18,15) using longitude::numeric;

alter table if exists public.employees
  alter column last_location_latitude type numeric(18,15) using last_location_latitude::numeric,
  alter column last_location_longitude type numeric(18,15) using last_location_longitude::numeric;

alter table if exists public.attendance_events
  alter column latitude type numeric(18,15) using latitude::numeric,
  alter column longitude type numeric(18,15) using longitude::numeric;

alter table if exists public.employee_locations
  alter column latitude type numeric(18,15) using latitude::numeric,
  alter column longitude type numeric(18,15) using longitude::numeric;

alter table if exists public.employee_locations
  add column if not exists accuracy_meters numeric(10,2);

alter table if exists public.profiles
  add column if not exists phone text;

-- The frontend now sends accuracy_meters only. This patch intentionally does not add an
-- accuracy column, so bad payloads keep failing instead of hiding schema drift.
update public.branches
set name = 'مجمع منيل شيحة',
    address = 'شارع مزلقان العرب, Manil Shihah, Abu El Numrus, Giza Governorate 12912',
    latitude = 29.951196809090636,
    longitude = 31.238367688465857,
    geofence_radius_meters = 300,
    max_accuracy_meters = 500,
    active = true,
    is_deleted = false,
    updated_at = now()
where code in ('MAIN', 'AHLA-MANIL')
   or name ilike '%منيل%';

insert into public.branches (code, name, address, latitude, longitude, geofence_radius_meters, max_accuracy_meters, active, is_deleted)
select 'AHLA-MANIL',
       'مجمع منيل شيحة',
       'شارع مزلقان العرب, Manil Shihah, Abu El Numrus, Giza Governorate 12912',
       29.951196809090636,
       31.238367688465857,
       300,
       500,
       true,
       false
where not exists (select 1 from public.branches where code in ('MAIN', 'AHLA-MANIL') or name ilike '%منيل%');

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='complexes' and column_name='address') then
    execute $sql$
      update public.complexes
      set address = 'شارع مزلقان العرب, Manil Shihah, Abu El Numrus, Giza Governorate 12912'
      where name ilike '%منيل%' or code in ('AHLA-MANIL', 'CX-AHLA-MANIL')
    $sql$;
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='complexes' and column_name='latitude') then
    execute $sql$
      update public.complexes
      set latitude = 29.951196809090636
      where name ilike '%منيل%' or code in ('AHLA-MANIL', 'CX-AHLA-MANIL')
    $sql$;
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='complexes' and column_name='longitude') then
    execute $sql$
      update public.complexes
      set longitude = 31.238367688465857
      where name ilike '%منيل%' or code in ('AHLA-MANIL', 'CX-AHLA-MANIL')
    $sql$;
  end if;
end $$;

-- Keep phone login lookup fast after contact edits.
create index if not exists idx_employees_phone_normalized on public.employees (public.normalize_egypt_phone(phone));
create index if not exists idx_profiles_phone_normalized on public.profiles (public.normalize_egypt_phone(phone));


-- END PATCH: 014_location_schema_contact_and_precise_coordinates.sql


-- =========================================================
-- BEGIN PATCH: 015_critical_security_hardening.sql
-- =========================================================

-- =========================================================
-- 015 Critical Security Hardening
-- - Restrict phone login resolver RPC from anon browser access.
-- - Keep audit logs tamper-resistant.
-- - Normalize passkey credential column type.
-- =========================================================

revoke all on function public.resolve_login_identifier(text) from public;
revoke execute on function public.resolve_login_identifier(text) from anon;
grant execute on function public.resolve_login_identifier(text) to authenticated;
grant execute on function public.resolve_login_identifier(text) to service_role;

drop policy if exists "audit_insert_auth" on public.audit_logs;
revoke insert on public.audit_logs from authenticated;

alter table if exists public.attendance_events
  alter column passkey_credential_id type text using passkey_credential_id::text;


-- Phone login resolver rate-limit storage. Edge Function writes with service_role only.
create table if not exists public.login_identifier_attempts (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  identifier_hash text not null,
  attempts integer not null default 1,
  blocked_until timestamptz,
  last_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(ip_hash, identifier_hash)
);

alter table public.login_identifier_attempts enable row level security;
drop policy if exists "login_identifier_attempts_service_only" on public.login_identifier_attempts;
create policy "login_identifier_attempts_service_only" on public.login_identifier_attempts for all to service_role using (true) with check (true);
create index if not exists idx_login_identifier_attempts_last on public.login_identifier_attempts(last_attempt_at desc);

alter table if exists public.profiles add column if not exists phone text;
alter table if exists public.attachments
  add column if not exists bucket_id text default '',
  add column if not exists storage_path text default '',
  alter column url set default '';


-- END PATCH: 015_critical_security_hardening.sql


-- =========================================================
-- BEGIN PATCH: 016_import_employee_roster_from_excel.sql
-- =========================================================

-- =========================================================
-- 016 Safe Employee Roster Import Template
-- تم تنظيف هذا الملف من بيانات الموظفين الحقيقية ومن صيغة كلمات المرور المتوقعة.
-- لا تستخدم كلمات مرور مبنية على رقم الهاتف. استخدم Edge Function admin-create-user
-- لإنشاء الحسابات بكلمات مرور عشوائية، أو أرسل دعوات/روابط إعادة تعيين آمنة.
-- =========================================================

-- طريقة الاستخدام الآمنة:
-- 1) استورد الموظفين فقط إلى public.employees بعد مراجعة البيانات.
-- 2) أنشئ حسابات الدخول من لوحة الإدارة أو من Edge Function admin-create-user.
-- 3) لا تحفظ ملف Excel الحقيقي داخل المستودع أو نسخة التسليم.

create extension if not exists pgcrypto;

alter table if exists public.profiles add column if not exists phone text;

-- مثال تجريبي فقط. احذف هذا المثال قبل إدخال بيانات حقيقية.
insert into public.employees (
  employee_code,
  full_name,
  phone,
  email,
  job_title,
  role_id,
  branch_id,
  department_id,
  governorate_id,
  complex_id,
  shift_id,
  status,
  is_active,
  is_deleted,
  hire_date
)
select
  'EMP-DEMO-001',
  'موظف تجربة آمن',
  'PHONE_PLACEHOLDER_001',
  'demo.employee@ahla-shabab.local',
  'موظف تجربة',
  (select id from public.roles where slug = 'employee' limit 1),
  (select id from public.branches where code = 'MAIN' limit 1),
  (select id from public.departments where code = 'OPS' limit 1),
  (select id from public.governorates where code = 'GZ' limit 1),
  (select id from public.complexes where code = 'AHLA-MANIL' limit 1),
  (select id from public.shifts order by name limit 1),
  'ACTIVE',
  true,
  false,
  current_date
where not exists (select 1 from public.employees where employee_code = 'EMP-DEMO-001');

-- إنشاء مستخدم Auth يتم من لوحة الإدارة / Edge Function، وليس من SQL مباشر داخل auth.users.


-- END PATCH: 016_import_employee_roster_from_excel.sql


-- =========================================================
-- BEGIN PATCH: 017_completion_pack_tables.sql
-- =========================================================

-- =========================================================
-- Completion Pack Tables
-- Executive report schedules, announcement log, and backup metadata.
-- Run after 001_schema_rls_seed.sql and security patches.
-- =========================================================

create table if not exists public.report_schedules (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  report_key text not null default 'employees',
  frequency text not null default 'MONTHLY',
  format text not null default 'CSV',
  recipients text[] not null default '{}',
  is_active boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  target_scope text not null default 'ALL',
  target_value text default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.system_backups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  backup_type text not null default 'MANUAL',
  summary jsonb not null default '{}',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.report_schedules enable row level security;
alter table public.employee_announcements enable row level security;
alter table public.system_backups enable row level security;

drop policy if exists "report_schedules_full" on public.report_schedules;
create policy "report_schedules_full" on public.report_schedules
  for all to authenticated
  using (public.current_is_full_access() or public.has_permission('reports:view'))
  with check (public.current_is_full_access());

drop policy if exists "employee_announcements_read" on public.employee_announcements;
create policy "employee_announcements_read" on public.employee_announcements
  for select to authenticated
  using (true);

drop policy if exists "employee_announcements_write" on public.employee_announcements;
create policy "employee_announcements_write" on public.employee_announcements
  for all to authenticated
  using (public.current_is_full_access())
  with check (public.current_is_full_access());

drop policy if exists "system_backups_full" on public.system_backups;
create policy "system_backups_full" on public.system_backups
  for all to authenticated
  using (public.current_is_full_access())
  with check (public.current_is_full_access());

create index if not exists idx_report_schedules_active on public.report_schedules(is_active, frequency);
create index if not exists idx_employee_announcements_created_at on public.employee_announcements(created_at desc);
create index if not exists idx_system_backups_created_at on public.system_backups(created_at desc);


-- END PATCH: 017_completion_pack_tables.sql


-- =========================================================
-- BEGIN PATCH: 018_ahla_shabab_org_hierarchy.sql
-- =========================================================

-- =========================================================
-- 018 Ahla Shabab Organization Hierarchy
-- الهيكل الإداري حسب وصف الجمعية.
-- لا ينشئ حسابات Auth ولا كلمات مرور. الحسابات تنشأ من لوحة الإدارة/Edge Function.
-- =========================================================

create extension if not exists pgcrypto;

alter table if exists public.employees
  add column if not exists manager_employee_id uuid references public.employees(id) on delete set null;

alter table if exists public.departments
  add column if not exists manager_employee_id uuid references public.employees(id) on delete set null;

insert into public.departments (code, name, branch_id, manager_employee_id)
select d.code, d.name, b.id, null
from (values
  ('EXEC', 'الإدارة التنفيذية'),
  ('MGT', 'الإشراف والمديرون المباشرون'),
  ('OPS', 'فرق التشغيل والخدمات'),
  ('HR', 'الموارد البشرية')
) as d(code, name)
cross join public.branches b
where b.code = 'MAIN'
on conflict (code) do update set name = excluded.name, branch_id = excluded.branch_id;

with roster(employee_code, full_name, phone, email, job_title, role_slug, department_code, manager_code, hire_date) as (
  values
  ('EMP-001', 'المدير التنفيذي', 'PHONE_PLACEHOLDER_021', 'executive.director@organization.local', 'المدير التنفيذي', 'executive', 'EXEC', '', '2020-01-01'),
  ('EMP-002', 'السكرتير التنفيذي', 'PHONE_PLACEHOLDER_022', 'executive.secretary@organization.local', 'السكرتير التنفيذي', 'executive-secretary', 'EXEC', 'EMP-001', '2021-01-01'),
  ('EMP-003', 'مدير مباشر رابع', 'PHONE_PLACEHOLDER_023', 'direct.manager.04@organization.local', 'مدير مباشر', 'manager', 'MGT', 'EMP-001', '2021-02-01'),
  ('EMP-004', 'مدير مباشر أول', 'PHONE_PLACEHOLDER_024', 'direct.manager.01@organization.local', 'مدير مباشر', 'manager', 'MGT', 'EMP-001', '2021-02-01'),
  ('EMP-005', 'مدير مباشر ثانٍ', 'PHONE_PLACEHOLDER_025', 'direct.manager.02@organization.local', 'مدير مباشر', 'manager', 'MGT', 'EMP-001', '2021-02-01'),
  ('EMP-006', 'مدير مباشر ثالث', 'PHONE_PLACEHOLDER_026', 'direct.manager.03@organization.local', 'مدير مباشر', 'manager', 'MGT', 'EMP-001', '2021-02-01'),
  ('EMP-007', 'موظف تشغيلي 01', 'PHONE_PLACEHOLDER_027', 'employee.001@organization.local', 'مدير مباشر', 'manager', 'MGT', 'EMP-001', '2021-02-01'),
  ('EMP-008', 'موظف تشغيلي 18', 'PHONE_PLACEHOLDER_028', 'employee.017@organization.local', 'مدير مباشر', 'manager', 'MGT', 'EMP-001', '2021-02-01'),
  ('EMP-009', 'موظف تشغيلي 14', 'PHONE_PLACEHOLDER_029', 'direct.manager.07@organization.local', 'مدير مباشر', 'manager', 'MGT', 'EMP-001', '2021-02-01'),
  ('EMP-010', 'موظف تشغيلي 07', 'PHONE_PLACEHOLDER_030', 'employee.006@organization.local', 'موظف فريق مدير مباشر ثالث', 'employee', 'OPS', 'EMP-006', '2022-01-01'),
  ('EMP-011', 'موظف تشغيلي 08', 'PHONE_PLACEHOLDER_031', 'employee.007@organization.local', 'موظف فريق مدير مباشر ثالث', 'employee', 'OPS', 'EMP-006', '2022-01-01'),
  ('EMP-012', 'موظف تشغيلي 04', 'PHONE_PLACEHOLDER_032', 'direct.manager.08@organization.local', 'مشرف مباشر', 'manager', 'MGT', 'EMP-006', '2022-01-01'),
  ('EMP-013', 'موظف تشغيلي 05', 'PHONE_PLACEHOLDER_033', 'employee.004@organization.local', 'موظف تحت إشراف مباشر', 'employee', 'OPS', 'EMP-012', '2022-01-01'),
  ('EMP-014', 'موظف تشغيلي 13', 'PHONE_PLACEHOLDER_034', 'abdullah.hussein@ahla-shabab.local', 'موظف فريق مدير مباشر رابع', 'employee', 'OPS', 'EMP-003', '2022-01-01'),
  ('EMP-015', 'موظف تشغيلي 06', 'PHONE_PLACEHOLDER_035', 'employee.005@organization.local', 'موظف فريق مدير مباشر رابع', 'employee', 'OPS', 'EMP-003', '2022-01-01'),
  ('EMP-016', 'موظف تشغيلي 16', 'PHONE_PLACEHOLDER_036', 'employee.015@organization.local', 'موظف فريق المدير المباشر السابع', 'employee', 'OPS', 'EMP-009', '2022-01-01'),
  ('EMP-017', 'موظف تشغيلي 10', 'PHONE_PLACEHOLDER_037', 'employee.009@organization.local', 'موظف فريق المدير المباشر السابع', 'employee', 'OPS', 'EMP-009', '2022-01-01'),
  ('EMP-018', 'موظف تشغيلي 15', 'PHONE_PLACEHOLDER_038', 'employee.014@organization.local', 'موظف فريق المدير المباشر السابع', 'employee', 'OPS', 'EMP-009', '2022-01-01'),
  ('EMP-019', 'موظف تشغيلي 17', 'PHONE_PLACEHOLDER_039', 'employee.016@organization.local', 'موظف فريق المدير المباشر الأول', 'employee', 'OPS', 'EMP-004', '2022-01-01'),
  ('EMP-020', 'موظف تشغيلي 11', 'PHONE_PLACEHOLDER_040', 'employee.010@organization.local', 'موظف فريق موظف تشغيلي 18', 'employee', 'OPS', 'EMP-008', '2022-01-01'),
  ('EMP-021', 'موظف تشغيلي 12', 'PHONE_PLACEHOLDER_041', 'employee.011@organization.local', 'موظف فريق موظف تشغيلي 18', 'employee', 'OPS', 'EMP-008', '2022-01-01'),
  ('EMP-022', 'موظف تشغيلي 03', 'PHONE_PLACEHOLDER_042', 'employee.002@organization.local', 'موظف فريق موظف تشغيلي 18', 'employee', 'OPS', 'EMP-008', '2022-01-01'),
  ('EMP-023', 'موظف تشغيلي 09', 'PHONE_PLACEHOLDER_043', 'tarek.ibrahim@ahla-shabab.local', 'موظف فريق موظف تشغيلي 18', 'employee', 'OPS', 'EMP-008', '2022-01-01')
), upserted as (
  insert into public.employees (
    employee_code, full_name, phone, email, job_title, role_id, branch_id, department_id,
    governorate_id, complex_id, shift_id, status, is_active, is_deleted, hire_date
  )
  select
    r.employee_code,
    r.full_name,
    r.phone,
    r.email,
    r.job_title,
    (select id from public.roles where slug = r.role_slug limit 1),
    (select id from public.branches where code = 'MAIN' limit 1),
    (select id from public.departments where code = r.department_code limit 1),
    (select id from public.governorates where code = 'GZ' limit 1),
    (select id from public.complexes where code = 'AHLA-MANIL' limit 1),
    (select id from public.shifts order by name limit 1),
    'ACTIVE', true, false, r.hire_date::date
  from roster r
  on conflict (employee_code) do update set
    full_name = excluded.full_name,
    phone = excluded.phone,
    email = excluded.email,
    job_title = excluded.job_title,
    role_id = excluded.role_id,
    branch_id = excluded.branch_id,
    department_id = excluded.department_id,
    governorate_id = excluded.governorate_id,
    complex_id = excluded.complex_id,
    status = 'ACTIVE',
    is_active = true,
    is_deleted = false,
    hire_date = excluded.hire_date,
    updated_at = now()
  returning employee_code, id
), roster_again as (
  select * from roster
)
update public.employees e
set manager_employee_id = mgr.id,
    updated_at = now()
from roster_again r
left join public.employees mgr on mgr.employee_code = r.manager_code
where e.employee_code = r.employee_code;

update public.departments d set manager_employee_id = e.id
from public.employees e
where (d.code = 'EXEC' and e.employee_code = 'EMP-001')
   or (d.code = 'MGT' and e.employee_code = 'EMP-001')
   or (d.code = 'OPS' and e.employee_code = 'EMP-006')
   or (d.code = 'HR' and e.employee_code = 'EMP-002');

create or replace function public.can_access_employee(emp_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive team(id) as (
    select public.current_employee_id()
    union all
    select e.id
    from public.employees e
    join team t on e.manager_employee_id = t.id
    where coalesce(e.is_deleted, false) = false
  )
  select coalesce(
    public.current_is_full_access()
    or emp_id in (select id from team),
    false
  );
$$;

comment on function public.can_access_employee(uuid) is 'يعطي المدير صلاحية قراءة فريقه الكامل عبر كل المستويات الإدارية.';


-- END PATCH: 018_ahla_shabab_org_hierarchy.sql


-- =========================================================
-- BEGIN PATCH: 019_stability_passwords_disputes_requests.sql
-- =========================================================

-- =========================================================
-- 019 Stability Pack: request payload compatibility, dispute committee workflow,
-- and temporary-password reset support notes.
-- =========================================================

-- لجنة حل المشاكل والخلافات حسب الهيكل الإداري:
-- مدير مباشر ثالث + مدير مباشر ثانٍ + مدير مباشر أول + السكرتير التنفيذي + المدير التنفيذي.
-- يتم إرسال الإشعارات من التطبيق عند إنشاء dispute_cases، وهذا الـ patch يضيف حقولًا مساعدة إن لم تكن موجودة.

alter table if exists public.dispute_cases
  add column if not exists assigned_committee_employee_ids uuid[] default '{}',
  add column if not exists escalation_path text default 'اللجنة ← السكرتير التنفيذي ← المدير التنفيذي المدير التنفيذي',
  add column if not exists resolved_at timestamptz;

alter table if exists public.leave_requests
  add column if not exists workflow jsonb not null default '[]'::jsonb;

alter table if exists public.missions
  add column if not exists workflow jsonb not null default '[]'::jsonb;

-- توافق مع الواجهة عند إدخال طلبات الإجازة أو المأموريات من تطبيق الموظف.
create index if not exists idx_leave_requests_employee_status on public.leave_requests(employee_id, status);
create index if not exists idx_missions_employee_status on public.missions(employee_id, status);
create index if not exists idx_dispute_cases_employee_status on public.dispute_cases(employee_id, status);

-- ملاحظة أمان:
-- Supabase Auth لا يسمح بقراءة كلمات المرور الأصلية، وهذا صحيح أمنيًا.
-- خزنة كلمات المرور في الواجهة تعرض كلمات المرور المؤقتة في الوضع المحلي فقط،
-- أما في الإنتاج فيتم إصدار كلمة مؤقتة جديدة عبر Edge Function admin-update-user.


-- END PATCH: 019_stability_passwords_disputes_requests.sql


-- =========================================================
-- BEGIN PATCH: 020_full_operations_pack.sql
-- =========================================================

-- =========================================================
-- 020 Full Operations Pack
-- مهام داخلية + مستندات الموظفين + أرصدة الإجازات + قراءات الإعلانات
-- شغّل بعد 019_stability_passwords_disputes_requests.sql
-- =========================================================

create extension if not exists pgcrypto;

insert into public.permissions (scope, name) values
  ('tasks:manage', 'إدارة المهام الداخلية'),
  ('documents:manage', 'إدارة مستندات الموظفين'),
  ('leave:balance', 'إدارة أرصدة الإجازات'),
  ('announcements:manage', 'إدارة الإعلانات والقراءة'),
  ('executive:report', 'التقرير التنفيذي المختصر'),
  ('permissions:matrix', 'إدارة مصفوفة الصلاحيات'),
  ('tasks:self', 'متابعة مهامي'),
  ('documents:self', 'متابعة مستنداتي'),
  ('requests:self', 'متابعة طلباتي')
on conflict (scope) do update set name = excluded.name;

update public.roles
set permissions = array(select distinct unnest(coalesce(permissions, '{}') || array['tasks:self','documents:self','requests:self']))
where slug = 'employee';

update public.roles
set permissions = array['*']
where slug in ('admin','executive','executive-secretary','hr-manager');

create table if not exists public.leave_balances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  annual_total numeric not null default 21,
  casual_total numeric not null default 7,
  sick_total numeric not null default 15,
  used_days numeric not null default 0,
  remaining_days numeric not null default 28,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id)
);

create table if not exists public.employee_tasks (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  assigned_by_employee_id uuid references public.employees(id) on delete set null,
  title text not null,
  description text default '',
  priority text not null default 'MEDIUM',
  status text not null default 'OPEN',
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  title text not null,
  document_type text not null default 'OTHER',
  status text not null default 'ACTIVE',
  file_name text default '',
  file_url text default '',
  expires_on date,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.announcement_reads (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references public.notifications(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete cascade,
  read_at timestamptz not null default now(),
  unique(notification_id, employee_id)
);

create table if not exists public.policy_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  policy_key text not null,
  policy_title text not null,
  acknowledged_at timestamptz not null default now(),
  unique(employee_id, policy_key)
);

create index if not exists idx_leave_balances_employee on public.leave_balances(employee_id);
create index if not exists idx_employee_tasks_employee_status on public.employee_tasks(employee_id, status);
create index if not exists idx_employee_tasks_due on public.employee_tasks(due_date);
create index if not exists idx_employee_documents_employee on public.employee_documents(employee_id);
create index if not exists idx_employee_documents_expiry on public.employee_documents(expires_on);

alter table public.leave_balances enable row level security;
alter table public.employee_tasks enable row level security;
alter table public.employee_documents enable row level security;
alter table public.announcement_reads enable row level security;
alter table public.policy_acknowledgements enable row level security;

-- Employee scoped policies
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leave_balances','employee_tasks','employee_documents','policy_acknowledgements'] LOOP
    EXECUTE format('drop policy if exists "%1$s_read_scope" on public.%1$I', t);
    EXECUTE format('drop policy if exists "%1$s_insert_scope" on public.%1$I', t);
    EXECUTE format('drop policy if exists "%1$s_update_scope" on public.%1$I', t);
    EXECUTE format('drop policy if exists "%1$s_delete_full" on public.%1$I', t);
    EXECUTE format('create policy "%1$s_read_scope" on public.%1$I for select to authenticated using (public.can_access_employee(employee_id) or public.current_is_full_access())', t);
    EXECUTE format('create policy "%1$s_insert_scope" on public.%1$I for insert to authenticated with check (public.current_is_full_access() or employee_id = public.current_employee_id() or public.has_permission(''tasks:manage'') or public.has_permission(''documents:manage'') or public.has_permission(''leave:balance''))', t);
    EXECUTE format('create policy "%1$s_update_scope" on public.%1$I for update to authenticated using (public.current_is_full_access() or public.can_access_employee(employee_id)) with check (public.current_is_full_access() or public.can_access_employee(employee_id))', t);
    EXECUTE format('create policy "%1$s_delete_full" on public.%1$I for delete to authenticated using (public.current_is_full_access())', t);
  END LOOP;
END $$;

drop policy if exists "announcement_reads_scope" on public.announcement_reads;
create policy "announcement_reads_scope" on public.announcement_reads for all to authenticated
using (public.current_is_full_access() or employee_id = public.current_employee_id())
with check (public.current_is_full_access() or employee_id = public.current_employee_id());

-- View used by executive reporting / BI tools
create or replace view public.v_employee_operations_summary as
select
  e.id as employee_id,
  e.full_name,
  e.status,
  e.manager_employee_id,
  coalesce(lb.remaining_days, 28) as leave_remaining_days,
  count(distinct t.id) filter (where t.status <> 'DONE') as open_tasks,
  count(distinct d.id) filter (where d.expires_on is not null and d.expires_on <= current_date + interval '30 days') as expiring_documents
from public.employees e
left join public.leave_balances lb on lb.employee_id = e.id
left join public.employee_tasks t on t.employee_id = e.id
left join public.employee_documents d on d.employee_id = e.id
group by e.id, e.full_name, e.status, e.manager_employee_id, lb.remaining_days;


-- END PATCH: 020_full_operations_pack.sql


-- =========================================================
-- BEGIN PATCH: 021_quality_workflow_policy_center.sql
-- =========================================================

-- =========================================================
-- 021 Quality / Workflow / Policy Center
-- Adds operational hardening tables for maintenance runs, SLA escalations,
-- employee policies, policy acknowledgements, and committee actions.
-- Safe to run more than once.
-- =========================================================

create extension if not exists pgcrypto;

create table if not exists public.employee_policies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'GENERAL',
  version text not null default '1.0',
  body text not null default '',
  requires_acknowledgement boolean not null default true,
  status text not null default 'ACTIVE' check (status in ('DRAFT','ACTIVE','ARCHIVED')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.policy_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.employee_policies(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  policy_version text,
  acknowledged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(policy_id, employee_id)
);

create table if not exists public.workflow_escalations (
  id uuid primary key default gen_random_uuid(),
  fingerprint text unique,
  source_kind text not null,
  source_id uuid,
  employee_id uuid references public.employees(id) on delete set null,
  target_employee_ids uuid[] not null default '{}',
  reason text not null default '',
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED','IGNORED')),
  created_by_user_id uuid references auth.users(id) on delete set null,
  closed_by_user_id uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.maintenance_runs (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Maintenance Run',
  before_score numeric,
  after_score numeric,
  repair jsonb not null default '{}'::jsonb,
  workflow jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.committee_actions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.dispute_cases(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  action_type text not null default 'NOTE',
  decision text not null default '',
  note text not null default '',
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_policy_ack_employee on public.policy_acknowledgements(employee_id);
create index if not exists idx_workflow_escalations_status on public.workflow_escalations(status, created_at desc);
create index if not exists idx_maintenance_runs_created on public.maintenance_runs(created_at desc);
create index if not exists idx_committee_actions_case on public.committee_actions(case_id, created_at desc);

alter table public.employee_policies enable row level security;
alter table public.policy_acknowledgements enable row level security;
alter table public.workflow_escalations enable row level security;
alter table public.maintenance_runs enable row level security;
alter table public.committee_actions enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_is_full_access();
$$;

drop policy if exists employee_policies_select on public.employee_policies;
create policy employee_policies_select on public.employee_policies
for select using (status <> 'ARCHIVED' or public.is_admin());

drop policy if exists employee_policies_admin_write on public.employee_policies;
create policy employee_policies_admin_write on public.employee_policies
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists policy_ack_select on public.policy_acknowledgements;
create policy policy_ack_select on public.policy_acknowledgements
for select using (public.is_admin() or employee_id = public.current_employee_id());

drop policy if exists policy_ack_insert_self on public.policy_acknowledgements;
create policy policy_ack_insert_self on public.policy_acknowledgements
for insert with check (public.is_admin() or employee_id = public.current_employee_id());

drop policy if exists policy_ack_update_admin on public.policy_acknowledgements;
create policy policy_ack_update_admin on public.policy_acknowledgements
for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists workflow_escalations_admin on public.workflow_escalations;
create policy workflow_escalations_admin on public.workflow_escalations
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists maintenance_runs_admin on public.maintenance_runs;
create policy maintenance_runs_admin on public.maintenance_runs
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists committee_actions_select on public.committee_actions;
create policy committee_actions_select on public.committee_actions
for select using (
  public.is_admin()
  or employee_id = public.current_employee_id()
  or exists (
    select 1 from public.dispute_cases dc
    where dc.id = committee_actions.case_id
      and dc.employee_id = public.current_employee_id()
  )
);

drop policy if exists committee_actions_insert_committee on public.committee_actions;
create policy committee_actions_insert_committee on public.committee_actions
for insert with check (public.is_admin() or employee_id = public.current_employee_id());

insert into public.employee_policies (id, title, category, version, body, requires_acknowledgement, status)
values
  ('00000000-0000-0000-0000-000000021001', 'سياسة الحضور والانصراف', 'ATTENDANCE', '1.0', 'الالتزام بتسجيل الحضور والانصراف من الموقع المعتمد، وأي بصمة خارج النطاق تحتاج مراجعة الإدارة.', true, 'ACTIVE'),
  ('00000000-0000-0000-0000-000000021002', 'سياسة لجنة حل المشاكل والخلافات', 'DISPUTES', '1.0', 'تُرفع الشكاوى إلى اللجنة المختصة، ويتم التنسيق أو التصعيد للمدير التنفيذي عبر السكرتير التنفيذي عند الحاجة.', true, 'ACTIVE'),
  ('00000000-0000-0000-0000-000000021003', 'سياسة حماية البيانات وكلمات المرور', 'SECURITY', '1.0', 'كلمات المرور المؤقتة لا تُشارك إلا مع صاحب الحساب، ويجب تغييرها بعد أول دخول. لا يتم تداول بيانات الموظفين خارج النظام.', true, 'ACTIVE')
on conflict (id) do update set
  title = excluded.title,
  category = excluded.category,
  version = excluded.version,
  body = excluded.body,
  requires_acknowledgement = excluded.requires_acknowledgement,
  status = excluded.status,
  updated_at = now();


-- END PATCH: 021_quality_workflow_policy_center.sql


-- =========================================================
-- BEGIN PATCH: 022_control_room_data_center_daily_reports.sql
-- =========================================================

-- =========================================================
-- 022 Control Room + Data Center + Daily Reports
-- Adds operational monitoring, smart alerts, safe import logs, and employee daily reports.
-- Run after 021_quality_workflow_policy_center.sql
-- =========================================================

create table if not exists public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete cascade,
  report_date date not null default current_date,
  achievements text not null default '',
  blockers text not null default '',
  tomorrow_plan text not null default '',
  support_needed text not null default '',
  mood text not null default 'NORMAL',
  status text not null default 'SUBMITTED',
  manager_comment text not null default '',
  reviewed_at timestamptz,
  reviewed_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, report_date)
);

create table if not exists public.smart_alerts (
  id uuid primary key default gen_random_uuid(),
  fingerprint text unique not null,
  severity text not null default 'MEDIUM',
  title text not null,
  body text not null default '',
  route text not null default 'quality-center',
  status text not null default 'OPEN',
  target_employee_ids uuid[] not null default '{}',
  resolution_note text not null default '',
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'json',
  employees_count int not null default 0,
  users_count int not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  created_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.approval_chains (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  current_step text not null default 'MANAGER',
  status text not null default 'PENDING',
  steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.system_runbooks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'GENERAL',
  steps jsonb not null default '[]'::jsonb,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.daily_reports enable row level security;
alter table public.smart_alerts enable row level security;
alter table public.import_batches enable row level security;
alter table public.approval_chains enable row level security;
alter table public.system_runbooks enable row level security;

create or replace function public.has_permission(user_id uuid, scope text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when scope = '*' then public.current_is_full_access()
    when user_id = auth.uid() then public.has_permission(scope)
    else false
  end;
$$;

do $$
begin
  create policy "daily_reports_self_or_admin" on public.daily_reports
    for all using (
      employee_id in (select employee_id from public.profiles where id = auth.uid())
      or public.has_permission(auth.uid(), 'daily-report:review')
      or public.has_permission(auth.uid(), '*')
    ) with check (
      employee_id in (select employee_id from public.profiles where id = auth.uid())
      or public.has_permission(auth.uid(), 'daily-report:review')
      or public.has_permission(auth.uid(), '*')
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "smart_alerts_admin" on public.smart_alerts
    for all using (public.has_permission(auth.uid(), 'alerts:manage') or public.has_permission(auth.uid(), 'control-room:view') or public.has_permission(auth.uid(), '*'))
    with check (public.has_permission(auth.uid(), 'alerts:manage') or public.has_permission(auth.uid(), '*'));
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "import_batches_admin" on public.import_batches
    for all using (public.has_permission(auth.uid(), 'data-center:manage') or public.has_permission(auth.uid(), '*'))
    with check (public.has_permission(auth.uid(), 'data-center:manage') or public.has_permission(auth.uid(), '*'));
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "approval_chains_admin" on public.approval_chains
    for all using (public.has_permission(auth.uid(), 'approvals:manage') or public.has_permission(auth.uid(), '*'))
    with check (public.has_permission(auth.uid(), 'approvals:manage') or public.has_permission(auth.uid(), '*'));
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "system_runbooks_admin_read" on public.system_runbooks
    for select using (public.has_permission(auth.uid(), 'settings:manage') or public.has_permission(auth.uid(), '*'));
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "system_runbooks_admin_write" on public.system_runbooks
    for all using (public.has_permission(auth.uid(), 'settings:manage') or public.has_permission(auth.uid(), '*'))
    with check (public.has_permission(auth.uid(), 'settings:manage') or public.has_permission(auth.uid(), '*'));
exception when duplicate_object then null;
end $$;

insert into public.system_runbooks (title, category, steps, status)
values ('تشغيل النظام أول مرة', 'PRODUCTION', '["تطبيق كل SQL patches", "نشر Edge Functions", "تفعيل supabase-config.js", "تشغيل Health Check", "تجربة دخول موظف وإدارة"]'::jsonb, 'ACTIVE')
on conflict do nothing;


-- END PATCH: 022_control_room_data_center_daily_reports.sql


-- =========================================================
-- BEGIN PATCH: 023_executive_mobile_gateway_live_location.sql
-- =========================================================

-- =========================================================
-- 023 Executive Mobile + Secure Gateway + Live Location Requests
-- Adds: live location request/response workflow, admin access logs,
-- executive view logs, and permissions used by the new UI pack.
-- =========================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------
-- Tables
-- ---------------------------------------------------------
create table if not exists public.live_location_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  requested_by_user_id uuid references auth.users(id) on delete set null,
  requested_by_employee_id uuid references public.employees(id) on delete set null,
  requested_by_name text,
  reason text not null default 'متابعة تنفيذية مباشرة',
  precision text not null default 'HIGH',
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','EXPIRED','CANCELLED')),
  expires_at timestamptz,
  responded_at timestamptz,
  response_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.live_location_responses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.live_location_requests(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  requested_by_user_id uuid references auth.users(id) on delete set null,
  status text not null check (status in ('APPROVED','REJECTED')),
  latitude double precision,
  longitude double precision,
  accuracy_meters numeric,
  captured_at timestamptz,
  responded_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_access_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_employee_id uuid references public.employees(id) on delete set null,
  action text not null,
  route text,
  result text,
  user_agent text,
  ip_address inet,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.executive_views (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_employee_id uuid references public.employees(id) on delete set null,
  employee_id uuid references public.employees(id) on delete set null,
  route text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_live_location_requests_employee on public.live_location_requests(employee_id, created_at desc);
create index if not exists idx_live_location_requests_status on public.live_location_requests(status, created_at desc);
create index if not exists idx_live_location_responses_employee on public.live_location_responses(employee_id, responded_at desc);
create index if not exists idx_admin_access_logs_actor on public.admin_access_logs(actor_user_id, created_at desc);
create index if not exists idx_executive_views_actor on public.executive_views(actor_user_id, created_at desc);

-- ---------------------------------------------------------
-- Permissions seed
-- ---------------------------------------------------------
insert into public.permissions (scope, name)
values
  ('executive:mobile', 'المتابعة التنفيذية من الموبايل'),
  ('live-location:request', 'طلب الموقع المباشر من الموظف'),
  ('live-location:respond', 'الرد على طلب الموقع المباشر'),
  ('admin-gateway:access', 'الدخول من بوابة التشغيل')
on conflict (scope) do update set name = excluded.name;

-- Give full-access roles access to the new scopes.
update public.roles
set permissions = (
  select array_agg(distinct p)
  from unnest(coalesce(permissions, '{}'::text[]) || array['executive:mobile','live-location:request','admin-gateway:access']::text[]) as p
)
where ('*' = any(coalesce(permissions, '{}'::text[])))
   or lower(coalesce(key, slug, name, '')) in ('admin','super-admin','super_admin','executive','executive-secretary','hr-manager')
   or coalesce(name,'') in ('مدير النظام','المدير التنفيذي','السكرتير التنفيذي','مدير موارد بشرية');

-- Employee role can respond to requests that target their own employee profile.
update public.roles
set permissions = (
  select array_agg(distinct p)
  from unnest(coalesce(permissions, '{}'::text[]) || array['attendance:self','location:self','live-location:respond']::text[]) as p
)
where lower(coalesce(key, slug, name, '')) in ('employee','role-employee')
   or coalesce(name,'') = 'موظف';

-- ---------------------------------------------------------
-- RLS
-- ---------------------------------------------------------
alter table public.live_location_requests enable row level security;
alter table public.live_location_responses enable row level security;
alter table public.admin_access_logs enable row level security;
alter table public.executive_views enable row level security;

drop policy if exists live_location_requests_select on public.live_location_requests;
create policy live_location_requests_select on public.live_location_requests
for select using (
  public.has_permission('live-location:request')
  or employee_id = public.current_employee_id()
  or requested_by_employee_id = public.current_employee_id()
);

drop policy if exists live_location_requests_insert on public.live_location_requests;
create policy live_location_requests_insert on public.live_location_requests
for insert with check (public.has_permission('live-location:request'));

drop policy if exists live_location_requests_update on public.live_location_requests;
create policy live_location_requests_update on public.live_location_requests
for update using (
  public.has_permission('live-location:request')
  or employee_id = public.current_employee_id()
) with check (
  public.has_permission('live-location:request')
  or employee_id = public.current_employee_id()
);

drop policy if exists live_location_responses_select on public.live_location_responses;
create policy live_location_responses_select on public.live_location_responses
for select using (
  public.has_permission('live-location:request')
  or employee_id = public.current_employee_id()
);

drop policy if exists live_location_responses_insert on public.live_location_responses;
create policy live_location_responses_insert on public.live_location_responses
for insert with check (employee_id = public.current_employee_id() or public.current_is_full_access());

drop policy if exists admin_access_logs_select on public.admin_access_logs;
create policy admin_access_logs_select on public.admin_access_logs
for select using (public.has_permission('audit:view') or public.has_permission('settings:manage'));

drop policy if exists admin_access_logs_insert on public.admin_access_logs;
create policy admin_access_logs_insert on public.admin_access_logs
for insert with check (auth.uid() is not null);

drop policy if exists executive_views_select on public.executive_views;
create policy executive_views_select on public.executive_views
for select using (public.has_permission('audit:view') or public.has_permission('executive:mobile'));

drop policy if exists executive_views_insert on public.executive_views;
create policy executive_views_insert on public.executive_views
for insert with check (public.has_permission('executive:mobile'));


-- END PATCH: 023_executive_mobile_gateway_live_location.sql


-- =========================================================
-- BEGIN PATCH: 024_sensitive_approvals_gateway_hardening.sql
-- =========================================================

-- =========================================================
-- 024 - Sensitive approvals + Executive presence hardening
-- Adds executive approval workflow for dangerous actions
-- and presence snapshot storage for mobile executive view.
-- =========================================================

create table if not exists public.sensitive_approvals (
  id uuid primary key default gen_random_uuid(),
  action_type text not null default 'SENSITIVE_ACTION',
  target_type text not null default 'system',
  target_id text,
  target_employee_id uuid references public.employees(id) on delete set null,
  title text not null default 'طلب اعتماد عملية حساسة',
  summary text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','EXECUTED','CANCELLED')),
  requested_by_user_id uuid references auth.users(id) on delete set null,
  requested_by_employee_id uuid references public.employees(id) on delete set null,
  requested_by_name text,
  requested_at timestamptz not null default now(),
  decided_by_user_id uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sensitive_approvals_status_idx on public.sensitive_approvals(status, created_at desc);
create index if not exists sensitive_approvals_target_employee_idx on public.sensitive_approvals(target_employee_id);

create table if not exists public.executive_presence_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null default current_date,
  counts jsonb not null default '{}'::jsonb,
  rows jsonb not null default '[]'::jsonb,
  generated_by_user_id uuid references auth.users(id) on delete set null,
  generated_at timestamptz not null default now()
);

create index if not exists executive_presence_snapshots_date_idx on public.executive_presence_snapshots(snapshot_date desc, generated_at desc);

alter table public.sensitive_approvals enable row level security;
alter table public.executive_presence_snapshots enable row level security;

do $$ begin
  create policy "sensitive approvals readable by admins"
  on public.sensitive_approvals for select
  using (
    exists (
      select 1 from public.profiles p
      left join public.roles r on r.id = p.role_id
      where p.id = auth.uid()
        and coalesce(r.key, r.slug, '') in ('ADMIN','EXECUTIVE','EXECUTIVE_SECRETARY','HR_MANAGER','admin','executive','executive-secretary','hr-manager')
    )
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "sensitive approvals insert by admins"
  on public.sensitive_approvals for insert
  with check (
    exists (
      select 1 from public.profiles p
      left join public.roles r on r.id = p.role_id
      where p.id = auth.uid()
        and coalesce(r.key, r.slug, '') in ('ADMIN','EXECUTIVE','EXECUTIVE_SECRETARY','HR_MANAGER','admin','executive','executive-secretary','hr-manager')
    )
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "sensitive approvals update by executive authority"
  on public.sensitive_approvals for update
  using (
    exists (
      select 1 from public.profiles p
      left join public.roles r on r.id = p.role_id
      where p.id = auth.uid()
        and coalesce(r.key, r.slug, '') in ('ADMIN','EXECUTIVE','EXECUTIVE_SECRETARY','admin','executive','executive-secretary')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      left join public.roles r on r.id = p.role_id
      where p.id = auth.uid()
        and coalesce(r.key, r.slug, '') in ('ADMIN','EXECUTIVE','EXECUTIVE_SECRETARY','admin','executive','executive-secretary')
    )
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "executive presence readable by executive authority"
  on public.executive_presence_snapshots for select
  using (
    exists (
      select 1 from public.profiles p
      left join public.roles r on r.id = p.role_id
      where p.id = auth.uid()
        and coalesce(r.key, r.slug, '') in ('ADMIN','EXECUTIVE','EXECUTIVE_SECRETARY','HR_MANAGER','admin','executive','executive-secretary','hr-manager')
    )
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "executive presence insert by executive authority"
  on public.executive_presence_snapshots for insert
  with check (
    exists (
      select 1 from public.profiles p
      left join public.roles r on r.id = p.role_id
      where p.id = auth.uid()
        and coalesce(r.key, r.slug, '') in ('ADMIN','EXECUTIVE','EXECUTIVE_SECRETARY','HR_MANAGER','admin','executive','executive-secretary','hr-manager')
    )
  );
exception when duplicate_object then null; end $$;

-- Optional permission seeds if your roles/permissions tables exist.
insert into public.permissions (scope, name)
select scope, name
from (values
  ('sensitive-actions:approve', 'اعتماد العمليات الحساسة'),
  ('sensitive-actions:request', 'طلب تنفيذ عملية حساسة'),
  ('executive:presence-map', 'عرض خريطة الحضور التنفيذية')
) as v(scope, name)
where exists (select 1 from information_schema.tables where table_schema='public' and table_name='permissions')
on conflict (scope) do nothing;


-- END PATCH: 024_sensitive_approvals_gateway_hardening.sql


-- =========================================================
-- BEGIN PATCH: 025_smart_attendance_executive_archive_backup.sql
-- =========================================================

-- =========================================================
-- 025 Smart Attendance + Executive PDF + Employee Archive + Auto Backup
-- Safe to run after patches 001-024.
-- =========================================================

create table if not exists public.attendance_rule_runs (
  id text primary key,
  run_date date not null default current_date,
  counts jsonb not null default '{}'::jsonb,
  alerts_created integer not null default 0,
  notifications_created integer not null default 0,
  created_by_user_id uuid null,
  created_at timestamptz not null default now()
);

create table if not exists public.end_of_day_reports (
  id text primary key,
  report_date date not null default current_date,
  period text not null default 'daily',
  title text not null,
  counts jsonb not null default '{}'::jsonb,
  totals jsonb not null default '{}'::jsonb,
  rows jsonb not null default '[]'::jsonb,
  created_by_user_id uuid null,
  created_at timestamptz not null default now()
);

create table if not exists public.auto_backup_runs (
  id text primary key,
  backup_id text null,
  reason text not null default 'scheduled',
  counts jsonb not null default '{}'::jsonb,
  status text not null default 'SUCCESS',
  created_by_user_id uuid null,
  created_at timestamptz not null default now()
);

create table if not exists public.database_migration_status (
  id text primary key,
  name text not null unique,
  status text not null default 'APPLIED',
  applied_by_user_id uuid null,
  applied_at timestamptz not null default now(),
  notes text null
);

alter table public.attendance_daily add column if not exists smart_status text;
alter table public.attendance_daily add column if not exists early_exit_minutes integer not null default 0;
alter table public.attendance_daily add column if not exists risk_flags jsonb not null default '[]'::jsonb;
alter table public.attendance_daily add column if not exists recommendation text;

alter table public.attendance_events add column if not exists review_note text;
alter table public.attendance_events add column if not exists review_decision text;
alter table public.attendance_events add column if not exists reviewed_by_user_id uuid null;
alter table public.attendance_events add column if not exists reviewed_at timestamptz null;

insert into public.permissions (scope, name)
values
  ('attendance:rules', 'إدارة قواعد الحضور الذكية'),
  ('attendance:smart', 'تشغيل تحليل الحضور الذكي'),
  ('employee:archive', 'عرض أرشيف الموظف الكامل'),
  ('manager:suite', 'لوحة المدير المباشر المتقدمة'),
  ('kpi:monthly', 'إدارة التقييم الشهري'),
  ('supabase:diagnostics', 'فحص إعداد Supabase'),
  ('database:migrations', 'متابعة تحديثات قاعدة البيانات'),
  ('backup:auto', 'إدارة النسخ الاحتياطي التلقائي'),
  ('action-center:self', 'صفحة مطلوب مني الآن للموظف')
on conflict (scope) do nothing;

create or replace function public.has_any_permission(scopes text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_is_full_access()
    or exists (
      select 1
      from unnest(public.current_role_permissions()) as p(scope)
      where p.scope = any(scopes)
    );
$$;

alter table public.attendance_rule_runs enable row level security;
alter table public.end_of_day_reports enable row level security;
alter table public.auto_backup_runs enable row level security;
alter table public.database_migration_status enable row level security;

drop policy if exists "attendance_rule_runs_admin" on public.attendance_rule_runs;
create policy "attendance_rule_runs_admin" on public.attendance_rule_runs for all using (public.has_any_permission(array['attendance:smart','attendance:rules','settings:manage'])) with check (public.has_any_permission(array['attendance:smart','attendance:rules','settings:manage']));

drop policy if exists "end_of_day_reports_admin" on public.end_of_day_reports;
create policy "end_of_day_reports_admin" on public.end_of_day_reports for all using (public.has_any_permission(array['executive:report','reports:export'])) with check (public.has_any_permission(array['executive:report','reports:export']));

drop policy if exists "auto_backup_runs_admin" on public.auto_backup_runs;
create policy "auto_backup_runs_admin" on public.auto_backup_runs for all using (public.has_any_permission(array['backup:auto','settings:manage'])) with check (public.has_any_permission(array['backup:auto','settings:manage']));

drop policy if exists "database_migration_status_admin" on public.database_migration_status;
create policy "database_migration_status_admin" on public.database_migration_status for all using (public.has_any_permission(array['database:migrations','settings:manage'])) with check (public.has_any_permission(array['database:migrations','settings:manage']));


-- END PATCH: 025_smart_attendance_executive_archive_backup.sql


-- =========================================================
-- BEGIN PATCH: 026_missing_functions_fix.sql
-- =========================================================

-- =========================================================
-- 026 - إصلاح الدوال المفقودة الحرجة
-- يصلح المشاكل التالية:
--   1. إضافة has_any_permission() المستخدمة في patch 025 ولم تكن موجودة.
--   2. إضافة resolve_login_identifier() المستخدمة في Edge Function.
--   3. إعادة تعريف policies الـ 4 في patch 025 بطريقة صحيحة.
--   4. إضافة دوال مساعدة إضافية للتحقق من الأدوار.
--   5. إضافة smart_alerts table (مذكورة في supabase-api.js لكن غير موجودة في schema).
-- آمن للتشغيل على قاعدة بيانات يعمل عليها 001-025.
-- =========================================================

-- =========================
-- 1) has_any_permission(scopes text[])
-- تتحقق إذا كان المستخدم لديه أي من الصلاحيات المعطاة.
-- =========================
create or replace function public.has_any_permission(scopes text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_is_full_access()
    or exists (
      select 1
      from unnest(public.current_role_permissions()) as p(scope)
      where p.scope = any(scopes)
    );
$$;

-- =========================
-- 2) resolve_login_identifier(login_identifier text)
-- تُرجع البريد الإلكتروني لموظف عبر رقم الهاتف أو البريد مباشرةً.
-- تُستخدم من Edge Function resolve-login-identifier.
-- مقيّدة بـ authenticated و service_role فقط (راجع patch 015).
-- =========================
create or replace function public.resolve_login_identifier(login_identifier text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  resolved_email text;
  normalized_phone text;
begin
  -- تطبيع رقم الهاتف المصري
  normalized_phone := regexp_replace(login_identifier, '[^0-9]', '', 'g');
  if length(normalized_phone) = 10 and left(normalized_phone, 1) = '1' then
    normalized_phone := '0' || normalized_phone;
  end if;

  -- 1) بحث في جدول employees
  select e.email into resolved_email
  from public.employees e
  where
    e.is_deleted = false
    and (
      lower(e.email) = lower(login_identifier)
      or e.phone = login_identifier
      or e.phone = normalized_phone
    )
  limit 1;

  if resolved_email is not null and resolved_email <> '' then
    return lower(trim(resolved_email));
  end if;

  -- 2) بحث في جدول profiles
  select p.email into resolved_email
  from public.profiles p
  where
    lower(p.email) = lower(login_identifier)
    or p.phone = login_identifier
    or p.phone = normalized_phone
  limit 1;

  return lower(trim(coalesce(resolved_email, '')));
end;
$$;

-- تقييد الوصول لـ resolve_login_identifier كما في patch 015
revoke all on function public.resolve_login_identifier(text) from public;
revoke execute on function public.resolve_login_identifier(text) from anon;
grant execute on function public.resolve_login_identifier(text) to authenticated;
grant execute on function public.resolve_login_identifier(text) to service_role;

-- =========================
-- 3) smart_alerts table
-- مذكورة في supabase-api.js (maybeTableRows("smart_alerts")) لكن غير موجودة في 001.
-- =========================
create table if not exists public.smart_alerts (
  id uuid primary key default gen_random_uuid(),
  fingerprint text unique not null,
  severity text not null default 'MEDIUM' check (severity in ('LOW','MEDIUM','HIGH','CRITICAL')),
  title text not null,
  body text not null default '',
  route text default '',
  status text not null default 'OPEN' check (status in ('OPEN','RESOLVED','DISMISSED')),
  resolution_note text,
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists smart_alerts_status_severity_idx on public.smart_alerts(status, severity, created_at desc);

alter table public.smart_alerts enable row level security;

drop policy if exists "smart_alerts_admin" on public.smart_alerts;
create policy "smart_alerts_admin" on public.smart_alerts
  for all to authenticated
  using (public.has_any_permission(array['control-room:view','settings:manage']))
  with check (public.has_any_permission(array['control-room:view','settings:manage']));

-- =========================
-- 4) daily_reports table
-- مذكورة في supabase-api.js لكن غير موجودة في 001.
-- =========================
create table if not exists public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  report_date date not null default current_date,
  achievements text not null default '',
  blockers text not null default '',
  tomorrow_plan text not null default '',
  support_needed text not null default '',
  mood text not null default 'NORMAL' check (mood in ('EXCELLENT','GOOD','NORMAL','BAD','CRITICAL')),
  status text not null default 'SUBMITTED' check (status in ('DRAFT','SUBMITTED','REVIEWED','APPROVED')),
  manager_comment text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, report_date)
);

create index if not exists daily_reports_employee_date_idx on public.daily_reports(employee_id, report_date desc);
create index if not exists daily_reports_date_status_idx on public.daily_reports(report_date desc, status);

alter table public.daily_reports enable row level security;

drop policy if exists "daily_reports_self_read" on public.daily_reports;
create policy "daily_reports_self_read" on public.daily_reports
  for select to authenticated
  using (
    public.current_is_full_access()
    or employee_id = public.current_employee_id()
  );

drop policy if exists "daily_reports_self_write" on public.daily_reports;
create policy "daily_reports_self_write" on public.daily_reports
  for all to authenticated
  using (
    public.current_is_full_access()
    or employee_id = public.current_employee_id()
  )
  with check (
    public.current_is_full_access()
    or employee_id = public.current_employee_id()
  );

-- audit trigger على daily_reports
drop trigger if exists audit_row_change_daily_reports on public.daily_reports;
create trigger audit_row_change_daily_reports
  after insert or update or delete on public.daily_reports
  for each row execute function public.audit_row_change();

-- updated_at trigger على daily_reports
drop trigger if exists set_updated_at_daily_reports on public.daily_reports;
create trigger set_updated_at_daily_reports
  before update on public.daily_reports
  for each row execute function public.set_updated_at();

-- =========================
-- 5) import_batches table
-- مذكورة في supabase-api.js (maybeTableRows("import_batches"))
-- =========================
create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  batch_type text not null default 'employees',
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','DONE','FAILED','PARTIAL')),
  total_rows integer not null default 0,
  processed_rows integer not null default 0,
  error_count integer not null default 0,
  result_summary jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.import_batches enable row level security;

drop policy if exists "import_batches_admin" on public.import_batches;
create policy "import_batches_admin" on public.import_batches
  for all to authenticated
  using (public.has_any_permission(array['data-center:manage','settings:manage']))
  with check (public.has_any_permission(array['data-center:manage','settings:manage']));

-- =========================
-- 6) system_backups table
-- مذكورة في supabase-api.js (maybeTableRows("system_backups"))
-- =========================
create table if not exists public.system_backups (
  id uuid primary key default gen_random_uuid(),
  backup_type text not null default 'full',
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','DONE','FAILED')),
  size_bytes bigint,
  storage_path text,
  notes text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.system_backups enable row level security;

drop policy if exists "system_backups_admin" on public.system_backups;
create policy "system_backups_admin" on public.system_backups
  for all to authenticated
  using (public.has_any_permission(array['backup:auto','settings:manage']))
  with check (public.has_any_permission(array['backup:auto','settings:manage']));

-- =========================
-- 7) إصلاح policies patch 025 التي استخدمت has_any_permission قبل تعريفها
-- نعيد إنشاءها بشكل آمن الآن
-- =========================
drop policy if exists "attendance_rule_runs_admin" on public.attendance_rule_runs;
create policy "attendance_rule_runs_admin" on public.attendance_rule_runs
  for all
  using (public.has_any_permission(array['attendance:smart','attendance:rules','settings:manage']))
  with check (public.has_any_permission(array['attendance:smart','attendance:rules','settings:manage']));

drop policy if exists "end_of_day_reports_admin" on public.end_of_day_reports;
create policy "end_of_day_reports_admin" on public.end_of_day_reports
  for all
  using (public.has_any_permission(array['executive:report','reports:export']))
  with check (public.has_any_permission(array['executive:report','reports:export']));

drop policy if exists "auto_backup_runs_admin" on public.auto_backup_runs;
create policy "auto_backup_runs_admin" on public.auto_backup_runs
  for all
  using (public.has_any_permission(array['backup:auto','settings:manage']))
  with check (public.has_any_permission(array['backup:auto','settings:manage']));

drop policy if exists "database_migration_status_admin" on public.database_migration_status;
create policy "database_migration_status_admin" on public.database_migration_status
  for all
  using (public.has_any_permission(array['database:migrations','settings:manage']))
  with check (public.has_any_permission(array['database:migrations','settings:manage']));

-- =========================
-- 8) إضافة permissions seed الجديدة للجداول الجديدة
-- =========================
insert into public.permissions (scope, name) values
  ('control-room:view',   'غرفة التحكم والتنبيهات الذكية'),
  ('data-center:manage',  'إدارة مركز البيانات والاستيراد'),
  ('daily-report:self',   'إرسال التقرير اليومي'),
  ('daily-report:review', 'مراجعة التقارير اليومية')
on conflict (scope) do update set name = excluded.name;

-- تسجيل هذا الـ patch في migration_status
insert into public.database_migration_status (id, name, status, notes)
values (
  gen_random_uuid()::text,
  '026_missing_functions_fix.sql',
  'APPLIED',
  'أضاف has_any_permission, resolve_login_identifier, smart_alerts, daily_reports, import_batches, system_backups'
)
on conflict (name) do update set status = 'APPLIED', applied_at = now();

-- نهاية patch 026


-- END PATCH: 026_missing_functions_fix.sql


-- =========================================================
-- BEGIN PATCH: 027_fix_executive_hierarchy_accounts.sql
-- =========================================================

-- =========================================================
-- 027 Fix Executive Hierarchy Accounts
-- Repairs the Ahla Shabab executive/manager tree in Supabase.
-- Safe to re-run. It does not delete rows; old duplicate roster rows are
-- marked inactive/deleted so they stop appearing in active operational views.
-- =========================================================

create extension if not exists pgcrypto;

alter table if exists public.employees
  add column if not exists manager_employee_id uuid references public.employees(id) on delete set null;

alter table if exists public.departments
  add column if not exists manager_employee_id uuid references public.employees(id) on delete set null;

-- Required roles and permissions.
insert into public.roles (slug, key, name, permissions, active)
values
  ('admin', 'ADMIN', 'مدير النظام', array['*']::text[], true),
  ('executive', 'EXECUTIVE', 'المدير التنفيذي', array['*']::text[], true),
  ('executive-secretary', 'EXECUTIVE_SECRETARY', 'السكرتير التنفيذي', array['*']::text[], true),
  ('hr-manager', 'HR_MANAGER', 'الموارد البشرية', array['*']::text[], true),
  ('manager', 'DIRECT_MANAGER', 'مدير مباشر', array['dashboard:view','employees:view','attendance:manage','requests:approve','kpi:team','reports:export','realtime:view','attendance:review']::text[], true),
  ('employee', 'EMPLOYEE', 'موظف', array['dashboard:view','attendance:self','kpi:self','disputes:create','location:self','requests:self','tasks:self']::text[], true)
on conflict (slug) do update set
  key = excluded.key,
  name = excluded.name,
  permissions = excluded.permissions,
  active = true,
  updated_at = now();

-- Stable departments for the organization tree.
insert into public.departments (code, name, branch_id, active)
select d.code, d.name, b.id, true
from (values
  ('EXEC', 'الإدارة التنفيذية'),
  ('MGT', 'الإشراف والمديرون المباشرون'),
  ('OPS', 'فرق التشغيل والخدمات'),
  ('HR', 'الموارد البشرية')
) as d(code, name)
cross join lateral (select id from public.branches order by created_at nulls last, id limit 1) b
on conflict (code) do update set
  name = excluded.name,
  branch_id = coalesce(public.departments.branch_id, excluded.branch_id),
  active = true,
  updated_at = now();

create temp table if not exists tmp_ahla_roster_027 (
  employee_code text primary key,
  full_name text not null,
  phone text,
  email text,
  job_title text,
  role_slug text not null,
  department_code text not null,
  manager_code text,
  hire_date date
) on commit drop;

truncate tmp_ahla_roster_027;

insert into tmp_ahla_roster_027 (employee_code, full_name, phone, email, job_title, role_slug, department_code, manager_code, hire_date)
values
  ('EMP-001', 'المدير التنفيذي', 'PHONE_PLACEHOLDER_021', 'executive.director@organization.local', 'المدير التنفيذي', 'executive', 'EXEC', null, '2020-01-01'),
  ('EMP-002', 'السكرتير التنفيذي', 'PHONE_PLACEHOLDER_022', 'executive.secretary@organization.local', 'السكرتير التنفيذي', 'executive-secretary', 'EXEC', 'EMP-001', '2021-01-01'),
  ('EMP-003', 'مدير مباشر رابع', 'PHONE_PLACEHOLDER_023', 'ahmed.mahgoob@ahla.local', 'مدير مباشر', 'manager', 'MGT', 'EMP-001', '2021-02-01'),
  ('EMP-004', 'مدير مباشر أول', 'PHONE_PLACEHOLDER_024', 'direct.manager.01@organization.local', 'مدير مباشر', 'manager', 'MGT', 'EMP-001', '2021-02-01'),
  ('EMP-005', 'مدير مباشر ثانٍ', 'PHONE_PLACEHOLDER_025', 'direct.manager.02@organization.local', 'مدير مباشر', 'manager', 'MGT', 'EMP-001', '2021-02-01'),
  ('EMP-006', 'مدير مباشر ثالث', 'PHONE_PLACEHOLDER_026', 'direct.manager.03@organization.local', 'مدير مباشر', 'manager', 'MGT', 'EMP-001', '2021-02-01'),
  ('EMP-007', 'موظف تشغيلي 01', 'PHONE_PLACEHOLDER_027', 'direct.manager.05@organization.local', 'مدير مباشر', 'manager', 'MGT', 'EMP-001', '2021-02-01'),
  ('EMP-008', 'موظف تشغيلي 18', 'PHONE_PLACEHOLDER_028', 'direct.manager.06@organization.local', 'مدير مباشر', 'manager', 'MGT', 'EMP-001', '2021-02-01'),
  ('EMP-009', 'موظف تشغيلي 14', 'PHONE_PLACEHOLDER_029', 'direct.manager.07@organization.local', 'مدير مباشر', 'manager', 'MGT', 'EMP-001', '2021-02-01'),
  ('EMP-010', 'موظف تشغيلي 07', 'PHONE_PLACEHOLDER_030', 'employee.006@organization.local', 'موظف فريق مدير مباشر ثالث', 'employee', 'OPS', 'EMP-006', '2022-01-01'),
  ('EMP-011', 'موظف تشغيلي 08', 'PHONE_PLACEHOLDER_031', 'employee.007@organization.local', 'موظف فريق مدير مباشر ثالث', 'employee', 'OPS', 'EMP-006', '2022-01-01'),
  ('EMP-012', 'موظف تشغيلي 04', 'PHONE_PLACEHOLDER_032', 'direct.manager.08@organization.local', 'مشرف مباشر', 'manager', 'MGT', 'EMP-006', '2022-01-01'),
  ('EMP-013', 'موظف تشغيلي 05', 'PHONE_PLACEHOLDER_033', 'employee.005@organization.local', 'موظف تحت إشراف مباشر', 'employee', 'OPS', 'EMP-012', '2022-01-01'),
  ('EMP-014', 'موظف تشغيلي 13', 'PHONE_PLACEHOLDER_034', 'abdullah.hussein@ahla.local', 'موظف فريق مدير مباشر رابع', 'employee', 'OPS', 'EMP-003', '2022-01-01'),
  ('EMP-015', 'موظف تشغيلي 06', 'PHONE_PLACEHOLDER_035', 'employee.006@organization.local', 'موظف فريق مدير مباشر رابع', 'employee', 'OPS', 'EMP-003', '2022-01-01'),
  ('EMP-016', 'موظف تشغيلي 16', 'PHONE_PLACEHOLDER_036', 'employee.016@organization.local', 'موظف فريق المدير المباشر السابع', 'employee', 'OPS', 'EMP-009', '2022-01-01'),
  ('EMP-017', 'موظف تشغيلي 10', 'PHONE_PLACEHOLDER_037', 'employee.010@organization.local', 'موظف فريق المدير المباشر السابع', 'employee', 'OPS', 'EMP-009', '2022-01-01'),
  ('EMP-018', 'موظف تشغيلي 15', 'PHONE_PLACEHOLDER_038', 'employee.015@organization.local', 'موظف فريق المدير المباشر السابع', 'employee', 'OPS', 'EMP-009', '2022-01-01'),
  ('EMP-019', 'موظف تشغيلي 17', 'PHONE_PLACEHOLDER_039', 'employee.017@organization.local', 'موظف فريق المدير المباشر الأول', 'employee', 'OPS', 'EMP-004', '2022-01-01'),
  ('EMP-020', 'موظف تشغيلي 11', 'PHONE_PLACEHOLDER_040', 'employee.011@organization.local', 'موظف فريق موظف تشغيلي 18', 'employee', 'OPS', 'EMP-008', '2022-01-01'),
  ('EMP-021', 'موظف تشغيلي 12', 'PHONE_PLACEHOLDER_041', 'employee.012@organization.local', 'موظف فريق موظف تشغيلي 18', 'employee', 'OPS', 'EMP-008', '2022-01-01'),
  ('EMP-022', 'موظف تشغيلي 03', 'PHONE_PLACEHOLDER_042', 'employee.003@organization.local', 'موظف فريق موظف تشغيلي 18', 'employee', 'OPS', 'EMP-008', '2022-01-01'),
  ('EMP-023', 'موظف تشغيلي 09', 'PHONE_PLACEHOLDER_043', 'tarek.ibrahim@ahla.local', 'موظف فريق موظف تشغيلي 18', 'employee', 'OPS', 'EMP-008', '2022-01-01');

-- Upsert the canonical roster.
insert into public.employees (
  employee_code, full_name, phone, email, job_title, role_id, branch_id, department_id,
  governorate_id, complex_id, shift_id, status, is_active, is_deleted, hire_date
)
select
  r.employee_code,
  r.full_name,
  r.phone,
  r.email,
  r.job_title,
  role.id,
  branch.id,
  dept.id,
  gov.id,
  complex.id,
  shift_row.id,
  'ACTIVE',
  true,
  false,
  r.hire_date
from tmp_ahla_roster_027 r
join public.roles role on role.slug = r.role_slug
left join public.departments dept on dept.code = r.department_code
left join lateral (select id from public.branches order by created_at nulls last, id limit 1) branch on true
left join lateral (select id from public.governorates order by created_at nulls last, id limit 1) gov on true
left join lateral (select id from public.complexes order by created_at nulls last, id limit 1) complex on true
left join lateral (select id from public.shifts order by created_at nulls last, id limit 1) shift_row on true
on conflict (employee_code) do update set
  full_name = excluded.full_name,
  phone = excluded.phone,
  email = excluded.email,
  job_title = excluded.job_title,
  role_id = excluded.role_id,
  branch_id = excluded.branch_id,
  department_id = excluded.department_id,
  governorate_id = excluded.governorate_id,
  complex_id = excluded.complex_id,
  shift_id = excluded.shift_id,
  status = 'ACTIVE',
  is_active = true,
  is_deleted = false,
  hire_date = excluded.hire_date,
  updated_at = now();

-- Manager tree.
update public.employees e
set manager_employee_id = manager.id,
    updated_at = now()
from tmp_ahla_roster_027 r
left join public.employees manager on manager.employee_code = r.manager_code
where e.employee_code = r.employee_code;

-- Hide duplicate active roster rows with the same names but non-canonical codes.
update public.employees e
set is_active = false,
    is_deleted = true,
    status = 'INACTIVE',
    updated_at = now()
from tmp_ahla_roster_027 r
where e.full_name = r.full_name
  and e.employee_code <> r.employee_code
  and coalesce(e.is_deleted, false) = false;

-- Current real Yihia login aliases should point to the secretary employee/profile.
update public.profiles p
set employee_id = emp.id,
    role_id = role.id,
    full_name = 'السكرتير التنفيذي',
    phone = coalesce(p.phone, emp.phone),
    branch_id = emp.branch_id,
    department_id = emp.department_id,
    governorate_id = emp.governorate_id,
    complex_id = emp.complex_id,
    status = 'ACTIVE',
    updated_at = now()
from public.employees emp
join public.roles role on role.slug = 'executive-secretary'
where emp.employee_code = 'EMP-002'
  and lower(p.email) in ('legacy.secretary.01@removed.local', 'legacy.secretary.02@removed.local', 'executive.secretary@organization.local');

update public.employees e
set user_id = p.id,
    updated_at = now()
from public.profiles p
where e.employee_code = 'EMP-002'
  and lower(p.email) = 'legacy.secretary.01@removed.local';

-- Create/repair Auth + Profile accounts for canonical roster rows when absent.
do $$
declare
  rec record;
  v_user_id uuid;
  v_employee_id uuid;
  v_temp_password text := 'ChangeMe_Ahla#2026!';
begin
  for rec in
    select r.*, e.id as employee_id, e.branch_id, e.department_id, e.governorate_id, e.complex_id, role.id as role_id
    from tmp_ahla_roster_027 r
    join public.employees e on e.employee_code = r.employee_code
    join public.roles role on role.slug = r.role_slug
  loop
    v_employee_id := rec.employee_id;

    select id into v_user_id
    from auth.users
    where lower(email) = lower(rec.email)
    limit 1;

    if v_user_id is null then
      v_user_id := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        confirmation_sent_at, raw_app_meta_data, raw_user_meta_data, created_at,
        updated_at, is_super_admin
      ) values (
        '00000000-0000-0000-0000-000000000000',
        v_user_id,
        'authenticated',
        'authenticated',
        rec.email,
        crypt(v_temp_password, gen_salt('bf')),
        now(),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', rec.full_name, 'role', rec.role_slug),
        now(),
        now(),
        false
      );
    else
      update auth.users
      set email_confirmed_at = coalesce(email_confirmed_at, now()),
          aud = 'authenticated',
          role = 'authenticated',
          banned_until = null,
          raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"provider":"email","providers":["email"]}'::jsonb,
          raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', rec.full_name, 'role', rec.role_slug),
          updated_at = now()
      where id = v_user_id;
    end if;

    if exists (select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'identities') then
      insert into auth.identities (
        id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(),
        v_user_id,
        v_user_id::text,
        jsonb_build_object('sub', v_user_id::text, 'email', rec.email, 'email_verified', true, 'phone_verified', false),
        'email',
        now(),
        now(),
        now()
      )
      on conflict (provider, provider_id) do update set
        user_id = excluded.user_id,
        identity_data = excluded.identity_data,
        updated_at = now();
    end if;

    update public.employees
    set user_id = v_user_id,
        updated_at = now()
    where id = v_employee_id
      and (user_id is null or employee_code in ('EMP-001','EMP-003','EMP-004','EMP-005','EMP-006','EMP-007','EMP-008','EMP-009','EMP-012'));

    insert into public.profiles (
      id, employee_id, email, phone, full_name, avatar_url, role_id, branch_id,
      department_id, governorate_id, complex_id, status, temporary_password,
      must_change_password, password_changed_at, created_at, updated_at
    ) values (
      v_user_id,
      v_employee_id,
      rec.email,
      rec.phone,
      rec.full_name,
      '',
      rec.role_id,
      rec.branch_id,
      rec.department_id,
      rec.governorate_id,
      rec.complex_id,
      'ACTIVE',
      true,
      true,
      null,
      now(),
      now()
    )
    on conflict (id) do update set
      employee_id = excluded.employee_id,
      email = excluded.email,
      phone = excluded.phone,
      full_name = excluded.full_name,
      role_id = excluded.role_id,
      branch_id = excluded.branch_id,
      department_id = excluded.department_id,
      governorate_id = excluded.governorate_id,
      complex_id = excluded.complex_id,
      status = 'ACTIVE',
      updated_at = now();
  end loop;
end $$;

-- Department managers.
update public.departments d
set manager_employee_id = e.id,
    updated_at = now()
from public.employees e
where (d.code = 'EXEC' and e.employee_code = 'EMP-001')
   or (d.code = 'MGT' and e.employee_code = 'EMP-001')
   or (d.code = 'OPS' and e.employee_code = 'EMP-006')
   or (d.code = 'HR' and e.employee_code = 'EMP-002');

-- Close old imported duplicates for old executive/secretary aliases, then attach
-- any remaining active orphan employee directly under the executive root.
with canonical as (
  select id from public.employees where employee_code in ('EMP-001','EMP-002')
)
update public.employees e
set is_active = false,
    is_deleted = true,
    status = 'INACTIVE',
    updated_at = now()
where e.id not in (select id from canonical)
  and coalesce(e.is_deleted, false) = false
  and (
    e.employee_code in ('EMP-192404E9','EMP-F9889BBE')
    or
    lower(coalesce(e.email, '')) in ('legacy.secretary.01@removed.local','legacy.secretary.02@removed.local')
    or e.full_name in ('اسم تنفيذي قديم','اسم سكرتارية قديم')
    or (e.full_name like '%السكرتير التنفيذي جمال%' and e.employee_code <> 'EMP-002')
    or (e.full_name like '%اسم تنفيذي قديم%' and e.employee_code <> 'EMP-001')
  );

with root as (
  select id from public.employees where employee_code = 'EMP-001'
)
update public.employees e
set manager_employee_id = root.id,
    updated_at = now()
from root
where e.employee_code <> 'EMP-001'
  and coalesce(e.is_deleted, false) = false
  and e.manager_employee_id is null;

-- Recursive hierarchy visibility for managers and full access users.
create or replace function public.can_access_employee(emp_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive team(id) as (
    select public.current_employee_id()
    union all
    select e.id
    from public.employees e
    join team t on e.manager_employee_id = t.id
    where coalesce(e.is_deleted, false) = false
  )
  select coalesce(
    public.current_is_full_access()
    or emp_id in (select id from team),
    false
  );
$$;

comment on function public.can_access_employee(uuid) is 'Allows a manager to read their full subordinate tree, plus full access roles.';

-- Verification result.
select
  e.employee_code,
  e.full_name,
  r.slug as role_slug,
  manager.employee_code as manager_code,
  manager.full_name as manager_name,
  e.email,
  e.user_id is not null as has_auth_user,
  coalesce(e.is_deleted, false) as is_deleted
from public.employees e
left join public.roles r on r.id = e.role_id
left join public.employees manager on manager.id = e.manager_employee_id
where e.employee_code in (select employee_code from tmp_ahla_roster_027)
order by e.employee_code;


-- END PATCH: 027_fix_executive_hierarchy_accounts.sql


-- =========================================================
-- BEGIN PATCH: 028_primary_admin_and_runtime_fixes.sql
-- =========================================================

-- =========================================================
-- 028 Primary Admin + Runtime Schema Fixes
-- Creates/repairs the requested primary admin account:
--   email: admin.production@ahla-shabab.local
--   password: set v_password locally before applying; do not commit real passwords.
-- Also adds runtime columns required by policy acknowledgement and
-- live-location response flows.
-- =========================================================

create extension if not exists pgcrypto;

alter table if exists public.policy_acknowledgements
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.live_location_requests
  add column if not exists responded_at timestamptz,
  add column if not exists response_note text default '';

insert into public.roles (slug, key, name, permissions, active)
values ('admin', 'ADMIN', 'Primary Admin', array['*']::text[], true)
on conflict (slug) do update set
  key = excluded.key,
  name = excluded.name,
  permissions = array['*']::text[],
  active = true,
  updated_at = now();

do $$
declare
  v_email text := 'admin.production@ahla-shabab.local';
  v_password text := 'CHANGE_THIS_PASSWORD_BEFORE_APPLYING';
  v_full_name text := 'Primary Admin';
  v_user_id uuid;
  v_employee_id uuid;
  v_role_id uuid;
  v_branch_id uuid;
begin
  select id into v_role_id from public.roles where slug = 'admin' limit 1;
  select id into v_branch_id from public.branches order by created_at nulls last limit 1;
  select id into v_user_id from auth.users where lower(email) = lower(v_email) limit 1;

  if v_user_id is null then
    v_user_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, invited_at, confirmation_sent_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      is_super_admin,
      email_change, confirmation_token, recovery_token,
      email_change_token_new, email_change_token_current,
      phone, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')),
      now(), now(), now(),
      jsonb_build_object('provider','email','providers',array['email']),
      jsonb_build_object('full_name',v_full_name,'role','admin'),
      now(), now(),
      false,
      '', '', '', '', '', null, '', '', ''
    );
  else
    update auth.users
      set email = v_email,
          encrypted_password = crypt(v_password, gen_salt('bf')),
          email_confirmed_at = coalesce(email_confirmed_at, now()),
          raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('provider','email','providers',array['email']),
          raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name',v_full_name,'role','admin'),
          updated_at = now()
    where id = v_user_id;
  end if;

  insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (
    v_user_id,
    v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    'email',
    v_user_id::text,
    now(),
    now(),
    now()
  )
  on conflict (provider, provider_id) do update set
    user_id = excluded.user_id,
    identity_data = excluded.identity_data,
    updated_at = now();

  select id into v_employee_id
  from public.employees
  where employee_code = 'ADMIN-MAIN' or lower(email) = lower(v_email)
  limit 1;

  if v_employee_id is null then
    v_employee_id := gen_random_uuid();
    insert into public.employees (
      id, user_id, employee_code, full_name, email, phone, job_title,
      branch_id, role_id, manager_employee_id, status, is_active,
      is_deleted, hire_date, created_at, updated_at
    ) values (
      v_employee_id, v_user_id, 'ADMIN-MAIN', v_full_name, v_email, '', 'Primary Admin',
      v_branch_id, v_role_id, null, 'active', true,
      false, current_date, now(), now()
    );
  else
    update public.employees
      set user_id = v_user_id,
          employee_code = 'ADMIN-MAIN',
          full_name = v_full_name,
          email = v_email,
          job_title = 'Primary Admin',
          branch_id = coalesce(branch_id, v_branch_id),
          role_id = v_role_id,
          manager_employee_id = null,
          status = 'active',
          is_active = true,
          is_deleted = false,
          updated_at = now()
    where id = v_employee_id;
  end if;

  insert into public.profiles (
    id, employee_id, role_id, email, full_name, branch_id, status,
    temporary_password, must_change_password, created_at, updated_at
  ) values (
    v_user_id, v_employee_id, v_role_id, v_email, v_full_name, v_branch_id, 'active',
    false, false, now(), now()
  )
  on conflict (id) do update set
    employee_id = excluded.employee_id,
    role_id = excluded.role_id,
    email = excluded.email,
    full_name = excluded.full_name,
    branch_id = coalesce(public.profiles.branch_id, excluded.branch_id),
    status = 'active',
    temporary_password = false,
    must_change_password = false,
    updated_at = now();
end $$;

alter table if exists public.admin_access_logs enable row level security;

do $$
begin
  if to_regclass('public.admin_access_logs') is not null then
    drop policy if exists admin_access_logs_full_access_select on public.admin_access_logs;
    drop policy if exists admin_access_logs_full_access_insert on public.admin_access_logs;

    create policy admin_access_logs_full_access_select
      on public.admin_access_logs
      for select
      using (public.current_is_full_access());

    create policy admin_access_logs_full_access_insert
      on public.admin_access_logs
      for insert
      with check (public.current_is_full_access());
  end if;
end $$;


-- END PATCH: 028_primary_admin_and_runtime_fixes.sql


-- =========================================================
-- BEGIN PATCH: 029_employee_photos.sql
-- =========================================================

-- =========================================================
-- 029_employee_photos.sql
-- Production hardening note:
-- Employee face photos are no longer bundled inside the web package.
-- Upload real photos to Supabase Storage bucket `avatars` and save signed/public URLs
-- through the app instead of shipping personal images with the frontend.
-- This migration is intentionally safe/no-op for fresh production installs.
-- =========================================================

alter table if exists public.employees add column if not exists photo_url text;
alter table if exists public.profiles add column if not exists avatar_url text;

-- Remove old packaged-image references if a previous build inserted them.
update public.employees
set photo_url = null
where photo_url like '%/shared/images/employees/%';

update public.profiles
set avatar_url = null
where avatar_url like '%/shared/images/employees/%';


-- END PATCH: 029_employee_photos.sql


-- =========================================================
-- BEGIN PATCH: 030a_executive_role_separation_ui_polish.sql
-- =========================================================

-- =========================================================
-- 030 Executive Role Separation + UI Polish Alignment
-- Purpose:
--   - Stop treating EXECUTIVE / EXECUTIVE_SECRETARY as full admin roles.
--   - Keep ADMIN / HR_MANAGER with full operational permissions.
--   - Give the executive portal only the permissions it needs for monitoring,
--     approvals, reports, and live-location requests.
-- Run after: 029_employee_photos.sql
-- =========================================================

update public.roles
set permissions = array['*']::text[],
    updated_at = now()
where slug in ('admin', 'hr-manager')
   or key in ('ADMIN', 'HR_MANAGER');

update public.roles
set permissions = array[
    'dashboard:view',
    'employees:view',
    'reports:export',
    'executive:report',
    'executive:mobile',
    'executive:presence-map',
    'live-location:request',
    'sensitive-actions:approve',
    'approvals:manage',
    'alerts:manage',
    'control-room:view',
    'daily-report:review'
  ]::text[],
  description = coalesce(nullif(description, ''), 'متابعة تنفيذية وقرارات حساسة بدون أدوات الأدمن التقنية'),
  updated_at = now()
where slug = 'executive' or key = 'EXECUTIVE';

update public.roles
set permissions = array[
    'dashboard:view',
    'employees:view',
    'reports:export',
    'executive:report',
    'executive:mobile',
    'executive:presence-map',
    'live-location:request',
    'sensitive-actions:request',
    'daily-report:review',
    'alerts:manage'
  ]::text[],
  description = coalesce(nullif(description, ''), 'متابعة تنفيذية وتجهيز تقارير وطلب موقع بدون حذف أو إعدادات تقنية'),
  updated_at = now()
where slug = 'executive-secretary' or key = 'EXECUTIVE_SECRETARY';

-- Safety audit marker for environments that track audit_log/audit_logs.
do $$
begin
  if to_regclass('public.audit_log') is not null then
    insert into public.audit_log (action, entity_type, entity_id, metadata, created_at)
    values ('roles.executive_separation', 'role', '030_executive_role_separation_ui_polish', jsonb_build_object('patch','030'), now());
  elsif to_regclass('public.audit_logs') is not null then
    insert into public.audit_logs (action, entity_type, entity_id, metadata, created_at)
    values ('roles.executive_separation', 'role', '030_executive_role_separation_ui_polish', jsonb_build_object('patch','030'), now());
  end if;
exception when others then
  null;
end $$;


-- END PATCH: 030a_executive_role_separation_ui_polish.sql


-- =========================================================
-- BEGIN PATCH: 031b_web_guard_mobile_polish.sql
-- =========================================================

-- =========================================================
-- 031 Web Guard + Mobile Polish Alignment
-- Purpose:
--   - Keep executive and admin web entry separated after Patch 030.
--   - Remove any legacy direct '*' permissions from executive profiles if an older
--     schema stored profile-level permissions in addition to role permissions.
--   - Add an audit marker for the front-end scoped gateway/mobile dialog polish.
-- Run after: 030a_executive_role_separation_ui_polish.sql
-- =========================================================

-- Re-assert role permissions in case an older seed or manual edit reintroduced '*'.
update public.roles
set permissions = array[
    'dashboard:view',
    'employees:view',
    'reports:export',
    'executive:report',
    'executive:mobile',
    'executive:presence-map',
    'live-location:request',
    'sensitive-actions:approve',
    'approvals:manage',
    'alerts:manage',
    'control-room:view',
    'daily-report:review'
  ]::text[],
  updated_at = now()
where slug = 'executive' or key = 'EXECUTIVE';

update public.roles
set permissions = array[
    'dashboard:view',
    'employees:view',
    'reports:export',
    'executive:report',
    'executive:mobile',
    'executive:presence-map',
    'live-location:request',
    'sensitive-actions:request',
    'daily-report:review',
    'alerts:manage'
  ]::text[],
  updated_at = now()
where slug = 'executive-secretary' or key = 'EXECUTIVE_SECRETARY';

-- Some very old builds had profile-level permissions. Clean '*' safely if that
-- optional legacy column exists as jsonb, text[], or text.
do $$
declare
  perm_type text;
begin
  select data_type into perm_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'profiles'
    and column_name = 'permissions'
  limit 1;

  if perm_type = 'jsonb' then
    execute $sql$
      update public.profiles p
      set permissions = coalesce(permissions, '[]'::jsonb) - '*'
      where p.role_id in (select id from public.roles where slug in ('executive','executive-secretary'))
    $sql$;
  elsif perm_type = 'ARRAY' then
    execute $sql$
      update public.profiles p
      set permissions = array_remove(coalesce(permissions, '{}'::text[]), '*')
      where p.role_id in (select id from public.roles where slug in ('executive','executive-secretary'))
    $sql$;
  elsif perm_type = 'text' then
    execute $sql$
      update public.profiles p
      set permissions = replace(coalesce(permissions, ''), '*', '')
      where p.role_id in (select id from public.roles where slug in ('executive','executive-secretary'))
    $sql$;
  end if;
exception when others then
  null;
end $$;

-- Safety audit marker for environments that track audit_log/audit_logs.
do $$
begin
  if to_regclass('public.audit_log') is not null then
    insert into public.audit_log (action, entity_type, entity_id, metadata, created_at)
    values ('web.scoped_gateway_mobile_polish', 'system', '031_web_guard_mobile_polish', jsonb_build_object('patch','031'), now());
  elsif to_regclass('public.audit_logs') is not null then
    insert into public.audit_logs (action, entity_type, entity_id, metadata, created_at)
    values ('web.scoped_gateway_mobile_polish', 'system', '031_web_guard_mobile_polish', jsonb_build_object('patch','031'), now());
  end if;
exception when others then
  null;
end $$;


-- END PATCH: 031b_web_guard_mobile_polish.sql


-- =========================================================
-- BEGIN PATCH: 032b_pre_publish_role_portal_consistency.sql
-- =========================================================

-- =========================================================
-- 032 Pre-publish Role + Portal Consistency Guard
-- Purpose:
--   - Make executive / executive-secretary roles safe even in environments
--     that ran older seeds or were manually edited.
--   - Ensure all executive portal scopes exist in permissions catalog.
--   - Remove accidental profile-level '*' permissions from executive profiles.
-- Run after: 031b_web_guard_mobile_polish.sql
-- =========================================================

insert into public.permissions (scope, name) values
('executive:report','تقارير المدير التنفيذي'),
('executive:mobile','المتابعة التنفيذية المختصرة'),
('executive:presence-map','خريطة التواجد التنفيذية'),
('live-location:request','طلب موقع مباشر من موظف'),
('sensitive-actions:approve','اعتماد إجراءات حساسة'),
('sensitive-actions:request','طلب اعتماد إجراء حساس'),
('approvals:manage','إدارة الاعتمادات'),
('alerts:manage','إدارة التنبيهات'),
('control-room:view','عرض غرفة التحكم'),
('daily-report:review','مراجعة التقارير اليومية')
on conflict (scope) do update set name = excluded.name;

update public.roles
set permissions = array[
    'dashboard:view',
    'employees:view',
    'reports:export',
    'executive:report',
    'executive:mobile',
    'executive:presence-map',
    'live-location:request',
    'sensitive-actions:approve',
    'approvals:manage',
    'alerts:manage',
    'control-room:view',
    'daily-report:review'
  ]::text[],
  active = true,
  updated_at = now()
where slug = 'executive' or key = 'EXECUTIVE';

update public.roles
set permissions = array[
    'dashboard:view',
    'employees:view',
    'reports:export',
    'executive:report',
    'executive:mobile',
    'executive:presence-map',
    'live-location:request',
    'sensitive-actions:request',
    'daily-report:review',
    'alerts:manage'
  ]::text[],
  active = true,
  updated_at = now()
where slug = 'executive-secretary' or key = 'EXECUTIVE_SECRETARY';

-- Profile-level permissions are not part of the current schema, but some old
-- local/production builds added them. Remove '*' safely when the column exists.
do $$
declare
  perm_type text;
begin
  select data_type into perm_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'profiles'
    and column_name = 'permissions'
  limit 1;

  if perm_type = 'jsonb' then
    execute $sql$
      update public.profiles p
      set permissions = coalesce(permissions, '[]'::jsonb) - '*'
      where p.role_id in (select id from public.roles where slug in ('executive','executive-secretary'))
    $sql$;
  elsif perm_type = 'ARRAY' then
    execute $sql$
      update public.profiles p
      set permissions = array_remove(coalesce(permissions, '{}'::text[]), '*')
      where p.role_id in (select id from public.roles where slug in ('executive','executive-secretary'))
    $sql$;
  elsif perm_type = 'text' then
    execute $sql$
      update public.profiles p
      set permissions = regexp_replace(coalesce(permissions, ''), '(^|[,[:space:]])\*([,[:space:]]|$)', '\1', 'g')
      where p.role_id in (select id from public.roles where slug in ('executive','executive-secretary'))
    $sql$;
  end if;
exception when others then
  null;
end $$;

-- Optional audit marker for installations that already have audit tables.
do $$
begin
  if to_regclass('public.audit_log') is not null then
    insert into public.audit_log (action, entity_type, entity_id, metadata, created_at)
    values ('web.pre_publish_role_portal_consistency', 'system', '032_pre_publish_role_portal_consistency', jsonb_build_object('patch','032'), now());
  elsif to_regclass('public.audit_logs') is not null then
    insert into public.audit_logs (action, entity_type, entity_id, metadata, created_at)
    values ('web.pre_publish_role_portal_consistency', 'system', '032_pre_publish_role_portal_consistency', jsonb_build_object('patch','032'), now());
  end if;
exception when others then
  null;
end $$;


-- END PATCH: 032b_pre_publish_role_portal_consistency.sql


-- =========================================================
-- BEGIN PATCH: 033a_final_web_production_hardening.sql
-- =========================================================

-- =========================================================
-- 033a_final_web_production_hardening.sql
-- Final web production hardening before APK/PWA packaging.
-- Goals:
-- 1) Keep executive roles separate from full admin.
-- 2) Ensure no bundled employee-photo paths remain in DB.
-- 3) Make role permissions explicit for admin / HR / executive / employee.
-- 4) Add safe indexes for daily operational screens.
-- =========================================================

insert into public.permissions(scope, name, description) values
  ('executive:mobile', 'المتابعة التنفيذية المختصرة', 'فتح شاشة المدير التنفيذي المختصرة فقط'),
  ('live-location:request', 'طلب الموقع المباشر', 'إرسال طلب موقع مباشر للموظف'),
  ('users:manage', 'إدارة المستخدمين', 'إنشاء وتعديل حسابات المستخدمين'),
  ('settings:manage', 'إدارة إعدادات النظام', 'تعديل إعدادات النظام التقنية')
on conflict (scope) do update set
  name = excluded.name,
  description = excluded.description;

update public.roles
set permissions = array[
  '*'
]::text[]
where slug = 'admin';

update public.roles
set permissions = array[
  'employees:view', 'employees:manage', 'attendance:view', 'attendance:manage',
  'requests:view', 'requests:approve', 'reports:export', 'users:manage'
]::text[]
where slug in ('hr-manager', 'hr');

update public.roles
set permissions = array[
  'executive:mobile', 'employees:view', 'attendance:view', 'requests:view',
  'reports:export', 'live-location:request', 'sensitive:approve'
]::text[]
where slug = 'executive';

update public.roles
set permissions = array[
  'executive:mobile', 'employees:view', 'attendance:view', 'requests:view',
  'reports:export', 'live-location:request'
]::text[]
where slug = 'executive-secretary';

-- Explicitly remove accidental full-admin permission from non-admin executive roles.
update public.roles
set permissions = array_remove(permissions, '*')
where slug in ('executive', 'executive-secretary');

-- Remove old packaged-image references. Real photos should live in Supabase Storage.
alter table if exists public.employees add column if not exists photo_url text;
alter table if exists public.profiles add column if not exists avatar_url text;

update public.employees
set photo_url = null
where photo_url like '%/shared/images/employees/%';

update public.profiles
set avatar_url = null
where avatar_url like '%/shared/images/employees/%';

-- Helpful indexes for high-frequency web views. They are safe if tables already exist.
create index if not exists idx_attendance_events_employee_event_at on public.attendance_events(employee_id, event_at desc);
create index if not exists idx_live_location_requests_employee_status on public.live_location_requests(employee_id, status, created_at desc);
create index if not exists idx_leave_requests_employee_status on public.leave_requests(employee_id, status, created_at desc);
create index if not exists idx_profiles_role_status on public.profiles(role_id, status);



-- END PATCH: 033a_final_web_production_hardening.sql


-- =========================================================
-- BEGIN PATCH: 034a_final_lockdown_cleanup.sql
-- =========================================================

-- =========================================================
-- 034a_final_lockdown_cleanup.sql
-- Final lockdown cleanup for web production handoff.
-- Goals:
-- 1) Keep Demo/Training permission out of every non-admin role.
-- 2) Keep executive roles unable to reach technical/admin-only areas.
-- 3) Keep storage private where it contains attendance selfies or attachments.
-- 4) Add final app-version marker for auditability.
-- =========================================================

-- Admin may still own every permission through '*'. Non-admin roles must not carry demo/system permissions.
update public.roles
set permissions = array_remove(array_remove(array_remove(array_remove(coalesce(permissions, array[]::text[]), 'demo:manage'), 'settings:manage'), 'database:migrations'), 'backup:auto')
where slug <> 'admin';

-- Executive roles remain read/decision/mobile only; no hidden full-admin or users management.
update public.roles
set permissions = array[
  'executive:mobile', 'employees:view', 'attendance:view', 'requests:view',
  'reports:export', 'live-location:request', 'sensitive:approve'
]::text[]
where slug = 'executive';

update public.roles
set permissions = array[
  'executive:mobile', 'employees:view', 'attendance:view', 'requests:view',
  'reports:export', 'live-location:request'
]::text[]
where slug = 'executive-secretary';

-- Keep sensitive storage private. Avatars may remain public for browser display unless you choose signed URLs later.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('punch-selfies', 'punch-selfies', false, 3145728, array['image/png','image/jpeg','image/webp']),
  ('employee-attachments', 'employee-attachments', false, 8388608, null)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Tighten upload policies without breaking authenticated browser uploads.
drop policy if exists "selfies_upload_auth" on storage.objects;
create policy "selfies_upload_auth" on storage.objects
for insert to authenticated
with check (bucket_id = 'punch-selfies' and (owner = auth.uid() or owner is null));

drop policy if exists "attachments_upload_auth" on storage.objects;
create policy "attachments_upload_auth" on storage.objects
for insert to authenticated
with check (bucket_id = 'employee-attachments' and (owner = auth.uid() or owner is null));

drop policy if exists "attachments_update_owner_or_admin" on storage.objects;
create policy "attachments_update_owner_or_admin" on storage.objects
for update to authenticated
using (bucket_id = 'employee-attachments' and (owner = auth.uid() or public.current_is_full_access()))
with check (bucket_id = 'employee-attachments' and (owner = auth.uid() or public.current_is_full_access()));

drop policy if exists "attachments_delete_admin_only" on storage.objects;
create policy "attachments_delete_admin_only" on storage.objects
for delete to authenticated
using (bucket_id = 'employee-attachments' and public.current_is_full_access());

-- Store a final deployment marker in system settings when the table exists.
do $$
begin
  if to_regclass('public.system_settings') is not null then
    insert into public.system_settings(key, value, description)
    values ('web_production_version', '"1.2.2-kpi-cycle-control"'::jsonb, 'Final web production lockdown package version')
    on conflict (key) do update set value = excluded.value, description = excluded.description, updated_at = now();
  end if;
end $$;


-- END PATCH: 034a_final_lockdown_cleanup.sql


-- =========================================================
-- BEGIN PATCH: 035_final_sanitization_live_readiness.sql
-- =========================================================

-- =========================================================
-- 035_final_sanitization_live_readiness.sql
-- Final sanitization + live Supabase readiness.
-- - Remove training/demo permission from production roles.
-- - Sanitize remaining seeded/patched employee display names.
-- - Add Web Push subscription tables for real mobile/browser notifications.
-- =========================================================

-- 1) Production must not expose demo/training permission.
-- role_permissions existed in older drafts only; guard it so fresh installs do not fail.
do $$
begin
  if to_regclass('public.role_permissions') is not null then
    delete from public.role_permissions
    where permission_id in (select id from public.permissions where scope = 'demo:manage');
  end if;
end $$;

delete from public.permissions where scope = 'demo:manage';

update public.roles
set permissions = array_remove(coalesce(permissions, array[]::text[]), 'demo:manage')
where 'demo:manage' = any(coalesce(permissions, array[]::text[]));

-- 2) Keep seed names generic in packaged SQL/demo data.
update public.employees set full_name = 'المدير التنفيذي', email = 'executive.director@organization.local' where employee_code = 'EMP-001';
update public.employees set full_name = 'السكرتير التنفيذي', email = 'executive.secretary@organization.local' where employee_code = 'EMP-002';
update public.employees set full_name = 'مدير مباشر رابع', email = 'direct.manager.04@organization.local' where employee_code = 'EMP-003';
update public.employees set full_name = 'مدير مباشر أول', email = 'direct.manager.01@organization.local' where employee_code = 'EMP-004';
update public.employees set full_name = 'مدير مباشر ثانٍ', email = 'direct.manager.02@organization.local' where employee_code = 'EMP-005';
update public.employees set full_name = 'مدير مباشر ثالث', email = 'direct.manager.03@organization.local' where employee_code = 'EMP-006';

-- 3) Real Web Push readiness. The Edge Function that sends notifications
-- must use VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT secrets.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  endpoint text not null unique,
  payload jsonb not null default '{}'::jsonb,
  permission text not null default 'granted',
  created_at timestamptz not null default now()
);

-- Upgrade the original 001 table shape to the real Web Push shape used by the app/function.
alter table public.push_subscriptions
  add column if not exists employee_id uuid references public.employees(id) on delete cascade,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists keys jsonb not null default '{}'::jsonb,
  add column if not exists user_agent text,
  add column if not exists platform text,
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

update public.push_subscriptions
set keys = coalesce(nullif(keys, '{}'::jsonb), payload -> 'keys', '{}'::jsonb),
    updated_at = coalesce(updated_at, created_at, now());

create table if not exists public.notification_delivery_log (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid,
  push_subscription_id uuid references public.push_subscriptions(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'QUEUED',
  provider_response jsonb,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user on public.push_subscriptions(user_id) where is_active = true;
create index if not exists idx_push_subscriptions_employee on public.push_subscriptions(employee_id) where is_active = true;
create index if not exists idx_notification_delivery_log_status on public.notification_delivery_log(status, created_at desc);

alter table public.push_subscriptions enable row level security;
alter table public.notification_delivery_log enable row level security;

drop policy if exists "Users manage own push subscriptions" on public.push_subscriptions;
create policy "Users manage own push subscriptions"
  on public.push_subscriptions
  for all
  using (user_id = auth.uid() or exists (select 1 from public.profiles p join public.roles r on r.id = p.role_id where p.id = auth.uid() and r.slug in ('admin','hr-manager','executive-secretary')))
  with check (user_id = auth.uid() or exists (select 1 from public.profiles p join public.roles r on r.id = p.role_id where p.id = auth.uid() and r.slug in ('admin','hr-manager','executive-secretary')));

drop policy if exists "Admins view notification delivery log" on public.notification_delivery_log;
create policy "Admins view notification delivery log"
  on public.notification_delivery_log
  for select
  using (exists (select 1 from public.profiles p join public.roles r on r.id = p.role_id where p.id = auth.uid() and r.slug in ('admin','hr-manager','executive-secretary')));

-- 4) Mark package readiness in settings table when present.
do $$
begin
  if to_regclass('public.system_settings') is not null then
    insert into public.system_settings (key, value, description)
    values (
      'production.final_sanitized_version',
      '"1.2.2-kpi-cycle-control"'::jsonb,
      'Final sanitized package: generic seed data, production/development config split, and Web Push readiness.'
    )
    on conflict (key) do update set value = excluded.value, description = excluded.description, updated_at = now();
  end if;
end $$;


-- END PATCH: 035_final_sanitization_live_readiness.sql


-- =========================================================
-- BEGIN PATCH: 036_role_kpi_workflow_access.sql
-- =========================================================

-- =========================================================
-- 036_role_kpi_workflow_access.sql
-- Role + KPI workflow realignment for the web version.
-- Goals:
-- 1) Employee self-registration always creates employee-level accounts.
-- 2) Direct managers see only their teams and approve team KPI.
-- 3) HR sees HR-only tools, not technical/admin settings.
-- 4) Executive secretary / technical owner has full system access.
-- 5) KPI flows: employee -> direct manager -> HR -> executive secretary -> executive director.
-- 6) Dispute committee: executive secretary + operations manager 1 + operations manager 2 + HR.
-- =========================================================

-- 1) Permission catalog additions.
insert into public.permissions (scope, name)
values
  ('manager:team', 'متابعة الفريق المباشر فقط'),
  ('kpi:hr', 'إدخال تقييم الموارد البشرية'),
  ('kpi:final-approve', 'اعتماد النتيجة النهائية للتقييم'),
  ('kpi:executive', 'عرض واعتماد التقييمات التنفيذية'),
  ('disputes:committee', 'عضوية لجنة حل المشاكل والخلافات'),
  ('notifications:manage', 'إدارة إشعارات الموارد البشرية'),
  ('live-location:respond', 'الرد على طلب الموقع المباشر'),
  ('employee:self-register', 'تسجيل موظف ذاتيًا')
on conflict (scope) do update set name = excluded.name;

alter table if exists public.roles add column if not exists description text;
-- 2) Role permission alignment.
update public.roles
set permissions = array['*']::text[],
    name = 'السكرتير التنفيذي والتقني',
    description = 'صلاحيات كاملة على النظام مع متابعة تنفيذية وتقنية'
where slug in ('executive-secretary') or key = 'EXECUTIVE_SECRETARY';

update public.roles
set permissions = array[
  'dashboard:view', 'employees:view', 'employees:write', 'users:manage',
  'attendance:manage', 'attendance:review', 'attendance:rules', 'attendance:smart',
  'requests:approve', 'leave:balance', 'documents:manage', 'reports:export',
  'kpi:hr', 'kpi:monthly', 'kpi:manage', 'daily-report:review',
  'disputes:committee', 'disputes:manage', 'notifications:manage', 'policies:self'
]::text[],
    description = 'صلاحيات موارد بشرية فقط بدون إعدادات تقنية أو Supabase أو Backup'
where slug in ('hr-manager') or key = 'HR_MANAGER';

update public.roles
set permissions = array[
  'dashboard:view', 'employees:view', 'manager:team', 'manager:suite',
  'attendance:manage', 'requests:approve', 'reports:export', 'kpi:team',
  'daily-report:review', 'disputes:manage', 'realtime:view'
]::text[],
    description = 'يرى فريقه المباشر فقط ويعتمد تقييماتهم'
where slug in ('manager', 'direct-manager') or key in ('MANAGER', 'DIRECT_MANAGER');

update public.roles
set permissions = array[
  'dashboard:view', 'attendance:self', 'kpi:self', 'disputes:create',
  'location:self', 'tasks:self', 'documents:self', 'requests:self',
  'daily-report:self', 'action-center:self', 'live-location:respond',
  'policies:self'
]::text[]
where slug = 'employee' or key = 'EMPLOYEE';

update public.roles
set permissions = array[
  'dashboard:view', 'employees:view', 'reports:export', 'executive:report',
  'executive:mobile', 'executive:presence-map', 'live-location:request',
  'sensitive-actions:approve', 'approvals:manage', 'alerts:manage',
  'control-room:view', 'daily-report:review', 'kpi:executive', 'kpi:final-approve'
]::text[]
where slug = 'executive' or key = 'EXECUTIVE';

-- 3) Optional HR manager seed profile when the environment still has generic local seed data.
do $$
declare
  hr_role_id uuid;
  branch_id uuid;
  dept_id uuid;
  gov_id uuid;
  complex_id uuid;
  secretary_employee_id uuid;
begin
  if to_regclass('public.employees') is null then return; end if;
  select id into hr_role_id from public.roles where slug = 'hr-manager' limit 1;
  select id into branch_id from public.branches limit 1;
  select id into dept_id from public.departments where code = 'HR' limit 1;
  select id into gov_id from public.governorates limit 1;
  select id into complex_id from public.complexes limit 1;
  select id into secretary_employee_id from public.employees where email = 'executive.secretary@organization.local' limit 1;

  if hr_role_id is not null and not exists (select 1 from public.employees where email = 'hr.manager@organization.local') then
    insert into public.employees (full_name, employee_code, phone, email, job_title, role_id, branch_id, department_id, governorate_id, complex_id, manager_employee_id, status, hire_date)
    values ('مدير الموارد البشرية', 'EMP-HR', 'PHONE_PLACEHOLDER_044', 'hr.manager@organization.local', 'مدير الموارد البشرية', hr_role_id, branch_id, dept_id, gov_id, complex_id, secretary_employee_id, 'ACTIVE', current_date);
  end if;
end $$;

-- 4) KPI workflow columns for staged approvals.
do $$
begin
  if to_regclass('public.kpi_evaluations') is not null then
    alter table public.kpi_evaluations add column if not exists workflow jsonb not null default '[]'::jsonb;
    alter table public.kpi_evaluations add column if not exists hr_notes text;
    alter table public.kpi_evaluations add column if not exists secretary_notes text;
    alter table public.kpi_evaluations add column if not exists executive_notes text;
    alter table public.kpi_evaluations add column if not exists final_score numeric;
    alter table public.kpi_evaluations add column if not exists final_approved_at timestamptz;
  end if;
end $$;

-- 5) Employee self-registration request table for real backend/API implementations.
create table if not exists public.employee_self_registration_log (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  phone text,
  email text,
  assigned_role text not null default 'employee',
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now()
);

alter table public.employee_self_registration_log enable row level security;
drop policy if exists "admins_hr_view_self_registration_log" on public.employee_self_registration_log;
create policy "admins_hr_view_self_registration_log"
  on public.employee_self_registration_log
  for select
  using (exists (
    select 1 from public.profiles p 
    left join public.roles r on r.id = p.role_id 
    where p.id = auth.uid() and r.slug in ('admin','executive-secretary','hr-manager')
  ));

-- 6) Store version marker.
do $$
begin
  if to_regclass('public.system_settings') is not null then
    insert into public.system_settings(key, value)
    values ('web_role_kpi_workflow_version', '"1.2.2-kpi-cycle-control"'::jsonb)
    on conflict (key) do update set value = excluded.value;
  end if;
end $$;


-- END PATCH: 036_role_kpi_workflow_access.sql


-- =========================================================
-- BEGIN PATCH: 037_kpi_policy_window_hr_scoring.sql
-- =========================================================

-- =========================================================
-- 037 KPI Policy Window + HR-only scoring fields
-- تقييم الأداء الشهري: من يوم 20 إلى يوم 25
-- HR فقط: الحضور والانصراف، الصلاة في المسجد، حلقة الشيخ وليد يوسف الأسبوعية لتدريس القرآن والتجويد
-- =========================================================

alter table if exists public.kpi_evaluations
  add column if not exists meeting_held boolean default false,
  add column if not exists hr_notes text,
  add column if not exists submitted_to_manager_at timestamptz,
  add column if not exists manager_reviewed_at timestamptz,
  add column if not exists hr_reviewed_at timestamptz,
  add column if not exists secretary_reviewed_at timestamptz,
  add column if not exists executive_approved_at timestamptz;

create table if not exists public.kpi_policy (
  id text primary key default 'default',
  evaluation_start_day integer not null default 20 check (evaluation_start_day between 1 and 31),
  evaluation_end_day integer not null default 25 check (evaluation_end_day between 1 and 31),
  submission_deadline_day integer not null default 25 check (submission_deadline_day between 1 and 31),
  meeting_required boolean not null default true,
  total_score integer not null default 100,
  hr_only_codes text[] not null default array['ATTENDANCE_COMMITMENT','MOSQUE_PRAYER','QURAN_CIRCLE'],
  updated_at timestamptz not null default now()
);

insert into public.kpi_policy (
  id,
  evaluation_start_day,
  evaluation_end_day,
  submission_deadline_day,
  meeting_required,
  total_score,
  hr_only_codes
) values (
  'default',
  20,
  25,
  25,
  true,
  100,
  array['ATTENDANCE_COMMITMENT','MOSQUE_PRAYER','QURAN_CIRCLE']
)
on conflict (id) do update set
  evaluation_start_day = excluded.evaluation_start_day,
  evaluation_end_day = excluded.evaluation_end_day,
  submission_deadline_day = excluded.submission_deadline_day,
  meeting_required = excluded.meeting_required,
  total_score = excluded.total_score,
  hr_only_codes = excluded.hr_only_codes,
  updated_at = now();

-- مرجع معايير KPI الرسمي داخل قاعدة البيانات لمن يريد استخدامه في التقارير.
create table if not exists public.kpi_criteria_policy (
  code text primary key,
  name text not null,
  max_score numeric not null,
  scoring_owner text not null check (scoring_owner in ('employee_manager','hr_only')),
  sort_order integer not null
);

insert into public.kpi_criteria_policy (code, name, max_score, scoring_owner, sort_order) values
  ('TARGET', 'تحقيق الأهداف', 40, 'employee_manager', 1),
  ('TASK_EFFICIENCY', 'الكفاءة في أداء المهام', 20, 'employee_manager', 2),
  ('ATTENDANCE_COMMITMENT', 'الالتزام بمواعيد العمل حضورًا وانصرافًا', 20, 'hr_only', 3),
  ('CONDUCT', 'حسن التعامل والسلوك مع الزملاء والمديرين', 5, 'employee_manager', 4),
  ('MOSQUE_PRAYER', 'الالتزام بالصلاة في المسجد', 5, 'hr_only', 5),
  ('QURAN_CIRCLE', 'حضور حلقة الشيخ وليد يوسف الأسبوعية لتدريس القرآن والتجويد', 5, 'hr_only', 6),
  ('INITIATIVES_DONATIONS', 'المشاركة في التبرعات والمبادرات', 5, 'employee_manager', 7)
on conflict (code) do update set
  name = excluded.name,
  max_score = excluded.max_score,
  scoring_owner = excluded.scoring_owner,
  sort_order = excluded.sort_order;

-- تأكيد صلاحية اعتماد المدير التنفيذي النهائي للتقييمات.
update public.roles
set permissions = (
  select array_agg(distinct permission)
  from unnest(coalesce(permissions, '{}') || array['kpi:executive','kpi:final-approve']) as permission
)
where slug in ('executive') or key = 'EXECUTIVE';

-- تأكيد صلاحيات HR لمراجعة بنوده فقط، والمدير المباشر لبنود الفريق.
update public.roles
set permissions = (
  select array_agg(distinct permission)
  from unnest(coalesce(permissions, '{}') || array['kpi:hr','hr:attendance','employees:read']) as permission
)
where slug in ('hr-manager') or key = 'HR_MANAGER';

update public.roles
set permissions = (
  select array_agg(distinct permission)
  from unnest(coalesce(permissions, '{}') || array['kpi:team','team:read']) as permission
)
where slug in ('manager', 'direct-manager', 'operations-manager-1', 'operations-manager-2') or key in ('MANAGER', 'DIRECT_MANAGER');

comment on table public.kpi_policy is 'السياسة الرسمية لتقييم KPI: من يوم 20 إلى 25، آخر تسليم يوم 25، وإجمالي 100 درجة.';
comment on table public.kpi_criteria_policy is 'تعريف معايير KPI الرسمية وتحديد البنود الخاصة بـ HR فقط.';


-- END PATCH: 037_kpi_policy_window_hr_scoring.sql


-- =========================================================
-- BEGIN PATCH: 038_kpi_cycle_control_reports.sql
-- =========================================================

-- =========================================================
-- 038 KPI Cycle Control + Stage Reports
-- نسخة الويب: v1.2.2-kpi-cycle-control
-- الهدف:
-- 1) تثبيت نافذة التقييم من يوم 20 إلى 25.
-- 2) إضافة أعمدة إغلاق/قفل دورة KPI.
-- 3) إضافة View لمتابعة مراحل الاعتماد من الموظف حتى المدير التنفيذي.
-- 4) إضافة مؤشرات تنبيه للمتأخرين حسب المرحلة.
-- =========================================================

create table if not exists public.kpi_cycles (
  id text primary key,
  name text not null,
  starts_on date,
  ends_on date,
  due_on date,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.kpi_cycles
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by_user_id uuid,
  add column if not exists final_report_generated_at timestamptz,
  add column if not exists window_start_day int default 20,
  add column if not exists window_end_day int default 25,
  add column if not exists submission_deadline_day int default 25;

alter table if exists public.kpi_evaluations
  add column if not exists self_submitted_at timestamptz,
  add column if not exists manager_approved_at timestamptz,
  add column if not exists hr_reviewed_at timestamptz,
  add column if not exists secretary_reviewed_at timestamptz,
  add column if not exists executive_approved_at timestamptz,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by_user_id uuid,
  add column if not exists escalation_note text;

update public.kpi_cycles
set window_start_day = coalesce(window_start_day, 20),
    window_end_day = coalesce(window_end_day, 25),
    submission_deadline_day = coalesce(submission_deadline_day, 25)
where true;

update public.kpi_evaluations
set self_submitted_at = coalesce(self_submitted_at, submitted_at)
where status in ('SELF_SUBMITTED', 'MANAGER_APPROVED', 'HR_REVIEWED', 'SECRETARY_REVIEWED', 'EXECUTIVE_APPROVED', 'APPROVED')
  and self_submitted_at is null;

create or replace view public.kpi_cycle_stage_report as
select
  kc.id as cycle_id,
  kc.name as cycle_name,
  kc.starts_on,
  kc.ends_on,
  kc.due_on,
  kc.status as cycle_status,
  count(ke.id) as total_evaluations,
  count(*) filter (where ke.status = 'DRAFT') as draft_count,
  count(*) filter (where ke.status = 'SELF_SUBMITTED') as waiting_manager_count,
  count(*) filter (where ke.status = 'MANAGER_APPROVED') as waiting_hr_count,
  count(*) filter (where ke.status = 'HR_REVIEWED') as waiting_secretary_count,
  count(*) filter (where ke.status = 'SECRETARY_REVIEWED') as waiting_executive_count,
  count(*) filter (where ke.status in ('EXECUTIVE_APPROVED', 'APPROVED')) as final_approved_count,
  round(avg(ke.total_score)::numeric, 2) as average_score
from public.kpi_cycles kc
left join public.kpi_evaluations ke on ke.cycle_id = kc.id
group by kc.id, kc.name, kc.starts_on, kc.ends_on, kc.due_on, kc.status;

create or replace view public.kpi_employee_stage_report as
select
  ke.id,
  ke.cycle_id,
  ke.employee_id,
  e.full_name as employee_name,
  ke.manager_employee_id,
  m.full_name as manager_name,
  ke.status,
  case ke.status
    when 'DRAFT' then 'لم يبدأ'
    when 'SELF_SUBMITTED' then 'بانتظار المدير المباشر'
    when 'MANAGER_APPROVED' then 'بانتظار HR'
    when 'HR_REVIEWED' then 'بانتظار السكرتير التنفيذي'
    when 'SECRETARY_REVIEWED' then 'بانتظار المدير التنفيذي'
    when 'EXECUTIVE_APPROVED' then 'اعتماد نهائي'
    when 'APPROVED' then 'اعتماد نهائي'
    else coalesce(ke.status, 'مسودة')
  end as stage_label,
  ke.total_score,
  ke.grade,
  ke.rating,
  ke.self_submitted_at,
  ke.manager_approved_at,
  ke.hr_reviewed_at,
  ke.secretary_reviewed_at,
  ke.executive_approved_at,
  ke.locked_at
from public.kpi_evaluations ke
left join public.employees e on e.id = ke.employee_id
left join public.employees m on m.id = ke.manager_employee_id;

do $$
begin
  if to_regclass('public.settings') is not null then
    insert into public.settings (key, value)
    values
      ('web_production_version', '"1.2.2-kpi-cycle-control"'::jsonb),
      ('kpi_cycle_control_patch', '"038_kpi_cycle_control_reports.sql"'::jsonb)
    on conflict (key) do update set value = excluded.value;
  elsif to_regclass('public.system_settings') is not null then
    insert into public.system_settings (key, value)
    values
      ('web_production_version', '"1.2.2-kpi-cycle-control"'::jsonb),
      ('kpi_cycle_control_patch', '"038_kpi_cycle_control_reports.sql"'::jsonb)
    on conflict (key) do update set value = excluded.value;
  end if;
end $$;

-- ملاحظة: منع إرسال الموظف/المدير خارج نافذة 20-25 مطبق في طبقة الويب،
-- وعند الإنتاج يمكن إضافة RPC/Trigger صارم إذا رغبت في منع أي كتابة مباشرة من خارج الواجهة.


-- END PATCH: 038_kpi_cycle_control_reports.sql


-- =========================================================
-- BEGIN PATCH: 039_management_hr_reports_workflow.sql
-- =========================================================

-- =========================================================
-- 039 Management Structure + HR Operations + Reports Workflow
-- نسخة الويب: v1.3.0-management-hr-reports
-- الهدف:
-- 1) تثبيت صلاحيات هيكل الإدارة والفرق.
-- 2) إضافة مسار واضح للمدير المباشر وعمليات HR.
-- 3) تقوية Workflow الشكاوى والتصعيد.
-- 4) تجهيز Views للتقارير والتصدير.
-- =========================================================

insert into public.permissions (scope, name)
values
  ('organization:manage', 'إدارة هيكل الإدارة والفرق'),
  ('team:dashboard', 'لوحة الفريق للمدير المباشر'),
  ('hr:operations', 'لوحة عمليات الموارد البشرية'),
  ('disputes:escalate', 'تصعيد الشكاوى للسكرتير والتنفيذي'),
  ('reports:pdf', 'تصدير تقارير PDF/HTML'),
  ('reports:excel', 'تصدير تقارير Excel/CSV')
on conflict (scope) do update set name = excluded.name;

update public.roles
set permissions = array(select distinct unnest(coalesce(permissions, '{}') || array['organization:manage','team:dashboard','hr:operations','disputes:escalate','reports:pdf','reports:excel']))
where slug in ('admin', 'executive-secretary') or key in ('ADMIN', 'EXECUTIVE_SECRETARY');

update public.roles
set permissions = array(select distinct unnest(coalesce(permissions, '{}') || array['hr:operations','team:dashboard','disputes:escalate','reports:pdf','reports:excel']))
where slug = 'hr-manager' or key = 'HR_MANAGER';

update public.roles
set permissions = array(select distinct unnest(coalesce(permissions, '{}') || array['team:dashboard','disputes:escalate','reports:pdf','reports:excel']))
where slug in ('manager', 'direct-manager') or key in ('MANAGER', 'DIRECT_MANAGER');

update public.roles
set permissions = array(select distinct unnest(coalesce(permissions, '{}') || array['reports:pdf','reports:excel','disputes:escalate']))
where slug = 'executive' or key = 'EXECUTIVE';

alter table if exists public.employees
  add column if not exists manager_assigned_at timestamptz,
  add column if not exists manager_assignment_note text;

alter table if exists public.dispute_cases
  add column if not exists current_stage text default 'manager_review',
  add column if not exists assigned_committee_employee_ids uuid[] default '{}',
  add column if not exists secretary_reviewed_at timestamptz,
  add column if not exists executive_decision_at timestamptz,
  add column if not exists escalation_reason text;

create or replace view public.management_team_report as
select
  manager.id as manager_employee_id,
  manager.full_name as manager_name,
  manager.job_title as manager_job_title,
  count(team.id) as team_count,
  count(team.id) filter (where team.status = 'ACTIVE') as active_team_count,
  count(team.id) filter (where team.manager_employee_id is null) as missing_manager_count
from public.employees manager
left join public.roles r on r.id = manager.role_id
left join public.employees team on team.manager_employee_id = manager.id and coalesce(team.is_deleted, false) = false
where coalesce(manager.is_deleted, false) = false
  and r.slug in ('manager', 'direct-manager', 'hr-manager', 'executive', 'executive-secretary', 'admin')
group by manager.id, manager.full_name, manager.job_title;

create or replace view public.hr_operations_report as
select
  e.id as employee_id,
  e.full_name as employee_name,
  e.job_title,
  e.status,
  e.manager_employee_id,
  m.full_name as manager_name,
  case when e.manager_employee_id is null and r.slug = 'employee' then true else false end as missing_manager,
  case when e.phone is null or e.phone = '' then true else false end as missing_phone,
  case when e.email is null or e.email = '' then true else false end as missing_email
from public.employees e
left join public.employees m on m.id = e.manager_employee_id
left join public.roles r on r.id = e.role_id
where coalesce(e.is_deleted, false) = false;

create or replace view public.dispute_workflow_report as
select
  dc.id,
  dc.title,
  dc.employee_id,
  e.full_name as employee_name,
  dc.status,
  coalesce(dc.current_stage, dc.status, 'open') as current_stage,
  dc.severity as priority,
  dc.committee_decision,
  dc.escalated_to_executive,
  dc.created_at,
  dc.updated_at
from public.dispute_cases dc
left join public.employees e on e.id = dc.employee_id;

do $$
begin
  if to_regclass('public.settings') is not null then
    insert into public.settings (key, value)
    values
      ('web_production_version', '"1.3.0-management-hr-reports"'::jsonb),
      ('latest_required_patch', '"039_management_hr_reports_workflow.sql"'::jsonb)
    on conflict (key) do update set value = excluded.value;
  elsif to_regclass('public.system_settings') is not null then
    insert into public.system_settings (key, value)
    values
      ('web_production_version', '"1.3.0-management-hr-reports"'::jsonb),
      ('latest_required_patch', '"039_management_hr_reports_workflow.sql"'::jsonb)
    on conflict (key) do update set value = excluded.value;
  end if;
end $$;


-- END PATCH: 039_management_hr_reports_workflow.sql


-- =========================================================
-- BEGIN PATCH: 040_runtime_alignment_fix.sql
-- =========================================================

-- =========================================================
-- 040_runtime_alignment_fix.sql
-- Runtime alignment after management + HR reports package.
-- Fixes production blockers discovered in final smoke review:
-- - makes settings/system_settings available for version markers,
-- - upgrades push_subscriptions created by older schema versions,
-- - records migration status for the admin migration screen,
-- - adds indexes/views used by the Supabase web runtime,
-- - keeps role/profile checks based on role_id + roles.slug, not profiles.role.
-- =========================================================

create extension if not exists pgcrypto;

create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  description text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  description text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.database_migration_status (
  id text primary key default gen_random_uuid()::text,
  name text unique not null,
  status text not null default 'APPLIED',
  applied_at timestamptz not null default now(),
  applied_by_user_id uuid references auth.users(id),
  notes text not null default ''
);

alter table if exists public.roles
  add column if not exists description text default '';

-- Backward-compatible defaults/columns for operational runtime tables created by earlier patches.
alter table if exists public.database_migration_status
  alter column id set default gen_random_uuid()::text,
  add column if not exists applied_at timestamptz not null default now(),
  add column if not exists applied_by_user_id uuid,
  add column if not exists notes text not null default '';

alter table if exists public.attendance_rule_runs
  alter column id set default gen_random_uuid()::text,
  add column if not exists status text not null default 'COMPLETED',
  add column if not exists total_employees integer not null default 0,
  add column if not exists issues_count integer not null default 0,
  add column if not exists result jsonb not null default '{}'::jsonb;

alter table if exists public.system_backups
  add column if not exists title text,
  add column if not exists snapshot jsonb not null default '{}'::jsonb,
  add column if not exists status text not null default 'COMPLETED',
  add column if not exists name text,
  add column if not exists summary jsonb not null default '{}'::jsonb;

alter table if exists public.push_subscriptions
  add column if not exists employee_id uuid references public.employees(id) on delete cascade,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists keys jsonb not null default '{}'::jsonb,
  add column if not exists user_agent text,
  add column if not exists platform text,
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

update public.push_subscriptions
set keys = coalesce(nullif(keys, '{}'::jsonb), payload -> 'keys', '{}'::jsonb),
    updated_at = coalesce(updated_at, created_at, now())
where to_regclass('public.push_subscriptions') is not null;

create table if not exists public.notification_delivery_log (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references public.notifications(id) on delete set null,
  push_subscription_id uuid references public.push_subscriptions(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'QUEUED',
  provider_response jsonb,
  error text,
  created_at timestamptz not null default now()
);

alter table public.system_settings enable row level security;
alter table public.settings enable row level security;
alter table public.database_migration_status enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_delivery_log enable row level security;

drop policy if exists "system_settings_read_admin" on public.system_settings;
create policy "system_settings_read_admin" on public.system_settings
  for select to authenticated
  using (public.current_is_full_access() or public.has_any_permission(array['settings:manage','database:migrations']));

drop policy if exists "system_settings_write_admin" on public.system_settings;
create policy "system_settings_write_admin" on public.system_settings
  for all to authenticated
  using (public.current_is_full_access() or public.has_any_permission(array['settings:manage','database:migrations']))
  with check (public.current_is_full_access() or public.has_any_permission(array['settings:manage','database:migrations']));

drop policy if exists "settings_read_admin" on public.settings;
create policy "settings_read_admin" on public.settings
  for select to authenticated
  using (public.current_is_full_access() or public.has_any_permission(array['settings:manage','database:migrations']));

drop policy if exists "settings_write_admin" on public.settings;
create policy "settings_write_admin" on public.settings
  for all to authenticated
  using (public.current_is_full_access() or public.has_any_permission(array['settings:manage','database:migrations']))
  with check (public.current_is_full_access() or public.has_any_permission(array['settings:manage','database:migrations']));

drop policy if exists "database_migration_status_admin" on public.database_migration_status;
create policy "database_migration_status_admin" on public.database_migration_status
  for all to authenticated
  using (public.current_is_full_access() or public.has_any_permission(array['database:migrations','settings:manage']))
  with check (public.current_is_full_access() or public.has_any_permission(array['database:migrations','settings:manage']));

drop policy if exists "push_subscriptions_own_or_admin" on public.push_subscriptions;
create policy "push_subscriptions_own_or_admin" on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid() or employee_id = public.current_employee_id() or public.current_is_full_access() or public.has_any_permission(array['notifications:manage','alerts:manage']))
  with check (user_id = auth.uid() or employee_id = public.current_employee_id() or public.current_is_full_access() or public.has_any_permission(array['notifications:manage','alerts:manage']));

drop policy if exists "notification_delivery_log_admin" on public.notification_delivery_log;
create policy "notification_delivery_log_admin" on public.notification_delivery_log
  for select to authenticated
  using (public.current_is_full_access() or public.has_any_permission(array['notifications:manage','alerts:manage']));

create index if not exists idx_push_subscriptions_active_user on public.push_subscriptions(user_id) where is_active = true;
create index if not exists idx_push_subscriptions_active_employee on public.push_subscriptions(employee_id) where is_active = true;
create index if not exists idx_notifications_employee_created on public.notifications(employee_id, created_at desc);
create index if not exists idx_kpi_evaluations_cycle_status on public.kpi_evaluations(cycle_id, status);
create index if not exists idx_dispute_cases_status_updated on public.dispute_cases(status, updated_at desc);

insert into public.database_migration_status (name, status, notes)
values
  ('035_final_sanitization_live_readiness.sql', 'APPLIED', 'Runtime-aligned by patch 040'),
  ('036_role_kpi_workflow_access.sql', 'APPLIED', 'Runtime-aligned by patch 040'),
  ('037_kpi_policy_window_hr_scoring.sql', 'APPLIED', 'Runtime-aligned by patch 040'),
  ('038_kpi_cycle_control_reports.sql', 'APPLIED', 'Runtime-aligned by patch 040'),
  ('039_management_hr_reports_workflow.sql', 'APPLIED', 'Runtime-aligned by patch 040'),
  ('040_runtime_alignment_fix.sql', 'APPLIED', 'Final runtime alignment')
on conflict (name) do update set status = excluded.status, notes = excluded.notes, applied_at = now();

insert into public.system_settings (key, value, description)
values
  ('web_production_version', '"1.3.1-runtime-alignment"'::jsonb, 'Final production runtime alignment package'),
  ('latest_required_patch', '"040_runtime_alignment_fix.sql"'::jsonb, 'Latest required SQL patch for this package'),
  ('push_notifications_ready', 'true'::jsonb, 'push_subscriptions/notification_delivery_log schema aligned with Edge Function')
on conflict (key) do update set value = excluded.value, description = excluded.description, updated_at = now();

insert into public.settings (key, value, description)
values
  ('web_production_version', '"1.3.1-runtime-alignment"'::jsonb, 'Final production runtime alignment package'),
  ('latest_required_patch', '"040_runtime_alignment_fix.sql"'::jsonb, 'Latest required SQL patch for this package')
on conflict (key) do update set value = excluded.value, description = excluded.description, updated_at = now();

-- Keep the reporting views replaceable even when patch 039 was not applied cleanly before 040.
create or replace view public.management_team_report as
select
  manager.id as manager_employee_id,
  manager.full_name as manager_name,
  manager.job_title as manager_job_title,
  count(team.id) as team_count,
  count(team.id) filter (where team.status = 'ACTIVE') as active_team_count,
  count(team.id) filter (where team.manager_employee_id is null) as missing_manager_count
from public.employees manager
left join public.roles r on r.id = manager.role_id
left join public.employees team on team.manager_employee_id = manager.id and coalesce(team.is_deleted, false) = false
where coalesce(manager.is_deleted, false) = false
  and coalesce(r.slug, '') in ('manager', 'direct-manager', 'hr-manager', 'executive', 'executive-secretary', 'admin')
group by manager.id, manager.full_name, manager.job_title;

create or replace view public.hr_operations_report as
select
  e.id as employee_id,
  e.full_name as employee_name,
  e.job_title,
  e.status,
  e.manager_employee_id,
  m.full_name as manager_name,
  case when e.manager_employee_id is null and coalesce(r.slug, '') = 'employee' then true else false end as missing_manager,
  case when coalesce(e.phone, '') = '' then true else false end as missing_phone,
  case when coalesce(e.email, '') = '' then true else false end as missing_email
from public.employees e
left join public.employees m on m.id = e.manager_employee_id
left join public.roles r on r.id = e.role_id
where coalesce(e.is_deleted, false) = false;

create or replace view public.dispute_workflow_report as
select
  dc.id,
  dc.title,
  dc.employee_id,
  e.full_name as employee_name,
  dc.status,
  coalesce(dc.current_stage, dc.status, 'open') as current_stage,
  dc.severity as priority,
  dc.committee_decision,
  dc.escalated_to_executive,
  dc.created_at,
  dc.updated_at
from public.dispute_cases dc
left join public.employees e on e.id = dc.employee_id;


-- END PATCH: 040_runtime_alignment_fix.sql


-- =========================================================
-- BEGIN PATCH: 041_audit_v7_security_mobile_alignment.sql
-- =========================================================

-- =========================================================
-- Patch 041 — Audit V7 security/mobile alignment
-- Purpose:
-- 1) Provide a role-based password-vault guard without personal phone rules.
-- 2) Encrypt legacy credential_vault plaintext columns if they exist in older deployments.
-- 3) Keep temporary_password as a legacy boolean flag and document must_change_password usage.
-- =========================================================

begin;

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists must_change_password boolean not null default true;

comment on column public.profiles.temporary_password is
  'Legacy boolean flag only. Do not store plaintext passwords here. Use must_change_password for login policy.';
comment on column public.profiles.must_change_password is
  'Boolean login policy flag that forces the user to change a temporary password after login.';

create or replace function public.current_can_view_password_vault()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    left join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
      and (
        coalesce(r.slug, '') in ('admin', 'hr-manager')
        or coalesce(r.key, '') in ('ADMIN', 'HR_MANAGER')
        or '*' = any(coalesce(r.permissions, '{}'::text[]))
        or 'users:manage' = any(coalesce(r.permissions, '{}'::text[]))
      )
  );
$$;

grant execute on function public.current_can_view_password_vault() to authenticated;

-- Upgrade older deployments that may still have public.credential_vault with plaintext fields.
do $$
declare
  vault_key text := coalesce(nullif(current_setting('app.vault_key', true), ''), nullif(current_setting('app.jwt_secret', true), ''), 'change-this-vault-key-before-production');
begin
  if to_regclass('public.credential_vault') is not null then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'credential_vault' and column_name = 'encrypted_temporary_password'
    ) then
      alter table public.credential_vault add column encrypted_temporary_password bytea;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'credential_vault' and column_name = 'temporary_password'
    ) then
      execute 'update public.credential_vault
              set encrypted_temporary_password = pgp_sym_encrypt(temporary_password::text, $1)
              where encrypted_temporary_password is null and temporary_password is not null'
      using vault_key;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'credential_vault' and column_name = 'temp_password'
    ) then
      execute 'update public.credential_vault
              set encrypted_temporary_password = pgp_sym_encrypt(temp_password::text, $1)
              where encrypted_temporary_password is null and temp_password is not null'
      using vault_key;
    end if;

    alter table public.credential_vault enable row level security;

    drop policy if exists credential_vault_role_guard_select on public.credential_vault;
    create policy credential_vault_role_guard_select
      on public.credential_vault
      for select
      using (public.current_can_view_password_vault());
  end if;
end $$;

insert into public.system_settings (key, value, description, updated_at)
values (
  'audit_v7_security_mobile_alignment',
  jsonb_build_object(
    'patch', '041_audit_v7_security_mobile_alignment.sql',
    'serviceWorkerSplit', true,
    'employeeMoreSheet', true,
    'passwordVaultRoleGuard', true,
    'legacyCredentialVaultEncrypted', true
  ),
  'Tracks Audit V7 hardening: scoped service workers, employee mobile navigation, and role-based password vault guard.',
  now()
)
on conflict (key) do update set value = excluded.value, description = excluded.description, updated_at = now();

commit;


-- END PATCH: 041_audit_v7_security_mobile_alignment.sql


-- =========================================================
-- BEGIN PATCH: 042_authorized_roster_phone_login_internal_channel.sql
-- =========================================================

-- =========================================================
-- 042 Authorized employee roster + phone login policy
-- Generated from: بيانات الموظفين.xlsx
-- Purpose:
--   1) اعتماد قائمة الموظفين الرسمية فقط.
--   2) ربط المدير المباشر ورقم الهاتف والمسمى الوظيفي والصورة.
--   3) تفعيل سياسة دخول الموظفين برقم الهاتف، وكلمة المرور الافتراضية = رقم الهاتف/الرقم الشخصي.
--   4) إضافة لجنة حل المشاكل والخلافات وقناة التواصل الداخلي للتذكيرات.
-- =========================================================

begin;

insert into public.permissions (scope, name)
values
  ('announcements:manage', 'إدارة قناة التواصل الداخلي'),
  ('disputes:committee', 'عضوية لجنة حل المشاكل والخلافات'),
  ('disputes:manage', 'إدارة الشكاوى وفض الخلافات')
on conflict (scope) do update set name = excluded.name;

alter table public.employees add column if not exists roster_source text default '';
alter table public.employees add column if not exists phone_login_enabled boolean not null default true;

create table if not exists public.authorized_employee_roster (
  employee_code text primary key,
  full_name text not null,
  phone text not null,
  email text not null,
  photo_url text default '',
  job_title text default '',
  role_slug text not null default 'employee',
  department_code text not null default 'OPS',
  manager_employee_code text default '',
  initial_password_policy text not null default 'PHONE_AS_PASSWORD',
  source_file text not null default 'بيانات الموظفين.xlsx',
  updated_at timestamptz not null default now()
);

with roster(employee_code, full_name, phone, email, photo_url, job_title, role_slug, department_code, manager_employee_code) as (
  values
    ('AHS-001', 'الشيخ محمد يوسف', 'PHONE_PLACEHOLDER_010', 'emp.demo010@ahla.local', 'employee-avatars/emp-executive-director.png', 'المدير لتنفيذي للجمعية', 'executive', 'EXEC', ''),
    ('AHS-002', 'يحيي جمال السبع', 'PHONE_PLACEHOLDER_083', 'emp.demo083@ahla.local', 'employee-avatars/emp-executive-secretary.png', 'السكرتير التنفيذي + تكنولوجيا المعلومات (IT) والبرمجة', 'executive-secretary', 'EXEC', 'AHS-001'),
    ('AHS-003', 'محمد ابو عمار', 'PHONE_PLACEHOLDER_084', 'emp.demo084@ahla.local', 'employee-avatars/emp-direct-manager-01.png', 'مدير تشغيل 1', 'direct-manager', 'MGT', 'AHS-001'),
    ('AHS-004', 'محمد عبدالعظيم محمد', 'PHONE_PLACEHOLDER_072', 'emp.demo072@ahla.local', 'employee-avatars/emp-xlsx-004.png', 'مسؤول اللجنة الطبية', 'direct-manager', 'MGT', 'AHS-003'),
    ('AHS-005', 'بلال محمد الشاكر', 'PHONE_PLACEHOLDER_046', 'emp.demo046@ahla.local', 'employee-avatars/emp-hr-manager.png', 'مسؤول الموارد البشرية + الاعلام', 'hr-manager', 'HR', 'AHS-001'),
    ('AHS-006', 'ياسر فتحي نور الدين', 'PHONE_PLACEHOLDER_082', 'emp.demo082@ahla.local', 'employee-avatars/emp-direct-manager-06.png', 'مدير تشغيل 2', 'direct-manager', 'MGT', 'AHS-001'),
    ('AHS-007', 'مصطفي فايد', 'PHONE_PLACEHOLDER_014', 'emp.demo014@ahla.local', 'employee-avatars/emp-xlsx-007.png', 'مدير الحسابات', 'direct-manager', 'MGT', 'AHS-001'),
    ('AHS-008', 'حامد محمود العمدة', 'PHONE_PLACEHOLDER_013', 'emp.demo013@ahla.local', 'employee-avatars/emp-direct-manager-02.png', 'مسؤول لجنة أسرة كريمة', 'direct-manager', 'MGT', 'AHS-003'),
    ('AHS-009', 'مصطفي احمد', 'PHONE_PLACEHOLDER_075', 'emp.demo075@ahla.local', 'employee-avatars/emp-direct-manager-03.png', 'ادارة اللوجيستك', 'direct-manager', 'MGT', 'AHS-001'),
    ('AHS-010', 'محمد سيد', 'PHONE_PLACEHOLDER_019', 'emp.demo019@ahla.local', 'employee-avatars/emp-xlsx-010.png', 'موظف مشتريات', 'employee', 'OPS', 'AHS-009'),
    ('AHS-011', 'حاتم محمد سالم', 'PHONE_PLACEHOLDER_074', 'emp.demo074@ahla.local', 'employee-avatars/emp-xlsx-011.png', 'سائق العربية عزيزة', 'employee', 'OPS', 'AHS-009'),
    ('AHS-012', 'ربيع محمد ابو زيد', 'PHONE_PLACEHOLDER_081', 'emp.demo081@ahla.local', '', 'سائق العربية مسك', 'employee', 'OPS', 'AHS-009'),
    ('AHS-013', 'طارق سيد إبراهيم', 'PHONE_PLACEHOLDER_012', 'emp.demo012@ahla.local', 'employee-avatars/emp-xlsx-013.png', 'مدير الحركة سائق + مطبخ المتععفين 2', 'direct-manager', 'MGT', 'AHS-009'),
    ('AHS-014', 'عمار محمد عبدالباسط', 'PHONE_PLACEHOLDER_078', 'emp.demo078@ahla.local', '', 'جرافيك ديزاينر', 'employee', 'OPS', 'AHS-005'),
    ('AHS-015', 'احمد محمد محجوب', 'PHONE_PLACEHOLDER_047', 'emp.demo047@ahla.local', 'employee-avatars/emp-direct-manager-04.png', 'مدير الشؤون الادارية', 'direct-manager', 'MGT', 'AHS-001'),
    ('AHS-016', 'عبدالله حسين حافظ', 'PHONE_PLACEHOLDER_076', 'emp.demo076@ahla.local', 'employee-avatars/emp-xlsx-016.png', 'شؤون ادارية', 'direct-manager', 'MGT', 'AHS-015'),
    ('AHS-017', 'عبد القادر جمال', 'PHONE_PLACEHOLDER_045', 'emp.demo045@ahla.local', 'employee-avatars/emp-xlsx-017.png', 'شؤون إدارية', 'direct-manager', 'MGT', 'AHS-015'),
    ('AHS-018', 'هاني احمد نصير', 'PHONE_PLACEHOLDER_018', 'emp.demo018@ahla.local', 'employee-avatars/emp-xlsx-018.png', 'مسؤول المشروعات و طلاب العلم', 'direct-manager', 'MGT', 'AHS-003'),
    ('AHS-019', 'يوسف رسمي شعبان', 'PHONE_PLACEHOLDER_007', 'emp.demo007@ahla.local', '', 'المشرف الفني لمجمع منيل شيحة', 'direct-manager', 'MGT', 'AHS-001'),
    ('AHS-020', 'اسماعيل عبدالله', 'PHONE_PLACEHOLDER_073', 'emp.demo073@ahla.local', 'employee-avatars/emp-xlsx-020.png', 'موظف بالمجمع', 'employee', 'OPS', 'AHS-019'),
    ('AHS-021', 'عبدالرحمن حسين مرعي', 'PHONE_PLACEHOLDER_079', 'emp.demo079@ahla.local', 'employee-avatars/emp-xlsx-021.png', 'موظف لجنة أسرة كريمة', 'employee', 'OPS', 'AHS-008'),
    ('AHS-022', 'محمد عبده مزار', 'PHONE_PLACEHOLDER_011', 'emp.demo011@ahla.local', '', 'طباخ بمجمع أحلى شباب', 'employee', 'OPS', 'AHS-019'),
    ('AHS-023', 'حسام عفيفي جمعة', 'PHONE_PLACEHOLDER_009', 'emp.demo009@ahla.local', '', 'موظف بالمجمع', 'employee', 'OPS', 'AHS-019'),
    ('AHS-024', 'محمد الاندونيسي', 'PHONE_PLACEHOLDER_077', 'emp.demo077@ahla.local', 'employee-avatars/emp-xlsx-024.png', 'مسؤول الدعايا', 'direct-manager', 'MGT', 'AHS-006'),
    ('AHS-025', 'ياسين طارق الباسل', 'PHONE_PLACEHOLDER_080', 'emp.demo080@ahla.local', '', 'مسؤول الدعايا', 'direct-manager', 'MGT', 'AHS-006'),
    ('AHS-026', 'عبد العزيز طارق الباسل', 'PHONE_PLACEHOLDER_008', 'emp.demo008@ahla.local', 'employee-avatars/emp-xlsx-026.png', 'مسؤول سفير + مطيخ المتعففين 3', 'direct-manager', 'MGT', 'AHS-001'),
    ('AHS-027', 'محمد عبد المنعم', 'PHONE_PLACEHOLDER_015', 'emp.demo015@ahla.local', '', 'مسؤول الاستكشاف', 'direct-manager', 'MGT', 'AHS-001'),
    ('AHS-028', 'عبداالله نصر', 'PHONE_PLACEHOLDER_020', 'emp.demo020@ahla.local', '', 'أدارة المتطوعين', 'direct-manager', 'MGT', 'AHS-006')
)
insert into public.authorized_employee_roster (
  employee_code, full_name, phone, email, photo_url, job_title, role_slug, department_code, manager_employee_code
)
select employee_code, full_name, phone, email, photo_url, job_title, role_slug, department_code, manager_employee_code
from roster
on conflict (employee_code) do update set
  full_name = excluded.full_name,
  phone = excluded.phone,
  email = excluded.email,
  photo_url = excluded.photo_url,
  job_title = excluded.job_title,
  role_slug = excluded.role_slug,
  department_code = excluded.department_code,
  manager_employee_code = excluded.manager_employee_code,
  initial_password_policy = 'PHONE_AS_PASSWORD',
  source_file = 'بيانات الموظفين.xlsx',
  updated_at = now();

with roster as (
  select * from public.authorized_employee_roster
),
default_scope as (
  select
    (select id from public.branches where coalesce(is_deleted,false)=false order by created_at nulls last limit 1) as branch_id,
    (select id from public.governorates order by created_at nulls last limit 1) as governorate_id,
    (select id from public.complexes where coalesce(is_deleted,false)=false order by created_at nulls last limit 1) as complex_id
)
insert into public.employees (
  employee_code, full_name, phone, email, photo_url, job_title,
  role_id, branch_id, department_id, governorate_id, complex_id,
  status, is_active, is_deleted, hire_date, roster_source, phone_login_enabled
)
select
  r.employee_code,
  r.full_name,
  r.phone,
  r.email,
  r.photo_url,
  r.job_title,
  role_row.id,
  ds.branch_id,
  dept.id,
  ds.governorate_id,
  ds.complex_id,
  'ACTIVE',
  true,
  false,
  current_date,
  'بيانات الموظفين.xlsx',
  true
from roster r
cross join default_scope ds
left join public.roles role_row on role_row.slug = r.role_slug
left join public.departments dept on dept.code = r.department_code
on conflict (employee_code) do update set
  full_name = excluded.full_name,
  phone = excluded.phone,
  email = excluded.email,
  photo_url = excluded.photo_url,
  job_title = excluded.job_title,
  role_id = excluded.role_id,
  branch_id = excluded.branch_id,
  department_id = excluded.department_id,
  governorate_id = excluded.governorate_id,
  complex_id = excluded.complex_id,
  status = 'ACTIVE',
  is_active = true,
  is_deleted = false,
  roster_source = 'بيانات الموظفين.xlsx',
  phone_login_enabled = true,
  updated_at = now();

with roster as (
  select * from public.authorized_employee_roster
)
update public.employees e
set manager_employee_id = manager.id,
    updated_at = now()
from roster r
left join public.employees manager on manager.employee_code = nullif(r.manager_employee_code, '')
where e.employee_code = r.employee_code;

-- اعتماد القائمة الرسمية فقط: أي employee_code خارج القائمة يتم تعطيله منطقيًا ولا يحذف سجله التاريخي.
update public.employees
set is_deleted = true,
    is_active = false,
    status = 'INACTIVE',
    updated_at = now()
where employee_code is not null
  and employee_code not in ('AHS-001', 'AHS-002', 'AHS-003', 'AHS-004', 'AHS-005', 'AHS-006', 'AHS-007', 'AHS-008', 'AHS-009', 'AHS-010', 'AHS-011', 'AHS-012', 'AHS-013', 'AHS-014', 'AHS-015', 'AHS-016', 'AHS-017', 'AHS-018', 'AHS-019', 'AHS-020', 'AHS-021', 'AHS-022', 'AHS-023', 'AHS-024', 'AHS-025', 'AHS-026', 'AHS-027', 'AHS-028');

-- ربط الصور والبيانات بأي profiles موجودة مسبقًا بنفس الهاتف/البريد.
update public.profiles p
set employee_id = e.id,
    full_name = e.full_name,
    phone = e.phone,
    email = e.email,
    avatar_url = e.photo_url,
    role_id = e.role_id,
    branch_id = e.branch_id,
    department_id = e.department_id,
    governorate_id = e.governorate_id,
    complex_id = e.complex_id,
    status = 'ACTIVE',
    temporary_password = false,
    must_change_password = false,
    updated_at = now()
from public.employees e
where (p.phone = e.phone or lower(p.email) = lower(e.email))
  and e.employee_code in ('AHS-001', 'AHS-002', 'AHS-003', 'AHS-004', 'AHS-005', 'AHS-006', 'AHS-007', 'AHS-008', 'AHS-009', 'AHS-010', 'AHS-011', 'AHS-012', 'AHS-013', 'AHS-014', 'AHS-015', 'AHS-016', 'AHS-017', 'AHS-018', 'AHS-019', 'AHS-020', 'AHS-021', 'AHS-022', 'AHS-023', 'AHS-024', 'AHS-025', 'AHS-026', 'AHS-027', 'AHS-028');

-- إعدادات توضح السياسة للإدارة والواجهة.
create table if not exists public.settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  description text default '',
  updated_at timestamptz not null default now()
);

insert into public.settings (key, value, description)
values
  ('employee_login_policy', '{"identifier":"phone","initialPassword":"same_as_phone","selfRegistration":false,"source":"بيانات الموظفين.xlsx"}'::jsonb, 'سياسة الدخول المعتمدة بعد استيراد قائمة الموظفين'),
  ('internal_communication_channel', '{"enabled":true,"push":true,"inAppSound":true,"audience":"all"}'::jsonb, 'قناة التواصل الداخلي للإعلانات والتذكيرات والتعليمات')
on conflict (key) do update set value = excluded.value, description = excluded.description, updated_at = now();

create table if not exists public.dispute_committee_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.dispute_committee_settings (key, value)
values (
  'main_committee',
  '{"name":"لجنة حل المشاكل والخلافات","members":["الشيخ محمد يوسف","يحيي جمال السبع","محمد ابو عمار","بلال محمد الشاكر","ياسر فتحي نور الدين"],"executiveEscalationTo":"الشيخ محمد يوسف","secretary":"يحيي جمال السبع"}'::jsonb
)
on conflict (key) do update set value = excluded.value, updated_at = now();

commit;


-- END PATCH: 042_authorized_roster_phone_login_internal_channel.sql


-- =========================================================
-- BEGIN PATCH: 043_executive_presence_risk_decisions_reports.sql
-- =========================================================

-- =========================================================
-- 043 Executive live presence + attendance risk + decisions + committee minutes + monthly PDF queue
-- Purpose:
--   1) لوحة حضور لحظية للمدير التنفيذي مع خريطة وموقع.
--   2) نظام تقييم خطر البصمة والتلاعب.
--   3) سجل قرارات إدارية رسمي مع توقيع اطلاع لكل موظف.
--   4) محاضر لجنة حل المشاكل والخلافات.
--   5) صلاحيات أدق للمدير المباشر: يرى فريقه فقط عبر RLS.
--   6) سجل تشغيل تقارير PDF شهرية تلقائية.
-- =========================================================

begin;

alter table public.attendance_events add column if not exists device_id text;
alter table public.attendance_events add column if not exists user_agent text;
alter table public.attendance_events add column if not exists source text default 'web';

insert into public.permissions (scope, name)
values
  ('executive:presence-map', 'خريطة الحضور اللحظية للمدير التنفيذي'),
  ('attendance:risk', 'مركز تقييم خطر البصمة'),
  ('decisions:manage', 'إدارة سجل القرارات الإدارية'),
  ('decisions:acknowledge', 'تأكيد الاطلاع على القرارات'),
  ('disputes:minutes', 'محاضر لجنة حل المشاكل والخلافات'),
  ('reports:monthly-pdf-auto', 'تقارير PDF شهرية تلقائية'),
  ('manager:team-only', 'قصر المدير المباشر على فريقه فقط')
on conflict (scope) do update set name = excluded.name;

update public.roles
set permissions = (
  select array(select distinct unnest(coalesce(public.roles.permissions, '{}'::text[]) || array['executive:presence-map','attendance:risk','decisions:manage','reports:monthly-pdf-auto','disputes:minutes','manager:team-only']))
)
where slug in ('admin', 'executive-secretary');

update public.roles
set permissions = (
  select array(select distinct unnest(coalesce(public.roles.permissions, '{}'::text[]) || array['executive:presence-map','attendance:risk','decisions:manage','reports:monthly-pdf-auto','disputes:minutes']))
)
where slug in ('executive');

update public.roles
set permissions = (
  select array(select distinct unnest(coalesce(public.roles.permissions, '{}'::text[]) || array['attendance:risk','decisions:manage','reports:monthly-pdf-auto','disputes:minutes']))
)
where slug in ('hr-manager');

update public.roles
set permissions = (
  select array(select distinct unnest(coalesce(public.roles.permissions, '{}'::text[]) || array['manager:team-only','decisions:acknowledge']))
)
where slug in ('direct-manager', 'employee');

create table if not exists public.attendance_risk_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete cascade,
  attendance_event_id uuid,
  risk_code text not null,
  risk_label text not null,
  risk_score integer not null default 0,
  severity text not null default 'MEDIUM',
  metadata jsonb not null default '{}'::jsonb,
  resolved boolean not null default false,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_attendance_risk_events_employee_created on public.attendance_risk_events(employee_id, created_at desc);
create index if not exists idx_attendance_risk_events_unresolved on public.attendance_risk_events(resolved, severity);

create table if not exists public.admin_decisions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  category text not null default 'ADMINISTRATIVE',
  priority text not null default 'MEDIUM',
  scope text not null default 'ALL',
  target_employee_ids uuid[] not null default '{}'::uuid[],
  requires_acknowledgement boolean not null default true,
  status text not null default 'PUBLISHED',
  issued_by_user_id uuid,
  issued_by_employee_id uuid references public.employees(id) on delete set null,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_decision_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.admin_decisions(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  user_id uuid,
  acknowledged_at timestamptz not null default now(),
  user_agent text default '',
  ip_hint text default '',
  created_at timestamptz not null default now(),
  unique(decision_id, employee_id)
);

create index if not exists idx_admin_decisions_published on public.admin_decisions(status, published_at desc);
create index if not exists idx_admin_decision_ack_employee on public.admin_decision_acknowledgements(employee_id, acknowledged_at desc);

create table if not exists public.dispute_minutes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null,
  session_at timestamptz not null default now(),
  members text[] not null default '{}'::text[],
  decision text not null default '',
  notes text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  signed_by_user_id uuid,
  signed_by_name text default '',
  signature_status text not null default 'SIGNED',
  created_at timestamptz not null default now()
);

create index if not exists idx_dispute_minutes_case_session on public.dispute_minutes(case_id, session_at desc);

create table if not exists public.monthly_pdf_report_runs (
  id uuid primary key default gen_random_uuid(),
  month text not null,
  status text not null default 'READY',
  generated_at timestamptz not null default now(),
  generated_by_user_id uuid,
  storage_path text default '',
  counts jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_monthly_pdf_report_runs_month on public.monthly_pdf_report_runs(month, generated_at desc);

create or replace function public.current_profile_employee_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select p.employee_id
  from public.profiles p
  where p.id = auth.uid()
  limit 1;
$$;

create or replace function public.current_has_any_scope(required_scopes text[])
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    left join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
      and (
        coalesce(r.slug, '') in ('admin','executive-secretary')
        or '*' = any(coalesce(r.permissions, '{}'::text[]))
        or coalesce(r.permissions, '{}'::text[]) && required_scopes
      )
  );
$$;

create or replace function public.current_can_see_employee(target_employee_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  with recursive team(id) as (
    select public.current_profile_employee_id()
    union
    select e.id
    from public.employees e
    join team t on e.manager_employee_id = t.id
    where coalesce(e.is_deleted, false) = false
  )
  select
    public.current_has_any_scope(array['employees:write','hr:operations','executive:mobile','executive:presence-map','attendance:manage','kpi:hr'])
    or target_employee_id in (select id from team);
$$;

-- Override the original employee-scope guard so direct managers never read outside their team.
create or replace function public.can_access_employee(emp_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.current_can_see_employee(emp_id);
$$;

create or replace view public.executive_presence_live as
select
  e.id as employee_id,
  e.full_name,
  e.job_title,
  e.phone,
  e.photo_url,
  e.manager_employee_id,
  m.full_name as manager_name,
  latest_event.event_at as last_attendance_at,
  latest_event.type as last_attendance_type,
  latest_event.status as last_attendance_status,
  latest_event.geofence_status,
  latest_event.requires_review,
  latest_location.latitude,
  latest_location.longitude,
  latest_location.accuracy_meters,
  latest_location.captured_at as last_location_at,
  case
    when latest_event.event_at is null then 'ABSENT'
    when coalesce(latest_event.status, '') ilike '%LATE%' then 'LATE'
    when latest_event.type = 'CHECK_OUT' then 'CHECKED_OUT'
    else 'PRESENT'
  end as today_status
from public.employees e
left join public.employees m on m.id = e.manager_employee_id
left join lateral (
  select ae.*
  from public.attendance_events ae
  where ae.employee_id = e.id
    and ae.event_at::date = current_date
  order by ae.event_at desc nulls last, ae.created_at desc nulls last
  limit 1
) latest_event on true
left join lateral (
  select llr.employee_id, llr.latitude, llr.longitude, llr.accuracy_meters, coalesce(llr.captured_at, llr.responded_at, llr.created_at) as captured_at
  from public.live_location_responses llr
  where llr.employee_id = e.id
  order by coalesce(llr.captured_at, llr.responded_at, llr.created_at) desc nulls last
  limit 1
) latest_location on true
where coalesce(e.is_deleted, false) = false;

create or replace view public.attendance_risk_dashboard as
select
  e.id as employee_id,
  e.full_name,
  e.job_title,
  count(ae.id) filter (where ae.requires_review = true or ae.geofence_status in ('outside_branch','location_low_accuracy','permission_denied','location_unavailable','geofence_miss')) as flagged_events,
  count(distinct coalesce(ae.device_id, ae.user_agent, ae.source)) filter (where ae.created_at >= now() - interval '7 days') as device_count,
  count(ae.id) filter (where ae.created_at >= now() - interval '7 days' and ae.latitude is null) as missing_location_events,
  least(100,
    (count(ae.id) filter (where ae.requires_review = true or ae.geofence_status in ('outside_branch','location_low_accuracy','permission_denied','location_unavailable','geofence_miss')) * 15)
    + greatest(0, count(distinct coalesce(ae.device_id, ae.user_agent, ae.source)) - 1) * 20
    + (count(ae.id) filter (where ae.created_at >= now() - interval '7 days' and ae.latitude is null) * 8)
  )::int as risk_score
from public.employees e
left join public.attendance_events ae on ae.employee_id = e.id and ae.created_at >= now() - interval '7 days'
where coalesce(e.is_deleted, false) = false
group by e.id, e.full_name, e.job_title;

alter table public.attendance_risk_events enable row level security;
alter table public.admin_decisions enable row level security;
alter table public.admin_decision_acknowledgements enable row level security;
alter table public.dispute_minutes enable row level security;
alter table public.monthly_pdf_report_runs enable row level security;

-- RLS for manager-team-only and executive/HR access.
drop policy if exists "attendance_risk_events_select_scope" on public.attendance_risk_events;
create policy "attendance_risk_events_select_scope" on public.attendance_risk_events
for select using (public.current_can_see_employee(employee_id));

drop policy if exists "attendance_risk_events_manage_scope" on public.attendance_risk_events;
create policy "attendance_risk_events_manage_scope" on public.attendance_risk_events
for all using (public.current_has_any_scope(array['attendance:risk','attendance:review','attendance:manage','executive:mobile']))
with check (public.current_has_any_scope(array['attendance:risk','attendance:review','attendance:manage','executive:mobile']));

drop policy if exists "admin_decisions_select_visible" on public.admin_decisions;
create policy "admin_decisions_select_visible" on public.admin_decisions
for select using (
  public.current_has_any_scope(array['decisions:manage','notifications:manage','executive:report'])
  or scope in ('ALL','EMPLOYEES')
  or public.current_profile_employee_id() = any(target_employee_ids)
);

drop policy if exists "admin_decisions_manage" on public.admin_decisions;
create policy "admin_decisions_manage" on public.admin_decisions
for all using (public.current_has_any_scope(array['decisions:manage','notifications:manage','executive:report']))
with check (public.current_has_any_scope(array['decisions:manage','notifications:manage','executive:report']));

drop policy if exists "admin_decision_ack_select_scope" on public.admin_decision_acknowledgements;
create policy "admin_decision_ack_select_scope" on public.admin_decision_acknowledgements
for select using (
  employee_id = public.current_profile_employee_id()
  or public.current_has_any_scope(array['decisions:manage','notifications:manage','executive:report'])
);

drop policy if exists "admin_decision_ack_insert_self" on public.admin_decision_acknowledgements;
create policy "admin_decision_ack_insert_self" on public.admin_decision_acknowledgements
for insert with check (employee_id = public.current_profile_employee_id());

drop policy if exists "dispute_minutes_select_scope" on public.dispute_minutes;
create policy "dispute_minutes_select_scope" on public.dispute_minutes
for select using (public.current_has_any_scope(array['disputes:minutes','disputes:committee','disputes:manage','executive:mobile']));

drop policy if exists "dispute_minutes_manage_scope" on public.dispute_minutes;
create policy "dispute_minutes_manage_scope" on public.dispute_minutes
for all using (public.current_has_any_scope(array['disputes:minutes','disputes:committee','disputes:manage','executive:mobile']))
with check (public.current_has_any_scope(array['disputes:minutes','disputes:committee','disputes:manage','executive:mobile']));

drop policy if exists "monthly_pdf_report_runs_select_scope" on public.monthly_pdf_report_runs;
create policy "monthly_pdf_report_runs_select_scope" on public.monthly_pdf_report_runs
for select using (public.current_has_any_scope(array['reports:monthly-pdf-auto','reports:pdf','reports:export','executive:report']));

drop policy if exists "monthly_pdf_report_runs_manage_scope" on public.monthly_pdf_report_runs;
create policy "monthly_pdf_report_runs_manage_scope" on public.monthly_pdf_report_runs
for all using (public.current_has_any_scope(array['reports:monthly-pdf-auto','reports:pdf','reports:export','executive:report']))
with check (public.current_has_any_scope(array['reports:monthly-pdf-auto','reports:pdf','reports:export','executive:report']));

insert into public.settings (key, value, description)
values
  ('executive_presence_live', '{"enabled":true,"map":true,"missingLocationAlert":true}'::jsonb, 'لوحة حضور لحظية وخريطة مباشرة للمدير التنفيذي'),
  ('attendance_risk_scoring', '{"enabled":true,"duplicateWindowMinutes":10,"farDistanceMeters":1000,"newDevicePoints":20}'::jsonb, 'إعدادات تقييم خطر البصمة'),
  ('monthly_pdf_reports', '{"enabled":true,"frequency":"monthly","include":["attendance","late","absence","kpi","disputes","requests"],"printToPdf":true}'::jsonb, 'تقارير PDF شهرية تلقائية')
on conflict (key) do update set value = excluded.value, description = excluded.description, updated_at = now();

commit;


-- END PATCH: 043_executive_presence_risk_decisions_reports.sql



-- Post-043 required security patches are provided separately:
--   patches/044_encrypt_credential_vault.sql
--   patches/045_enable_pg_cron_backup.sql
