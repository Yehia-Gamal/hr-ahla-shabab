-- Compatibility alias generated in V26.
-- Source file: 032b_pre_publish_role_portal_consistency.sql

-- =========================================================
-- 032 Pre-publish Role + Portal Consistency Guard
-- Purpose:
--   - Make executive / executive-secretary roles safe even in environments
--     that ran older seeds or were manually edited.
--   - Ensure all executive portal scopes exist in permissions catalog.
--   - Remove accidental profile-level '*' permissions from executive profiles.
-- Run after: 031_web_guard_mobile_polish.sql
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
