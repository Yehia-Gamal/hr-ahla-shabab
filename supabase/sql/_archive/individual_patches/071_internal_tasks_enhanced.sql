-- Patch 071: Enhanced internal tasks system
begin;

create table if not exists public.internal_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text default '',
  assigned_to uuid null,
  assigned_by uuid null,
  due_date date null,
  priority text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','URGENT')),
  status text not null default 'PENDING' check (status in ('PENDING','IN_PROGRESS','COMPLETED','CANCELLED')),
  source text default 'manual',
  metadata jsonb not null default '{}'::jsonb,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_internal_tasks_assignee_status
  on public.internal_tasks(assigned_to, status, due_date);

commit;
