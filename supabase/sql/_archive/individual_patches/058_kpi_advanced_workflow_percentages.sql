-- Patch 058: Advanced KPI workflow with percentage sliders and staged approvals
begin;

create table if not exists public.kpi_cycles (
  id uuid primary key default gen_random_uuid(),
  cycle_name text not null,
  month_key text not null unique,
  status text not null default 'closed',
  employee_opened_at timestamptz,
  employee_closes_at timestamptz,
  hr_opened_at timestamptz,
  manager_opened_at timestamptz,
  manager_deadline_at timestamptz,
  secretary_reviewed_at timestamptz,
  executive_approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.kpi_evaluations
  add column if not exists cycle_id uuid references public.kpi_cycles(id),
  add column if not exists cycle_name text,
  add column if not exists target_percent numeric default 0,
  add column if not exists efficiency_percent numeric default 0,
  add column if not exists conduct_percent numeric default 0,
  add column if not exists initiatives_percent numeric default 0,
  add column if not exists attendance_percent numeric default 0,
  add column if not exists quran_percent numeric default 0,
  add column if not exists prayer_percent numeric default 0,
  add column if not exists weighted_total numeric default 0,
  add column if not exists hr_notes text,
  add column if not exists manager_notes text,
  add column if not exists secretary_notes text,
  add column if not exists manager_deadline_at timestamptz,
  add column if not exists pdf_exported_at timestamptz;

create or replace function public.calculate_kpi_weighted_total(
  p_target numeric,
  p_efficiency numeric,
  p_conduct numeric,
  p_initiatives numeric,
  p_attendance numeric,
  p_quran numeric,
  p_prayer numeric
) returns numeric language sql immutable as $$
  select round((coalesce(p_target,0) * 40 + coalesce(p_efficiency,0) * 20 + coalesce(p_conduct,0) * 5 + coalesce(p_initiatives,0) * 5 + coalesce(p_attendance,0) * 20 + coalesce(p_quran,0) * 5 + coalesce(p_prayer,0) * 5) / 100, 2);
$$;

create index if not exists idx_kpi_evaluations_status_cycle on public.kpi_evaluations(status, cycle_id, employee_id);

commit;
