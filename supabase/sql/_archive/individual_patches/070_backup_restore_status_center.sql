-- Patch 070: Backup and restore status center
begin;

create table if not exists public.backup_restore_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('BACKUP','RESTORE','VERIFY')),
  status text not null default 'PENDING' check (status in ('PENDING','RUNNING','SUCCESS','FAILED','CANCELLED')),
  started_by uuid null references auth.users(id),
  file_url text default '',
  size_bytes bigint default 0,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz null
);

create index if not exists idx_backup_restore_jobs_status
  on public.backup_restore_jobs(status, created_at desc);

commit;
