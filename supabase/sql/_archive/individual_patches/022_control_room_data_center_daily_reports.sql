-- =========================================================
-- 022 Control Room + Data Center + Daily Reports
-- Adds operational monitoring, smart alerts, safe import logs, and employee daily reports.
-- Run after 021_quality_workflow_policy_center.sql
-- =========================================================

create table if not exists public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete cascade,
  report_date date not null default current_date,
  achievements text not null default '',
  blockers text not null default '',
  tomorrow_plan text not null default '',
  support_needed text not null default '',
  mood text not null default 'NORMAL',
  status text not null default 'SUBMITTED',
  manager_comment text not null default '',
  reviewed_at timestamptz,
  reviewed_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, report_date)
);

create table if not exists public.smart_alerts (
  id uuid primary key default gen_random_uuid(),
  fingerprint text unique not null,
  severity text not null default 'MEDIUM',
  title text not null,
  body text not null default '',
  route text not null default 'quality-center',
  status text not null default 'OPEN',
  target_employee_ids uuid[] not null default '{}',
  resolution_note text not null default '',
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'json',
  employees_count int not null default 0,
  users_count int not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  created_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.approval_chains (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  current_step text not null default 'MANAGER',
  status text not null default 'PENDING',
  steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.system_runbooks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'GENERAL',
  steps jsonb not null default '[]'::jsonb,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.daily_reports enable row level security;
alter table public.smart_alerts enable row level security;
alter table public.import_batches enable row level security;
alter table public.approval_chains enable row level security;
alter table public.system_runbooks enable row level security;

create or replace function public.has_permission(user_id uuid, scope text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when scope = '*' then public.current_is_full_access()
    when user_id = auth.uid() then public.has_permission(scope)
    else false
  end;
$$;

do $$
begin
  create policy "daily_reports_self_or_admin" on public.daily_reports
    for all using (
      employee_id in (select employee_id from public.profiles where id = auth.uid())
      or public.has_permission(auth.uid(), 'daily-report:review')
      or public.has_permission(auth.uid(), '*')
    ) with check (
      employee_id in (select employee_id from public.profiles where id = auth.uid())
      or public.has_permission(auth.uid(), 'daily-report:review')
      or public.has_permission(auth.uid(), '*')
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "smart_alerts_admin" on public.smart_alerts
    for all using (public.has_permission(auth.uid(), 'alerts:manage') or public.has_permission(auth.uid(), 'control-room:view') or public.has_permission(auth.uid(), '*'))
    with check (public.has_permission(auth.uid(), 'alerts:manage') or public.has_permission(auth.uid(), '*'));
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "import_batches_admin" on public.import_batches
    for all using (public.has_permission(auth.uid(), 'data-center:manage') or public.has_permission(auth.uid(), '*'))
    with check (public.has_permission(auth.uid(), 'data-center:manage') or public.has_permission(auth.uid(), '*'));
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "approval_chains_admin" on public.approval_chains
    for all using (public.has_permission(auth.uid(), 'approvals:manage') or public.has_permission(auth.uid(), '*'))
    with check (public.has_permission(auth.uid(), 'approvals:manage') or public.has_permission(auth.uid(), '*'));
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "system_runbooks_admin_read" on public.system_runbooks
    for select using (public.has_permission(auth.uid(), 'settings:manage') or public.has_permission(auth.uid(), '*'));
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "system_runbooks_admin_write" on public.system_runbooks
    for all using (public.has_permission(auth.uid(), 'settings:manage') or public.has_permission(auth.uid(), '*'))
    with check (public.has_permission(auth.uid(), 'settings:manage') or public.has_permission(auth.uid(), '*'));
exception when duplicate_object then null;
end $$;

insert into public.system_runbooks (title, category, steps, status)
values ('تشغيل النظام أول مرة', 'PRODUCTION', '["تطبيق كل SQL patches", "نشر Edge Functions", "تفعيل supabase-config.js", "تشغيل Health Check", "تجربة دخول موظف وإدارة"]'::jsonb, 'ACTIVE')
on conflict do nothing;
