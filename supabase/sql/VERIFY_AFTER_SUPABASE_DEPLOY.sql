-- =========================================================
-- Verification for HR Ahla Shabab v104 Royal Blue SQL Merge
-- Run after applying RUN_IN_SUPABASE_SQL_EDITOR.sql or 104_royal_blue_complete_safe_migration.sql.
-- Plain SQL only: safe for Supabase SQL Editor.
-- =========================================================

select 'latest_base_migration_098' as check_name,
  case when exists (
    select 1 from public.database_migration_status
    where name in ('098_location_security_edge_hardening', '098_location_security_edge_hardening.sql')
  ) then 'OK' else 'MISSING' end as status,
  'Base expected marker before v104: 098_location_security_edge_hardening' as details;

select 'v104_sql_merge_marker' as check_name,
  case when exists (
    select 1 from public.database_migration_status
    where name = '104_royal_blue_full_migration' and status = 'APPLIED'
  ) then 'OK' else 'MISSING' end as status,
  'Expected latest marker after merge: 104_royal_blue_full_migration' as details;

select 'v104_system_setting' as check_name,
  case when exists (
    select 1 from public.system_settings
    where key = 'v104_release' and value->>'expectedPatch' = '104_royal_blue_full_migration'
  ) then 'OK' else 'MISSING_OR_MISMATCH' end as status,
  coalesce(
    (select concat('version=', value->>'version', '; expectedPatch=', value->>'expectedPatch', '; updatedAt=', coalesce(updated_at::text, 'unknown')) from public.system_settings where key = 'v104_release' limit 1),
    'v104_release setting not found'
  ) as details;

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

select 'notifications_v104_columns' as check_name,
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notifications' and column_name = 'priority'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notifications' and column_name = 'sent_via_push'
  ) then 'OK' else 'MISSING' end as status,
  'notifications should include priority/sent_via_push columns' as details;

select 'v104_attendance_points_table' as check_name,
  case when to_regclass('public.attendance_points') is not null then 'OK' else 'MISSING' end as status,
  'attendance_points supports attendance gamification' as details;

select 'v104_employee_analytics_table' as check_name,
  case when to_regclass('public.employee_analytics_monthly') is not null then 'OK' else 'MISSING' end as status,
  'employee_analytics_monthly supports monthly KPI/attendance analytics' as details;

select 'v104_announcements_table' as check_name,
  case when to_regclass('public.announcements') is not null then 'OK' else 'MISSING' end as status,
  'announcements table supports internal broadcasts' as details;

select 'v104_push_log_table' as check_name,
  case when to_regclass('public.push_notification_log') is not null then 'OK' else 'MISSING' end as status,
  'push_notification_log supports notification delivery diagnostics' as details;

select 'safe_create_notification_rpc' as check_name,
  case when exists (select 1 from pg_proc where proname = 'safe_create_notification') then 'OK' else 'MISSING' end as status,
  'safe_create_notification RPC is used by location/KPI workflows' as details;

select 'v104_has_any_permission_rpc' as check_name,
  case when exists (select 1 from pg_proc where proname = 'has_any_permission') then 'OK' else 'MISSING' end as status,
  'has_any_permission helper should exist after v104 merge' as details;

select 'v104_location_reject_rpc' as check_name,
  case when exists (select 1 from pg_proc where proname = 'reject_live_location_request') then 'OK' else 'MISSING' end as status,
  'reject_live_location_request RPC should exist after v104 merge' as details;

-- v104 credential vault alignment check
select '104_credential_vault_sql_alignment' as item, case when exists (select 1 from public.database_migration_status where name = '104_credential_vault_sql_alignment') then 'OK' else 'MISSING' end as status;

-- v104 QC4/QC5 static/runtime alignment checks
select '104_sql_qc4_static_runtime_alignment' as item,
  case when exists (
    select 1 from public.database_migration_status
    where name = '104_sql_qc4_static_runtime_alignment' and status = 'APPLIED'
  ) then 'OK' else 'MISSING' end as status;

select '104_sql_qc5_final_alignment' as item,
  case when exists (
    select 1 from public.database_migration_status
    where name = '104_sql_qc5_final_alignment' and status = 'APPLIED'
  ) and to_regclass('public.patch_markers') is not null
  then 'OK' else 'MISSING' end as status;

select 'v104_live_operations_center_aligned' as item,
  case when to_regclass('public.live_operations_center') is not null then 'OK' else 'MISSING' end as status;
