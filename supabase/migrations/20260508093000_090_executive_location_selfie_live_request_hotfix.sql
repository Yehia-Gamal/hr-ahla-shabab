-- 090 Executive gateway, strict 300m geofence, and live-location request cleanup.

update public.authorized_employee_roster
set phone = '01004045849'
where employee_code = 'AHS-001'
   or (role_slug = 'executive' and full_name ilike '%محمد%');

update public.employees
set phone = '01004045849',
    email = 'emp.010040455849@ahla.local',
    user_id = 'dbf42941-5b94-4388-89cd-71df1606da3a',
    is_deleted = false,
    status = 'ACTIVE',
    updated_at = now()
where employee_code = 'EMP-6E80755D';

with target as (
  select id, role_id, branch_id, department_id, governorate_id, complex_id
  from public.employees
  where employee_code = 'EMP-6E80755D'
)
update public.profiles p
set phone = '01004045849',
    employee_id = target.id,
    role_id = target.role_id,
    branch_id = target.branch_id,
    department_id = target.department_id,
    governorate_id = target.governorate_id,
    complex_id = target.complex_id,
    status = 'ACTIVE',
    updated_at = now()
from target
where p.id = 'dbf42941-5b94-4388-89cd-71df1606da3a';

update public.branches
set latitude = 29.95109939158933,
    longitude = 31.238741920853883,
    geofence_radius_meters = 300,
    max_accuracy_meters = 90,
    updated_at = now()
where code in ('MAIN', 'AHLA-MANIL')
   or name ilike '%منيل%';

update public.live_location_requests
set status = 'EXPIRED',
    responded_at = now(),
    response_note = 'انتهت مهلة الطلب تلقائيًا أثناء تنظيف طلبات الموقع 090',
    updated_at = now()
where status = 'PENDING'
  and expires_at < now();

insert into public.database_migration_status (name, applied_at, notes)
values ('090_executive_location_selfie_live_request_hotfix', now(), 'Executive phone, strict 300m GPS, mirrored selfie, and closed live-location requests.')
on conflict (name) do update
set applied_at = excluded.applied_at,
    notes = excluded.notes;
