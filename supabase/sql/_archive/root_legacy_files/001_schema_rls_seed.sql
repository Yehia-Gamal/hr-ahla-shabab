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
  description text default '',
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
