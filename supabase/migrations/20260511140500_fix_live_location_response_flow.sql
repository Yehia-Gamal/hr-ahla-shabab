-- Fix live-location request/response statuses used by the runtime.
-- The mobile employee flow updates pending requests to APPROVED, POSTPONED,
-- REJECTED_TEMPORARY, EXPIRED, or SUPERSEDED. Older constraints allowed only a
-- smaller set and caused REST 400 errors when employees answered requests.

begin;

alter table if exists public.employee_locations
  add column if not exists status text not null default 'ACTIVE',
  add column if not exists captured_at timestamptz;

update public.employee_locations
set captured_at = coalesce(captured_at, created_at, now())
where captured_at is null;

create index if not exists idx_employee_locations_employee_captured
  on public.employee_locations(employee_id, captured_at desc, created_at desc);

alter table if exists public.live_location_requests
  drop constraint if exists live_location_requests_status_check;

alter table if exists public.live_location_requests
  add constraint live_location_requests_status_check
  check (status = any (array[
    'PENDING',
    'APPROVED',
    'POSTPONED',
    'REJECTED',
    'REJECTED_TEMPORARY',
    'EXPIRED',
    'CANCELLED',
    'SUPERSEDED',
    'FAILED'
  ]::text[]));

alter table if exists public.live_location_responses
  drop constraint if exists live_location_responses_status_check;

alter table if exists public.live_location_responses
  add constraint live_location_responses_status_check
  check (status = any (array[
    'APPROVED',
    'POSTPONED',
    'REJECTED',
    'REJECTED_TEMPORARY',
    'FAILED'
  ]::text[]));

commit;
