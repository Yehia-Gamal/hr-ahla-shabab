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
