-- =========================================================
-- 031 Web Guard + Mobile Polish Alignment
-- Purpose:
--   - Keep executive and admin web entry separated after Patch 030.
--   - Remove any legacy direct '*' permissions from executive profiles if an older
--     schema stored profile-level permissions in addition to role permissions.
--   - Add an audit marker for the front-end scoped gateway/mobile dialog polish.
-- Run after: 030_executive_role_separation_ui_polish.sql
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
