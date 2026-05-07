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
