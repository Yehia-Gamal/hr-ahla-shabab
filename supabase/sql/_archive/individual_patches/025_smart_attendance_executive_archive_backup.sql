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
