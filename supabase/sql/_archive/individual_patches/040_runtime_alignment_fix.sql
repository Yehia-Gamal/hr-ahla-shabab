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
