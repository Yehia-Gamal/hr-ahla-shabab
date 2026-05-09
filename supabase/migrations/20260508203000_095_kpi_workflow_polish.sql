-- 095_kpi_workflow_polish
-- Safe alignment for strict KPI workflow and UI polish.
-- No destructive operations. This marker tells the app that the release expects:
-- employee self evaluation -> direct manager -> HR -> executive secretary/technical -> executive director.

create table if not exists public.database_migration_status (
  name text primary key,
  status text not null default 'APPLIED',
  applied_at timestamptz not null default now(),
  notes text
);

create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  description text,
  updated_at timestamptz not null default now()
);

insert into public.database_migration_status (name, status, applied_at, notes)
values (
  '095_kpi_workflow_polish',
  'APPLIED',
  now(),
  'KPI workflow enforced: self evaluation first, then manager, HR, executive secretary/technical review, and executive approval. UI/navbar/color polish included.'
)
on conflict (name) do update set
  status = excluded.status,
  applied_at = now(),
  notes = excluded.notes;

insert into public.system_settings (key, value, description, updated_at)
values (
  'release_095_kpi_workflow_polish',
  jsonb_build_object(
    'version', 'v31-production-hardening-095',
    'expectedPatch', '095_kpi_workflow_polish',
    'workflow', jsonb_build_array(
      'SELF_SUBMITTED',
      'MANAGER_APPROVED',
      'HR_REVIEWED',
      'SECRETARY_REVIEWED',
      'EXECUTIVE_APPROVED'
    ),
    'features', jsonb_build_array(
      'strict-kpi-self-first',
      'manager-review-after-self-only',
      'hr-only-kpi-fields-preserved',
      'secretary-executive-handoff',
      'navbar-color-polish'
    )
  ),
  'Release marker for KPI workflow polish 095.',
  now()
)
on conflict (key) do update set
  value = excluded.value,
  description = excluded.description,
  updated_at = now();
