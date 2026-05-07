-- 088_final_audit_alignment
-- Final release marker for package v31-production-hardening-088.
-- Safe/idempotent: only records release alignment metadata and does not alter business data.

create table if not exists public.database_migration_status (
  id text primary key default gen_random_uuid()::text,
  name text unique not null,
  status text not null default 'APPLIED',
  applied_at timestamptz not null default now(),
  applied_by_user_id uuid references auth.users(id),
  notes text not null default ''
);

insert into public.database_migration_status (name, status, notes)
values (
  '088_final_audit_alignment',
  'APPLIED',
  'Package v31-production-hardening-088: expectedPatch/cache/version alignment, migration verification alignment, and health diagnostics polish.'
)
on conflict (name) do update
set status = excluded.status,
    notes = excluded.notes,
    applied_at = now();

insert into public.system_settings (key, value, description)
values (
  'release_088_final_audit_alignment',
  jsonb_build_object('version', 'v31-production-hardening-088', 'expectedPatch', '088_final_audit_alignment', 'appliedAt', now()),
  'Final audit alignment marker for HR Ahla Shabab package 088.'
)
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();
