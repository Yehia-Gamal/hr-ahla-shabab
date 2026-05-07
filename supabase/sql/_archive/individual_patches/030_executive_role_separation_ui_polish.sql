-- Compatibility alias generated in V26.
-- Source file: 030a_executive_role_separation_ui_polish.sql

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
