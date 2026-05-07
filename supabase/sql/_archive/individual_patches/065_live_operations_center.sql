-- Patch 065: Live Operations Center views and summaries
begin;

create or replace view public.live_operations_center as
select
  now() as generated_at,
  (select count(*) from public.employees where coalesce(is_active, true) = true) as active_employees,
  (select count(*) from public.attendance_events where created_at::date = current_date) as today_attendance_events,
  (select count(*) from public.attendance_identity_checks where requires_review = true and review_decision is null) as pending_identity_reviews,
  (select count(*) from public.leave_requests where status in ('pending_manager_review','pending_hr_review','PENDING')) as pending_leave_requests,
  (select count(*) from public.missions where status in ('pending_manager_review','pending_hr_review','PENDING')) as pending_mission_requests;

comment on view public.live_operations_center is 'Live command center counters for HR/admin/executive dashboards.';
commit;
