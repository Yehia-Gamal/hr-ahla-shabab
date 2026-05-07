-- Patch 060: Readable location labels and policy acknowledgements metadata
begin;

alter table if exists public.attendance_events
  add column if not exists address_label text,
  add column if not exists location_status text,
  add column if not exists distance_from_branch numeric,
  add column if not exists employee_note text;

alter table if exists public.employee_locations
  add column if not exists address_label text,
  add column if not exists location_status text,
  add column if not exists distance_from_branch numeric;

alter table if exists public.policy_acknowledgements
  add column if not exists device_id text,
  add column if not exists browser_install_id text,
  add column if not exists ip_hash text;

create index if not exists idx_attendance_events_location_status on public.attendance_events(location_status, event_at desc);
commit;
