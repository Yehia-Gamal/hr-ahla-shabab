-- Patch 055: Anti-spoofing, browser install id, liveness, and risk escalation signals
begin;

alter table if exists public.attendance_identity_checks
  add column if not exists browser_install_id text,
  add column if not exists branch_qr_challenge_id uuid,
  add column if not exists branch_qr_status text default 'NOT_REQUIRED',
  add column if not exists liveness_status text default 'NOT_CHECKED',
  add column if not exists location_trust jsonb default '{}'::jsonb,
  add column if not exists anti_spoofing_flags text[] default '{}'::text[];

alter table if exists public.attendance_events
  add column if not exists browser_install_id text,
  add column if not exists branch_qr_status text,
  add column if not exists branch_qr_challenge_id uuid,
  add column if not exists anti_spoofing_flags text[] default '{}'::text[];

create table if not exists public.attendance_risk_escalations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete cascade,
  attendance_event_id uuid references public.attendance_events(id) on delete cascade,
  escalation_level text not null check (escalation_level in ('HR_REVIEW','MANAGER_NOTICE','EXECUTIVE_NOTICE')),
  reason text not null,
  risk_score numeric default 0,
  risk_flags text[] default '{}'::text[],
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id)
);

alter table public.attendance_risk_escalations enable row level security;

drop policy if exists "reviewers_read_risk_escalations" on public.attendance_risk_escalations;
create policy "reviewers_read_risk_escalations"
  on public.attendance_risk_escalations
  for select
  using (public.has_app_permission('attendance:review') or public.has_app_permission('users:manage'));

create index if not exists idx_attendance_identity_browser_install
  on public.attendance_identity_checks(browser_install_id, created_at desc);

create index if not exists idx_risk_escalations_employee_date
  on public.attendance_risk_escalations(employee_id, created_at desc);

create or replace function public.create_attendance_risk_escalation(
  p_employee_id uuid,
  p_attendance_event_id uuid,
  p_risk_score numeric,
  p_risk_flags text[] default '{}'::text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_level text := 'HR_REVIEW';
  v_id uuid;
  v_recent_count int;
begin
  select count(*) into v_recent_count
  from public.attendance_risk_escalations
  where employee_id = p_employee_id
    and created_at >= now() - interval '30 days';
  if v_recent_count >= 2 then
    v_level := 'EXECUTIVE_NOTICE';
  elsif v_recent_count >= 1 then
    v_level := 'MANAGER_NOTICE';
  end if;
  insert into public.attendance_risk_escalations(employee_id, attendance_event_id, escalation_level, reason, risk_score, risk_flags)
  values (p_employee_id, p_attendance_event_id, v_level, 'Repeated or high-risk attendance identity signal', p_risk_score, p_risk_flags)
  returning id into v_id;
  return v_id;
end;
$$;

commit;
