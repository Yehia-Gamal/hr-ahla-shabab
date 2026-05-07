-- HR Supabase Web Management HR Reports - post deploy verification
-- Run after PRODUCTION_SQL_EDITOR_ALL_PATCHES_001_TO_043.sql.
-- This file reads metadata only and does not contain secrets.

with required_tables(table_name) as (
  values
    ('roles'),
    ('profiles'),
    ('employees'),
    ('authorized_employee_roster'),
    ('attendance_events'),
    ('employee_locations'),
    ('live_location_requests'),
    ('live_location_responses'),
    ('notifications'),
    ('push_subscriptions'),
    ('notification_delivery_log'),
    ('admin_decisions'),
    ('admin_decision_acknowledgements'),
    ('dispute_cases'),
    ('dispute_minutes'),
    ('dispute_committee_settings'),
    ('monthly_pdf_report_runs'),
    ('attendance_risk_events'),
    ('settings')
)
select
  'required_tables' as check_group,
  table_name as item,
  case when to_regclass('public.' || table_name) is not null then 'OK' else 'MISSING' end as status
from required_tables
order by table_name;

select
  'core_counts' as check_group,
  'employees' as item,
  count(*)::text as status
from public.employees
where coalesce(is_deleted, false) = false
union all
select 'core_counts', 'profiles', count(*)::text from public.profiles
union all
select 'core_counts', 'roles', count(*)::text from public.roles
union all
select 'core_counts', 'authorized_roster', count(*)::text from public.authorized_employee_roster;

select
  'authorized_roster_quality' as check_group,
  issue,
  count(*)::text as status
from (
  select 'missing_name' as issue from public.authorized_employee_roster where nullif(trim(full_name), '') is null
  union all
  select 'missing_phone' from public.authorized_employee_roster where nullif(regexp_replace(phone, '\D', '', 'g'), '') is null
  union all
  select 'missing_role_slug' from public.authorized_employee_roster where nullif(trim(role_slug), '') is null
  union all
  select 'duplicate_phone' from (
    select regexp_replace(phone, '\D', '', 'g') as normalized_phone
    from public.authorized_employee_roster
    group by regexp_replace(phone, '\D', '', 'g')
    having count(*) > 1
  ) d
  union all
  select 'missing_employee_row'
  from public.authorized_employee_roster r
  left join public.employees e on e.employee_code = r.employee_code and coalesce(e.is_deleted, false) = false
  where e.id is null
  union all
  select 'missing_profile_for_employee'
  from public.employees e
  left join public.profiles p on p.employee_id = e.id
  where coalesce(e.is_deleted, false) = false and p.id is null
  union all
  select 'missing_role_on_employee'
  from public.employees e
  where coalesce(e.is_deleted, false) = false and e.role_id is null
  union all
  select 'missing_manager_link'
  from public.authorized_employee_roster r
  left join public.employees e on e.employee_code = r.employee_code
  where nullif(r.manager_employee_code, '') is not null and e.manager_employee_id is null
) issues
group by issue
order by issue;

with push_columns(column_name) as (
  values
    ('id'),
    ('user_id'),
    ('employee_id'),
    ('endpoint'),
    ('keys'),
    ('is_active'),
    ('permission'),
    ('user_agent'),
    ('platform'),
    ('created_at')
)
select
  'push_subscription_columns' as check_group,
  column_name as item,
  case when exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'push_subscriptions'
      and columns.column_name = push_columns.column_name
  ) then 'OK' else 'MISSING' end as status
from push_columns
order by column_name;

with sensitive_tables(table_name) as (
  values
    ('profiles'),
    ('employees'),
    ('attendance_events'),
    ('employee_locations'),
    ('live_location_requests'),
    ('live_location_responses'),
    ('notifications'),
    ('push_subscriptions'),
    ('admin_decisions'),
    ('admin_decision_acknowledgements'),
    ('dispute_cases'),
    ('dispute_minutes'),
    ('attendance_risk_events'),
    ('monthly_pdf_report_runs')
)
select
  'rls_enabled' as check_group,
  table_name as item,
  case when c.relrowsecurity then 'OK' else 'RLS_DISABLED_OR_MISSING' end as status
from sensitive_tables st
left join pg_class c on c.oid = to_regclass('public.' || st.table_name)
order by table_name;

with required_functions(function_name) as (
  values
    ('current_profile_employee_id'),
    ('current_has_any_scope'),
    ('current_can_see_employee'),
    ('can_access_employee'),
    ('resolve_login_identifier')
)
select
  'required_functions' as check_group,
  function_name as item,
  case when exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = required_functions.function_name
  ) then 'OK' else 'MISSING' end as status
from required_functions
order by function_name;

with required_views(view_name) as (
  values
    ('executive_presence_live'),
    ('attendance_risk_dashboard')
)
select
  'required_views' as check_group,
  view_name as item,
  case when to_regclass('public.' || view_name) is not null then 'OK' else 'MISSING' end as status
from required_views
order by view_name;

select
  'manager_permission' as check_group,
  'manager:team-only' as item,
  case when exists (
    select 1
    from public.roles
    where slug in ('direct-manager', 'employee')
      and 'manager:team-only' = any(coalesce(permissions, '{}'::text[]))
  ) then 'OK' else 'MISSING' end as status;

select
  'storage_buckets' as check_group,
  bucket as item,
  case when exists (select 1 from storage.buckets where id = bucket) then 'OK' else 'MISSING' end as status
from (values ('avatars'), ('punch-selfies'), ('employee-attachments')) b(bucket);

