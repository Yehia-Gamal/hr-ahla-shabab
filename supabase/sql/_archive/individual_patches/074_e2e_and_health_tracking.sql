-- Patch 074: E2E smoke test and health tracking log
begin;

create table if not exists public.system_health_checks (
  id uuid primary key default gen_random_uuid(),
  check_code text not null,
  status text not null check (status in ('PASS','WARN','FAIL')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_system_health_checks_code_time
  on public.system_health_checks(check_code, created_at desc);

commit;
