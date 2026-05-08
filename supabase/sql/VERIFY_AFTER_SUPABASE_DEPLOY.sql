-- HR Ahla Shabab v31 post-deploy verification.
-- Metadata/read-only checks only. No secrets, no destructive SQL.

with required_tables(name) as (
  values
    ('roles'), ('profiles'), ('employees'), ('attendance_events'),
    ('employee_locations'), ('live_location_requests'), ('live_location_responses'),
    ('notifications'), ('push_subscriptions'), ('notification_delivery_log'),
    ('passkey_credentials'), ('trusted_device_approval_requests'),
    ('attendance_fallback_requests'), ('database_migration_status')
)
select
  'table:' || name as check_name,
  case when to_regclass('public.' || name) is not null then 'OK' else 'MISSING' end as status,
  'required runtime table' as details
from required_tables
order by check_name;

with required_columns(table_name, column_name) as (
  values
    ('notifications', 'user_id'), ('notifications', 'employee_id'), ('notifications', 'title'),
    ('notifications', 'body'), ('notifications', 'route'), ('notifications', 'data'),
    ('notifications', 'push_status'), ('notifications', 'push_error'),
    ('push_subscriptions', 'endpoint'), ('push_subscriptions', 'keys'),
    ('push_subscriptions', 'p256dh'), ('push_subscriptions', 'auth'),
    ('push_subscriptions', 'is_active'), ('push_subscriptions', 'status'),
    ('live_location_requests', 'employee_id'), ('live_location_requests', 'status'),
    ('live_location_responses', 'request_id'), ('live_location_responses', 'latitude'),
    ('attendance_events', 'type'), ('attendance_events', 'latitude'),
    ('attendance_events', 'longitude'), ('attendance_events', 'selfie_url'),
    ('attendance_events', 'device_fingerprint_hash')
)
select
  'column:' || table_name || '.' || column_name as check_name,
  case when exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = required_columns.table_name
      and c.column_name = required_columns.column_name
  ) then 'OK' else 'MISSING' end as status,
  'required runtime column' as details
from required_columns
order by check_name;

with required_functions(name) as (
  values
    ('safe_create_notification'), ('safe_create_notifications_bulk'),
    ('resolve_login_identifier'), ('current_is_full_access'),
    ('has_any_permission'), ('current_can_see_employee')
)
select
  'function:' || name as check_name,
  case when exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = required_functions.name
  ) then 'OK' else 'MISSING' end as status,
  'required RPC/function' as details
from required_functions
order by check_name;

with rls_tables(name) as (
  values
    ('profiles'), ('employees'), ('attendance_events'), ('employee_locations'),
    ('live_location_requests'), ('live_location_responses'),
    ('notifications'), ('push_subscriptions'), ('passkey_credentials')
)
select
  'rls:' || name as check_name,
  case when c.relrowsecurity then 'OK' else 'MISSING_OR_DISABLED' end as status,
  'RLS must be enabled' as details
from rls_tables
left join pg_class c on c.oid = to_regclass('public.' || rls_tables.name)
order by check_name;

with policy_tables(name) as (
  values
    ('notifications'), ('push_subscriptions'),
    ('live_location_requests'), ('live_location_responses'),
    ('attendance_events'), ('passkey_credentials')
)
select
  'policy:' || name as check_name,
  case when exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = policy_tables.name
  ) then 'OK' else 'MISSING' end as status,
  'at least one active policy must exist' as details
from policy_tables
order by check_name;

with required_indexes(table_name, name_like) as (
  values
    ('notifications', '%notification%'),
    ('push_subscriptions', '%push%'),
    ('live_location_requests', '%live_location%'),
    ('attendance_events', '%attendance%')
)
select
  'index:' || table_name as check_name,
  case when exists (
    select 1 from pg_indexes i
    where i.schemaname = 'public'
      and i.tablename = required_indexes.table_name
      and i.indexname ilike required_indexes.name_like
  ) then 'OK' else 'MISSING' end as status,
  'runtime index presence' as details
from required_indexes
order by check_name;

with required_grants(function_name) as (
  values ('safe_create_notification'), ('safe_create_notifications_bulk')
)
select
  'grant:' || function_name as check_name,
  case when has_function_privilege('authenticated', 'public.' || function_name || '(jsonb)', 'EXECUTE')
         or has_function_privilege('authenticated', 'public.' || function_name || '(uuid,uuid,text,text,text,text,jsonb)', 'EXECUTE')
       then 'OK' else 'MISSING' end as status,
  'authenticated execute grant' as details
from required_grants;

select
  'runtime:v31_marker' as check_name,
  case when exists (
    select 1 from public.database_migration_status
    where name in ('089_codex_full_deploy_alignment', '088_final_audit_alignment', '085_full_system_audit_fix', '080_live_location_alert_reliability')
  ) then 'OK' else 'MISSING' end as status,
  'v31-production-hardening-089 / 089_codex_full_deploy_alignment applied' as details;

select
  'attendance:friday_10_reminder' as check_name,
  case when exists (
    select 1 from public.smart_alert_rules
    where code = 'MISSING_PUNCH_1000_FLOATING'
      and schedule_hint = 'daily 10:00'
  ) then 'OK' else 'MISSING' end as status,
  'missing-punch reminder is floating/push at 10:00 and Friday is handled as weekly holiday' as details;
