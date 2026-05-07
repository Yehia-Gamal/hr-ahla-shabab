-- =========================================================
-- 011 Advanced UI/UX diagnostics + single complex settings + rejected punch logging support
-- Safe patch for testing. Does not delete .git, .temp, or emergency admin files.
-- =========================================================

-- 1) Single complex/branch production coordinates
update public.branches
set
  name = 'مجمع منيل شيحة',
  address = 'مجمع منيل شيحة - الجيزة',
  latitude = 29.95109939158933,
  longitude = 31.238741920853883,
  geofence_radius_meters = 300,
  max_accuracy_meters = 500,
  active = true,
  is_deleted = false,
  updated_at = now()
where id = (select id from public.branches order by created_at nulls last limit 1);

insert into public.branches (code, name, address, latitude, longitude, geofence_radius_meters, max_accuracy_meters, active, is_deleted)
select 'AHLA-MANIL', 'مجمع منيل شيحة', 'مجمع منيل شيحة - الجيزة', 29.95109939158933, 31.238741920853883, 300, 500, true, false
where not exists (select 1 from public.branches);

update public.complexes
set name = 'مجمع منيل شيحة', active = true, is_deleted = false, updated_at = now()
where id = (select id from public.complexes order by created_at nulls last limit 1);

insert into public.complexes (code, name, active, is_deleted)
select 'CX-AHLA-MANIL', 'مجمع منيل شيحة', true, false
where not exists (select 1 from public.complexes);

-- 2) Auto-link profiles to employees by matching e-mail.
update public.profiles p
set
  employee_id = e.id,
  full_name = coalesce(nullif(p.full_name, ''), e.full_name),
  role_id = coalesce(p.role_id, e.role_id),
  branch_id = coalesce(p.branch_id, e.branch_id),
  department_id = coalesce(p.department_id, e.department_id),
  governorate_id = coalesce(p.governorate_id, e.governorate_id),
  complex_id = coalesce(p.complex_id, e.complex_id),
  status = 'ACTIVE',
  updated_at = now()
from public.employees e
where lower(p.email) = lower(e.email)
  and (p.employee_id is null or p.employee_id <> e.id);

update public.employees e
set user_id = p.id, updated_at = now()
from public.profiles p
where p.employee_id = e.id
  and (e.user_id is null or e.user_id <> p.id);

-- 3) Ensure rejected punch rows can be reviewed through attendance_events.
-- This table already supports status='REJECTED', requires_review=true, geofence_status, distance, and accuracy.
create index if not exists idx_attendance_events_rejected_review
on public.attendance_events (requires_review, status, event_at desc)
where requires_review = true or status = 'REJECTED';

-- 4) Keep all employees active in this simplified single-branch model.
update public.employees
set status = 'ACTIVE', is_active = true, is_deleted = false, updated_at = now()
where is_deleted is distinct from true;

