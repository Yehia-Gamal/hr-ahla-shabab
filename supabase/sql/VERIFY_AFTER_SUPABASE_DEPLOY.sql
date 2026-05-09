-- Verification for HR Ahla Shabab v31-production-hardening-098
-- Run after applying RUN_IN_SUPABASE_SQL_EDITOR.sql.

select 'latest_migration_marker' as check_name,
  case when exists (select 1 from public.database_migration_status where name in ('098_location_security_edge_hardening', '098_location_security_edge_hardening.sql')) then 'OK' else 'MISSING' end as status,
  'Expected latest marker: 098_location_security_edge_hardening / v31-production-hardening-098' as details;

select 'release_system_setting' as check_name,
  case when exists (select 1 from public.system_settings where key = 'release_098_location_security_edge_hardening') then 'OK' else 'MISSING' end as status,
  coalesce((select concat('version=', value->>'version', '; expectedPatch=', value->>'expectedPatch', '; updatedAt=', coalesce(updated_at::text, 'unknown')) from public.system_settings where key = 'release_098_location_security_edge_hardening' limit 1), 'release_098_location_security_edge_hardening not found') as details;

select 'core_profiles_table' as check_name,
  case when to_regclass('public.profiles') is not null then 'OK' else 'MISSING' end as status,
  'profiles table should exist for Auth/Profile binding' as details;

select 'live_location_requests_table' as check_name,
  case when to_regclass('public.live_location_requests') is not null then 'OK' else 'MISSING' end as status,
  'live_location_requests supports executive-to-employee location workflow' as details;

select 'live_location_responses_table' as check_name,
  case when to_regclass('public.live_location_responses') is not null then 'OK' else 'MISSING' end as status,
  'live_location_responses stores APPROVED/POSTPONED/REJECTED_TEMPORARY responses' as details;

select 'push_subscriptions_table' as check_name,
  case when to_regclass('public.push_subscriptions') is not null then 'OK' else 'MISSING' end as status,
  'push_subscriptions should exist for Web Push dispatch' as details;

select 'safe_create_notification_rpc' as check_name,
  case when exists (select 1 from pg_proc where proname = 'safe_create_notification') then 'OK' else 'MISSING' end as status,
  'safe_create_notification RPC is used by location/KPI workflows' as details;
