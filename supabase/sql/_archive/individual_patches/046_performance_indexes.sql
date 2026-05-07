-- Patch 046: Performance indexes for frequently queried columns
begin;

-- Attendance indexes
create index if not exists idx_attendance_employee_date
  on public.attendance(employee_id, punch_date desc);

create index if not exists idx_attendance_status_date
  on public.attendance(status, punch_date desc);

-- Notifications unread
create index if not exists idx_notifications_user_unread
  on public.notifications(user_id, is_read, created_at desc)
  where is_read = false;

-- KPI evaluations cycle
create index if not exists idx_kpi_evaluations_cycle
  on public.kpi_evaluations(cycle_id, employee_id, status);

-- Audit log ordering by created date
create index if not exists idx_audit_log_created
  on public.audit_log(created_at desc);

-- Pending leave requests
create index if not exists idx_leave_requests_pending
  on public.leave_requests(status, created_at desc)
  where status = 'PENDING';

-- Live location responses by employee and time
create index if not exists idx_live_location_employee_time
  on public.live_location_responses(employee_id, created_at desc);

commit;