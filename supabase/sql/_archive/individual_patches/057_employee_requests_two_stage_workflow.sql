-- Patch 057: Two-stage approval workflow for leaves and missions
begin;

-- workflow statuses include: pending_manager_review, pending_hr_review, manager_rejected, hr_approved, hr_rejected

alter table if exists public.leave_requests
  add column if not exists workflow_status text default 'pending_manager_review',
  add column if not exists direct_manager_id uuid,
  add column if not exists manager_reviewed_at timestamptz,
  add column if not exists manager_decision text,
  add column if not exists manager_note text,
  add column if not exists hr_reviewed_at timestamptz,
  add column if not exists hr_decision text,
  add column if not exists hr_note text,
  add column if not exists final_status text;

alter table if exists public.missions
  add column if not exists workflow_status text default 'pending_manager_review',
  add column if not exists direct_manager_id uuid,
  add column if not exists manager_reviewed_at timestamptz,
  add column if not exists manager_decision text,
  add column if not exists manager_note text,
  add column if not exists hr_reviewed_at timestamptz,
  add column if not exists hr_decision text,
  add column if not exists hr_note text,
  add column if not exists final_status text;

create index if not exists idx_leave_requests_workflow_status on public.leave_requests(workflow_status, created_at desc);
create index if not exists idx_missions_workflow_status on public.missions(workflow_status, created_at desc);

commit;
