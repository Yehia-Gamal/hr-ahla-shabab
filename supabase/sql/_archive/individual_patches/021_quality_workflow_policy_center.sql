-- =========================================================
-- 021 Quality / Workflow / Policy Center
-- Adds operational hardening tables for maintenance runs, SLA escalations,
-- employee policies, policy acknowledgements, and committee actions.
-- Safe to run more than once.
-- =========================================================

create extension if not exists pgcrypto;

create table if not exists public.employee_policies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'GENERAL',
  version text not null default '1.0',
  body text not null default '',
  requires_acknowledgement boolean not null default true,
  status text not null default 'ACTIVE' check (status in ('DRAFT','ACTIVE','ARCHIVED')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.policy_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.employee_policies(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  policy_version text,
  acknowledged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(policy_id, employee_id)
);

create table if not exists public.workflow_escalations (
  id uuid primary key default gen_random_uuid(),
  fingerprint text unique,
  source_kind text not null,
  source_id uuid,
  employee_id uuid references public.employees(id) on delete set null,
  target_employee_ids uuid[] not null default '{}',
  reason text not null default '',
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED','IGNORED')),
  created_by_user_id uuid references auth.users(id) on delete set null,
  closed_by_user_id uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.maintenance_runs (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Maintenance Run',
  before_score numeric,
  after_score numeric,
  repair jsonb not null default '{}'::jsonb,
  workflow jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.committee_actions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.dispute_cases(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  action_type text not null default 'NOTE',
  decision text not null default '',
  note text not null default '',
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_policy_ack_employee on public.policy_acknowledgements(employee_id);
create index if not exists idx_workflow_escalations_status on public.workflow_escalations(status, created_at desc);
create index if not exists idx_maintenance_runs_created on public.maintenance_runs(created_at desc);
create index if not exists idx_committee_actions_case on public.committee_actions(case_id, created_at desc);

alter table public.employee_policies enable row level security;
alter table public.policy_acknowledgements enable row level security;
alter table public.workflow_escalations enable row level security;
alter table public.maintenance_runs enable row level security;
alter table public.committee_actions enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_is_full_access();
$$;

drop policy if exists employee_policies_select on public.employee_policies;
create policy employee_policies_select on public.employee_policies
for select using (status <> 'ARCHIVED' or public.is_admin());

drop policy if exists employee_policies_admin_write on public.employee_policies;
create policy employee_policies_admin_write on public.employee_policies
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists policy_ack_select on public.policy_acknowledgements;
create policy policy_ack_select on public.policy_acknowledgements
for select using (public.is_admin() or employee_id = public.current_employee_id());

drop policy if exists policy_ack_insert_self on public.policy_acknowledgements;
create policy policy_ack_insert_self on public.policy_acknowledgements
for insert with check (public.is_admin() or employee_id = public.current_employee_id());

drop policy if exists policy_ack_update_admin on public.policy_acknowledgements;
create policy policy_ack_update_admin on public.policy_acknowledgements
for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists workflow_escalations_admin on public.workflow_escalations;
create policy workflow_escalations_admin on public.workflow_escalations
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists maintenance_runs_admin on public.maintenance_runs;
create policy maintenance_runs_admin on public.maintenance_runs
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists committee_actions_select on public.committee_actions;
create policy committee_actions_select on public.committee_actions
for select using (
  public.is_admin()
  or employee_id = public.current_employee_id()
  or exists (
    select 1 from public.dispute_cases dc
    where dc.id = committee_actions.case_id
      and dc.employee_id = public.current_employee_id()
  )
);

drop policy if exists committee_actions_insert_committee on public.committee_actions;
create policy committee_actions_insert_committee on public.committee_actions
for insert with check (public.is_admin() or employee_id = public.current_employee_id());

insert into public.employee_policies (id, title, category, version, body, requires_acknowledgement, status)
values
  ('00000000-0000-0000-0000-000000021001', 'سياسة الحضور والانصراف', 'ATTENDANCE', '1.0', 'الالتزام بتسجيل الحضور والانصراف من الموقع المعتمد، وأي بصمة خارج النطاق تحتاج مراجعة الإدارة.', true, 'ACTIVE'),
  ('00000000-0000-0000-0000-000000021002', 'سياسة لجنة حل المشاكل والخلافات', 'DISPUTES', '1.0', 'تُرفع الشكاوى إلى اللجنة المختصة، ويتم التنسيق أو التصعيد للمدير التنفيذي عبر السكرتير التنفيذي عند الحاجة.', true, 'ACTIVE'),
  ('00000000-0000-0000-0000-000000021003', 'سياسة حماية البيانات وكلمات المرور', 'SECURITY', '1.0', 'كلمات المرور المؤقتة لا تُشارك إلا مع صاحب الحساب، ويجب تغييرها بعد أول دخول. لا يتم تداول بيانات الموظفين خارج النظام.', true, 'ACTIVE')
on conflict (id) do update set
  title = excluded.title,
  category = excluded.category,
  version = excluded.version,
  body = excluded.body,
  requires_acknowledgement = excluded.requires_acknowledgement,
  status = excluded.status,
  updated_at = now();
