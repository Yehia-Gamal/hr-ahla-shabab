-- Patch 059: Dispute committee privacy workflow
begin;

alter table if exists public.dispute_cases
  add column if not exists related_employee_id uuid,
  add column if not exists has_related_employee boolean default false,
  add column if not exists repeated_before boolean default false,
  add column if not exists repeated_with_same_person boolean default false,
  add column if not exists privacy_level text default 'committee_only',
  add column if not exists public_update text default 'قيد مراجعة اللجنة',
  add column if not exists escalated_to_secretary_at timestamptz,
  add column if not exists secretary_extended_until timestamptz,
  add column if not exists escalated_to_executive_at timestamptz,
  add column if not exists due_at timestamptz default (now() + interval '48 hours');

create table if not exists public.dispute_committee_minutes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.dispute_cases(id) on delete cascade,
  meeting_at timestamptz default now(),
  attendees text[] default '{}',
  summary text default '',
  decision text default '',
  notes text default '',
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_dispute_cases_committee_due on public.dispute_cases(status, due_at);
create index if not exists idx_dispute_cases_related_employee on public.dispute_cases(related_employee_id);

commit;
