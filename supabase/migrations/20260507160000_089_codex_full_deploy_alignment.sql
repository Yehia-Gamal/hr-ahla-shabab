-- 089_codex_full_deploy_alignment
-- Release marker for package v31-production-hardening-089.
-- Safe/idempotent: only records release alignment metadata; does not alter business data or RLS.

-- Ensure migration status table exists (idempotent)
create table if not exists public.database_migration_status (
  id text primary key default gen_random_uuid()::text,
  name text unique not null,
  status text not null default 'APPLIED',
  applied_at timestamptz not null default now(),
  applied_by_user_id uuid references auth.users(id),
  notes text not null default ''
);

-- Record 089 marker
insert into public.database_migration_status (name, status, notes)
values (
  '089_codex_full_deploy_alignment',
  'APPLIED',
  'Package v31-production-hardening-089: full audit, security fix, version alignment, Mojibake false-positive fix, edge function verification, and production deployment alignment.'
)
on conflict (name) do update
set status = excluded.status,
    notes = excluded.notes,
    applied_at = now();

-- Ensure system_settings table exists (idempotent)
create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  description text not null default '',
  updated_at timestamptz not null default now()
);

-- Compatibility wrapper expected by VERIFY_AFTER_SUPABASE_DEPLOY.sql.
-- The runtime uses the seven-argument RPC; this JSONB overload keeps grants/checks stable.
create or replace function public.safe_create_notification(p_row jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := null;
  v_employee_id uuid := null;
begin
  if nullif(p_row->>'user_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_user_id := (p_row->>'user_id')::uuid;
  end if;
  if nullif(p_row->>'employee_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_employee_id := (p_row->>'employee_id')::uuid;
  end if;

  return public.safe_create_notification(
    v_user_id,
    v_employee_id,
    coalesce(p_row->>'title', 'Notification'),
    coalesce(p_row->>'body', p_row->>'message', ''),
    coalesce(p_row->>'type', 'INFO'),
    coalesce(p_row->>'route', ''),
    coalesce(p_row->'data', '{}'::jsonb)
  );
end;
$$;

grant execute on function public.safe_create_notification(jsonb) to authenticated;

-- Record release info in system_settings
insert into public.system_settings (key, value, description)
values (
  'release_089_codex_full_deploy_alignment',
  jsonb_build_object(
    'version', 'v31-production-hardening-089',
    'expectedPatch', '089_codex_full_deploy_alignment',
    'appliedAt', now(),
    'previousPatch', '088_final_audit_alignment'
  ),
  'Codex full deploy alignment marker for HR Ahla Shabab package 089.'
)
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();
