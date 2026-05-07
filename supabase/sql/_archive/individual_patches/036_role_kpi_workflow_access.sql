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
