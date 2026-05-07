-- Patch 068: Monthly HR report snapshots and export log
begin;

create table if not exists public.monthly_report_exports (
  id uuid primary key default gen_random_uuid(),
  report_month date not null,
  report_type text not null default 'FULL_HR_MONTHLY',
  generated_by uuid null references auth.users(id),
  status text not null default 'PENDING' check (status in ('PENDING','GENERATED','FAILED')),
  file_url text default '',
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  generated_at timestamptz null
);

create index if not exists idx_monthly_report_exports_month
  on public.monthly_report_exports(report_month desc, report_type);

commit;
