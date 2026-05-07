/**
 * Run post-deploy verification queries against Supabase.
 */
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || '';
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || '';
if (!PROJECT_REF) {
  console.error('Missing SUPABASE_PROJECT_REF.');
  process.exit(1);
}
const API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

async function runQuery(label, sql) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const data = await res.json();
  console.log(`\n=== ${label} ===`);
  if (data.message) { console.log('ERROR:', data.message); return; }
  if (Array.isArray(data)) {
    for (const row of data) {
      const status = row.status || '';
      const icon = status === 'OK' ? '✓' : (status === 'MISSING' || status.includes('DISABLED') ? '✗' : '•');
      console.log(`  ${icon} ${row.item || ''}: ${status}`);
    }
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

await runQuery('Required Tables', `
  with required_tables(table_name) as (
    values ('roles'),('profiles'),('employees'),('authorized_employee_roster'),
    ('attendance_events'),('employee_locations'),('live_location_requests'),
    ('live_location_responses'),('notifications'),('push_subscriptions'),
    ('notification_delivery_log'),('admin_decisions'),('admin_decision_acknowledgements'),
    ('dispute_cases'),('dispute_minutes'),('dispute_committee_settings'),
    ('monthly_pdf_report_runs'),('attendance_risk_events'),('settings')
  )
  select table_name as item,
    case when to_regclass('public.' || table_name) is not null then 'OK' else 'MISSING' end as status
  from required_tables order by table_name;
`);

await runQuery('Core Counts', `
  select 'employees' as item, count(*)::text as status from public.employees where coalesce(is_deleted, false) = false
  union all select 'profiles', count(*)::text from public.profiles
  union all select 'roles', count(*)::text from public.roles
  union all select 'authorized_roster', count(*)::text from public.authorized_employee_roster;
`);

await runQuery('Push Subscription Columns', `
  with push_columns(column_name) as (
    values ('id'),('user_id'),('employee_id'),('endpoint'),('keys'),('is_active'),('permission'),('user_agent'),('platform'),('created_at')
  )
  select column_name as item,
    case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='push_subscriptions' and columns.column_name=push_columns.column_name) then 'OK' else 'MISSING' end as status
  from push_columns order by column_name;
`);

await runQuery('RLS Enabled', `
  with sensitive_tables(table_name) as (
    values ('profiles'),('employees'),('attendance_events'),('employee_locations'),
    ('live_location_requests'),('live_location_responses'),('notifications'),
    ('push_subscriptions'),('admin_decisions'),('admin_decision_acknowledgements'),
    ('dispute_cases'),('dispute_minutes'),('attendance_risk_events'),('monthly_pdf_report_runs')
  )
  select table_name as item,
    case when c.relrowsecurity then 'OK' else 'RLS_DISABLED_OR_MISSING' end as status
  from sensitive_tables st left join pg_class c on c.oid = to_regclass('public.' || st.table_name) order by table_name;
`);

await runQuery('Required Functions', `
  with required_functions(function_name) as (
    values ('current_profile_employee_id'),('current_has_any_scope'),('current_can_see_employee'),('can_access_employee'),('resolve_login_identifier')
  )
  select function_name as item,
    case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=required_functions.function_name) then 'OK' else 'MISSING' end as status
  from required_functions order by function_name;
`);

await runQuery('Required Views', `
  with required_views(view_name) as (values ('executive_presence_live'),('attendance_risk_dashboard'))
  select view_name as item,
    case when to_regclass('public.' || view_name) is not null then 'OK' else 'MISSING' end as status
  from required_views order by view_name;
`);

await runQuery('Manager Permission', `
  select 'manager:team-only' as item,
    case when exists (select 1 from public.roles where slug in ('direct-manager','employee') and 'manager:team-only' = any(coalesce(permissions,'{}'::text[]))) then 'OK' else 'MISSING' end as status;
`);

await runQuery('Storage Buckets', `
  select bucket as item,
    case when exists (select 1 from storage.buckets where id=bucket) then 'OK' else 'MISSING' end as status
  from (values ('avatars'),('punch-selfies'),('employee-attachments')) b(bucket);
`);

console.log('\n=== Verification Complete ===');
