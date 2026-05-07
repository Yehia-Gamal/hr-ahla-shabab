-- Update the current employee roster from "بيانات الموظفين.xlsx".
-- Run after patch 029. It preserves employee IDs/codes and only updates names,
-- phones, job titles, roles, departments, and direct managers.

begin;

create temp table tmp_ahla_roster_030 (
  employee_code text primary key,
  full_name text not null,
  phone text,
  job_title text,
  role_slug text not null,
  department_code text not null,
  manager_code text,
  status text not null,
  is_active boolean not null,
  is_deleted boolean not null
) on commit drop;

insert into tmp_ahla_roster_030 (employee_code, full_name, phone, job_title, role_slug, department_code, manager_code, status, is_active, is_deleted)
values
  ('EMP-001', 'Demo Employee 001', 'PHONE_PLACEHOLDER_050', 'المدير لتنفيذي للجمعية', 'executive', 'EXEC', null, 'ACTIVE', true, false),
  ('EMP-002', 'Demo Employee 002', 'PHONE_PLACEHOLDER_051', 'السكرتير التنفيذي + تكنولوجيا المعلومات (IT) والبرمجة', 'executive-secretary', 'EXEC', 'EMP-001', 'ACTIVE', true, false),
  ('EMP-006', 'Demo Employee 003', 'PHONE_PLACEHOLDER_052', 'مدير تشغيل 1', 'manager', 'MGT', 'EMP-001', 'ACTIVE', true, false),
  ('EMP-010', 'Demo Employee 004', 'PHONE_PLACEHOLDER_053', 'مسؤول اللجنة الطبية', 'employee', 'OPS', 'EMP-006', 'ACTIVE', true, false),
  ('EMP-004', 'Demo Employee 005', 'PHONE_PLACEHOLDER_054', 'مسؤول الموارد البشرية + الاعلام', 'manager', 'HR', 'EMP-001', 'ACTIVE', true, false),
  ('EMP-005', 'Demo Employee 006', 'PHONE_PLACEHOLDER_055', 'مدير تشغيل 2', 'manager', 'MGT', 'EMP-001', 'ACTIVE', true, false),
  ('EMP-012', 'Demo Employee 007', 'PHONE_PLACEHOLDER_056', 'مسؤول لجنة أسرة كريمة', 'manager', 'MGT', 'EMP-006', 'ACTIVE', true, false),
  ('EMP-008', 'Demo Employee 008', 'PHONE_PLACEHOLDER_057', 'ادارة اللوجيستك', 'manager', 'MGT', 'EMP-001', 'ACTIVE', true, false),
  ('EMP-020', 'Demo Employee 009', 'PHONE_PLACEHOLDER_058', 'موظف مشتريات', 'employee', 'OPS', 'EMP-008', 'ACTIVE', true, false),
  ('EMP-022', 'Demo Employee 010', 'PHONE_PLACEHOLDER_059', 'سائق العربية عزيزة', 'employee', 'OPS', 'EMP-008', 'ACTIVE', true, false),
  ('EMP-021', 'Demo Employee 011', 'PHONE_PLACEHOLDER_060', 'سائق العربية مسك', 'employee', 'OPS', 'EMP-008', 'ACTIVE', true, false),
  ('EMP-023', 'Demo Employee 012', 'PHONE_PLACEHOLDER_061', 'مدير الحركة سائق', 'employee', 'OPS', 'EMP-008', 'ACTIVE', true, false),
  ('EMP-019', 'Demo Employee 013', 'PHONE_PLACEHOLDER_062', 'مسؤول الاعلام', 'employee', 'OPS', 'EMP-004', 'ACTIVE', true, false),
  ('EMP-003', 'Demo Employee 014', 'PHONE_PLACEHOLDER_063', 'مدير الشؤون الادارية', 'manager', 'MGT', 'EMP-001', 'ACTIVE', true, false),
  ('EMP-014', 'Demo Employee 015', 'PHONE_PLACEHOLDER_064', 'شؤون ادارية', 'employee', 'OPS', 'EMP-003', 'ACTIVE', true, false),
  ('EMP-015', 'Demo Employee 016', 'PHONE_PLACEHOLDER_065', 'شؤون إدارية', 'employee', 'OPS', 'EMP-003', 'ACTIVE', true, false),
  ('EMP-011', 'Demo Employee 017', 'PHONE_PLACEHOLDER_066', 'مسؤول المشروعات و طلاب العلم', 'employee', 'OPS', 'EMP-006', 'ACTIVE', true, false),
  ('EMP-009', 'Demo Employee 018', 'PHONE_PLACEHOLDER_067', 'المشرف الفني لمجمع منيل شيحة', 'manager', 'MGT', 'EMP-001', 'ACTIVE', true, false),
  ('EMP-016', 'Demo Employee 019', 'PHONE_PLACEHOLDER_068', 'موظف بالمجمع', 'employee', 'OPS', 'EMP-009', 'ACTIVE', true, false),
  ('EMP-013', 'Demo Employee 020', 'PHONE_PLACEHOLDER_069', 'موظف لجنة أسرة كريمة', 'employee', 'OPS', 'EMP-012', 'ACTIVE', true, false),
  ('EMP-018', 'Demo Employee 021', 'PHONE_PLACEHOLDER_070', 'طباخ بمجمع أحلى شباب', 'employee', 'OPS', 'EMP-009', 'ACTIVE', true, false),
  ('EMP-017', 'Demo Employee 022', 'PHONE_PLACEHOLDER_071', 'موظف بالمجمع', 'employee', 'OPS', 'EMP-009', 'ACTIVE', true, false),
  ('EMP-007', 'Demo Employee 023', 'PHONE_PLACEHOLDER_049', 'مدير مباشر', 'manager', 'MGT', 'EMP-001', 'INACTIVE', false, true);

update public.employees e
set full_name = r.full_name,
    phone = r.phone,
    job_title = r.job_title,
    role_id = role_row.id,
    department_id = dept.id,
    manager_employee_id = manager.id,
    status = r.status,
    is_active = r.is_active,
    is_deleted = r.is_deleted,
    updated_at = now()
from tmp_ahla_roster_030 r
join public.roles role_row on role_row.slug = r.role_slug
left join public.departments dept on dept.code = r.department_code
left join public.employees manager on manager.employee_code = r.manager_code
where e.employee_code = r.employee_code;

update public.profiles p
set full_name = r.full_name,
    phone = r.phone,
    role_id = e.role_id,
    department_id = e.department_id,
    status = r.status,
    updated_at = now()
from tmp_ahla_roster_030 r
join public.employees e on e.employee_code = r.employee_code
where p.employee_id = e.id;

commit;
