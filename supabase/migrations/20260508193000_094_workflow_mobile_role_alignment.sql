-- 094_workflow_mobile_role_alignment
-- Safe, idempotent marker for the mobile role / workflow binding release.

create table if not exists public.database_migration_status (
  name text primary key,
  status text not null default 'APPLIED',
  applied_at timestamptz not null default now(),
  notes text
);

create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.database_migration_status (name, status, applied_at, notes)
values (
  '094_workflow_mobile_role_alignment',
  'APPLIED',
  now(),
  'ربط تطبيق الموظف بصلاحيات المدير ولجنة الخلافات وربط HR/Executive/Technical dashboards ببيانات التشغيل.'
)
on conflict (name) do update set
  status = excluded.status,
  applied_at = now(),
  notes = excluded.notes;

insert into public.system_settings (key, value, updated_at)
values (
  'release_094_workflow_mobile_role_alignment',
  jsonb_build_object(
    'version', 'v31-production-hardening-094',
    'expectedPatch', '094_workflow_mobile_role_alignment',
    'features', jsonb_build_array(
      'employee-mobile-manager-hub',
      'dispute-committee-mobile-hub',
      'workflow-automation-center',
      'mobile-permission-alignment',
      'cross-panel-live-binding'
    )
  ),
  now()
)
on conflict (key) do update set
  value = excluded.value,
  updated_at = now();
