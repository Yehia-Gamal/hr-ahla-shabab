-- 098_location_security_edge_hardening
-- Safe final audit marker for live-location response correctness, push smoothness,
-- cache/version alignment, and migration marker cleanup.
-- No destructive operations.

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

-- Correct an older package marker typo safely if the 090 migration was previously applied.
insert into public.database_migration_status (name, status, applied_at, notes)
values ('090_executive_location_selfie_live_request_hotfix', 'APPLIED', now(), 'Correct marker for executive phone, strict 300m GPS, mirrored selfie, and live-location cleanup release 090.')
on conflict (name) do update set
  status = excluded.status,
  applied_at = coalesce(public.database_migration_status.applied_at, now()),
  notes = excluded.notes;

insert into public.database_migration_status (name, status, applied_at, notes)
values ('098_location_security_edge_hardening', 'APPLIED', now(), '097 final audit: fixed temporary reject/postpone live-location status handling, deduplicated expected migration list, aligned cache/version markers, and preserved push/location diagnostics.')
on conflict (name) do update set
  status = excluded.status,
  applied_at = now(),
  notes = excluded.notes;

insert into public.system_settings (key, value, description, updated_at)
values (
  'release_098_location_security_edge_hardening',
  jsonb_build_object(
    'version', 'v31-production-hardening-098',
    'expectedPatch', '098_location_security_edge_hardening',
    'previousPatch', '096_kpi_automation_mobile_reports',
    'fixes', jsonb_build_array(
      'live-location-temporary-reject-is-not-approved',
      'live-location-postpone-remains-postponed',
      'push-diagnostics-preserved',
      'service-worker-cache-bumped',
      'migration-status-list-deduplicated'
    ),
    'workflow', jsonb_build_array(
      'executive-direct-live-location-request',
      'employee-send-location-or-temporary-reject',
      'executive-receives-response-status',
      'kpi-self-manager-hr-secretary-executive'
    ),
    'appliedAt', now()
  ),
  'Release marker for live-location/push smoothness audit 097.',
  now()
)
on conflict (key) do update set
  value = excluded.value,
  description = excluded.description,
  updated_at = now();
