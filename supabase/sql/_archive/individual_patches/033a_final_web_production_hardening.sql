-- =========================================================
-- 033_final_web_production_hardening.sql
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

