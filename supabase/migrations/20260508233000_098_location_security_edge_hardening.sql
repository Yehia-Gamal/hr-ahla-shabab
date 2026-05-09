-- 098_location_security_edge_hardening
-- Safe hardening marker for live-location response precedence, Edge Function JSON errors,
-- CSP fallback, operations-gate offline readiness, and XSS-safe location rendering.
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

insert into public.database_migration_status (name, status, applied_at, notes)
values ('098_location_security_edge_hardening', 'APPLIED', now(), '098 hardening: reject/postpone beats coordinates in live-location responses, Edge Functions return JSON errors, CSP meta fallback added, operations gate SW enabled, location rendering sanitized, frontend logs gated.')
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
    'previousPatch', '097_live_location_push_smoothness_audit',
    'fixes', jsonb_build_array(
      'live-location-rejected-temporary-coordinates-not-approved',
      'live-location-local-fallback-status-precedence',
      'admin-edge-functions-json-error-wrapper',
      'employee-location-xss-safe-rendering',
      'operations-gate-service-worker-and-manifest',
      'html-csp-meta-fallback',
      'production-console-logs-gated'
    ),
    'workflow', jsonb_build_array(
      'executive-direct-live-location-request',
      'employee-send-location-or-temporary-reject',
      'manager-mobile-kpi-review',
      'hr-secretary-executive-kpi-chain'
    ),
    'appliedAt', now()
  ),
  'Release marker for security/smoothness hardening 098.',
  now()
)
on conflict (key) do update set
  value = excluded.value,
  description = excluded.description,
  updated_at = now();
