-- =========================================================
-- 042 Authorized employee roster + phone login policy
-- Generated from: بيانات الموظفين.xlsx
-- Purpose:
--   1) اعتماد قائمة الموظفين الرسمية فقط.
--   2) ربط المدير المباشر ورقم الهاتف والمسمى الوظيفي والصورة.
--   3) تفعيل سياسة دخول الموظفين برقم الهاتف، وكلمة المرور الافتراضية = رقم الهاتف/الرقم الشخصي.
--   4) إضافة لجنة حل المشاكل والخلافات وقناة التواصل الداخلي للتذكيرات.
-- =========================================================

begin;

insert into public.permissions (scope, name)
values
  ('announcements:manage', 'إدارة قناة التواصل الداخلي'),
  ('disputes:committee', 'عضوية لجنة حل المشاكل والخلافات'),
  ('disputes:manage', 'إدارة الشكاوى وفض الخلافات')
on conflict (scope) do update set name = excluded.name;

alter table public.employees add column if not exists roster_source text default '';
alter table public.employees add column if not exists phone_login_enabled boolean not null default true;

create table if not exists public.authorized_employee_roster (
  employee_code text primary key,
  full_name text not null,
  phone text not null,
  email text not null,
  photo_url text default '',
  job_title text default '',
  role_slug text not null default 'employee',
  department_code text not null default 'OPS',
  manager_employee_code text default '',
  initial_password_policy text not null default 'PHONE_AS_PASSWORD',
  source_file text not null default 'بيانات الموظفين.xlsx',
  updated_at timestamptz not null default now()
);

with roster(employee_code, full_name, phone, email, photo_url, job_title, role_slug, department_code, manager_employee_code) as (
  values
    ('AHS-001', 'الشيخ محمد يوسف', 'PHONE_PLACEHOLDER_010', 'emp.demo010@ahla.local', 'employee-avatars/emp-executive-director.png', 'المدير لتنفيذي للجمعية', 'executive', 'EXEC', ''),
    ('AHS-002', 'يحيي جمال السبع', 'PHONE_PLACEHOLDER_083', 'emp.demo083@ahla.local', 'employee-avatars/emp-executive-secretary.png', 'السكرتير التنفيذي + تكنولوجيا المعلومات (IT) والبرمجة', 'executive-secretary', 'EXEC', 'AHS-001'),
    ('AHS-003', 'محمد ابو عمار', 'PHONE_PLACEHOLDER_084', 'emp.demo084@ahla.local', 'employee-avatars/emp-direct-manager-01.png', 'مدير تشغيل 1', 'direct-manager', 'MGT', 'AHS-001'),
    ('AHS-004', 'محمد عبدالعظيم محمد', 'PHONE_PLACEHOLDER_072', 'emp.demo072@ahla.local', 'employee-avatars/emp-xlsx-004.png', 'مسؤول اللجنة الطبية', 'direct-manager', 'MGT', 'AHS-003'),
    ('AHS-005', 'بلال محمد الشاكر', 'PHONE_PLACEHOLDER_046', 'emp.demo046@ahla.local', 'employee-avatars/emp-hr-manager.png', 'مسؤول الموارد البشرية + الاعلام', 'hr-manager', 'HR', 'AHS-001'),
    ('AHS-006', 'ياسر فتحي نور الدين', 'PHONE_PLACEHOLDER_082', 'emp.demo082@ahla.local', 'employee-avatars/emp-direct-manager-06.png', 'مدير تشغيل 2', 'direct-manager', 'MGT', 'AHS-001'),
    ('AHS-007', 'مصطفي فايد', 'PHONE_PLACEHOLDER_014', 'emp.demo014@ahla.local', 'employee-avatars/emp-xlsx-007.png', 'مدير الحسابات', 'direct-manager', 'MGT', 'AHS-001'),
    ('AHS-008', 'حامد محمود العمدة', 'PHONE_PLACEHOLDER_013', 'emp.demo013@ahla.local', 'employee-avatars/emp-direct-manager-02.png', 'مسؤول لجنة أسرة كريمة', 'direct-manager', 'MGT', 'AHS-003'),
    ('AHS-009', 'مصطفي احمد', 'PHONE_PLACEHOLDER_075', 'emp.demo075@ahla.local', 'employee-avatars/emp-direct-manager-03.png', 'ادارة اللوجيستك', 'direct-manager', 'MGT', 'AHS-001'),
    ('AHS-010', 'محمد سيد', 'PHONE_PLACEHOLDER_019', 'emp.demo019@ahla.local', 'employee-avatars/emp-xlsx-010.png', 'موظف مشتريات', 'employee', 'OPS', 'AHS-009'),
    ('AHS-011', 'حاتم محمد سالم', 'PHONE_PLACEHOLDER_074', 'emp.demo074@ahla.local', 'employee-avatars/emp-xlsx-011.png', 'سائق العربية عزيزة', 'employee', 'OPS', 'AHS-009'),
    ('AHS-012', 'ربيع محمد ابو زيد', 'PHONE_PLACEHOLDER_081', 'emp.demo081@ahla.local', '', 'سائق العربية مسك', 'employee', 'OPS', 'AHS-009'),
    ('AHS-013', 'طارق سيد إبراهيم', 'PHONE_PLACEHOLDER_012', 'emp.demo012@ahla.local', 'employee-avatars/emp-xlsx-013.png', 'مدير الحركة سائق + مطبخ المتععفين 2', 'direct-manager', 'MGT', 'AHS-009'),
    ('AHS-014', 'عمار محمد عبدالباسط', 'PHONE_PLACEHOLDER_078', 'emp.demo078@ahla.local', '', 'جرافيك ديزاينر', 'employee', 'OPS', 'AHS-005'),
    ('AHS-015', 'احمد محمد محجوب', 'PHONE_PLACEHOLDER_047', 'emp.demo047@ahla.local', 'employee-avatars/emp-direct-manager-04.png', 'مدير الشؤون الادارية', 'direct-manager', 'MGT', 'AHS-001'),
    ('AHS-016', 'عبدالله حسين حافظ', 'PHONE_PLACEHOLDER_076', 'emp.demo076@ahla.local', 'employee-avatars/emp-xlsx-016.png', 'شؤون ادارية', 'direct-manager', 'MGT', 'AHS-015'),
    ('AHS-017', 'عبد القادر جمال', 'PHONE_PLACEHOLDER_045', 'emp.demo045@ahla.local', 'employee-avatars/emp-xlsx-017.png', 'شؤون إدارية', 'direct-manager', 'MGT', 'AHS-015'),
    ('AHS-018', 'هاني احمد نصير', 'PHONE_PLACEHOLDER_018', 'emp.demo018@ahla.local', 'employee-avatars/emp-xlsx-018.png', 'مسؤول المشروعات و طلاب العلم', 'direct-manager', 'MGT', 'AHS-003'),
    ('AHS-019', 'يوسف رسمي شعبان', 'PHONE_PLACEHOLDER_007', 'emp.demo007@ahla.local', '', 'المشرف الفني لمجمع منيل شيحة', 'direct-manager', 'MGT', 'AHS-001'),
    ('AHS-020', 'اسماعيل عبدالله', 'PHONE_PLACEHOLDER_073', 'emp.demo073@ahla.local', 'employee-avatars/emp-xlsx-020.png', 'موظف بالمجمع', 'employee', 'OPS', 'AHS-019'),
    ('AHS-021', 'عبدالرحمن حسين مرعي', 'PHONE_PLACEHOLDER_079', 'emp.demo079@ahla.local', 'employee-avatars/emp-xlsx-021.png', 'موظف لجنة أسرة كريمة', 'employee', 'OPS', 'AHS-008'),
    ('AHS-022', 'محمد عبده مزار', 'PHONE_PLACEHOLDER_011', 'emp.demo011@ahla.local', '', 'طباخ بمجمع أحلى شباب', 'employee', 'OPS', 'AHS-019'),
    ('AHS-023', 'حسام عفيفي جمعة', 'PHONE_PLACEHOLDER_009', 'emp.demo009@ahla.local', '', 'موظف بالمجمع', 'employee', 'OPS', 'AHS-019'),
    ('AHS-024', 'محمد الاندونيسي', 'PHONE_PLACEHOLDER_077', 'emp.demo077@ahla.local', 'employee-avatars/emp-xlsx-024.png', 'مسؤول الدعايا', 'direct-manager', 'MGT', 'AHS-006'),
    ('AHS-025', 'ياسين طارق الباسل', 'PHONE_PLACEHOLDER_080', 'emp.demo080@ahla.local', '', 'مسؤول الدعايا', 'direct-manager', 'MGT', 'AHS-006'),
    ('AHS-026', 'عبد العزيز طارق الباسل', 'PHONE_PLACEHOLDER_008', 'emp.demo008@ahla.local', 'employee-avatars/emp-xlsx-026.png', 'مسؤول سفير + مطيخ المتعففين 3', 'direct-manager', 'MGT', 'AHS-001'),
    ('AHS-027', 'محمد عبد المنعم', 'PHONE_PLACEHOLDER_015', 'emp.demo015@ahla.local', '', 'مسؤول الاستكشاف', 'direct-manager', 'MGT', 'AHS-001'),
    ('AHS-028', 'عبداالله نصر', 'PHONE_PLACEHOLDER_020', 'emp.demo020@ahla.local', '', 'أدارة المتطوعين', 'direct-manager', 'MGT', 'AHS-006')
)
insert into public.authorized_employee_roster (
  employee_code, full_name, phone, email, photo_url, job_title, role_slug, department_code, manager_employee_code
)
select employee_code, full_name, phone, email, photo_url, job_title, role_slug, department_code, manager_employee_code
from roster
on conflict (employee_code) do update set
  full_name = excluded.full_name,
  phone = excluded.phone,
  email = excluded.email,
  photo_url = excluded.photo_url,
  job_title = excluded.job_title,
  role_slug = excluded.role_slug,
  department_code = excluded.department_code,
  manager_employee_code = excluded.manager_employee_code,
  initial_password_policy = 'PHONE_AS_PASSWORD',
  source_file = 'بيانات الموظفين.xlsx',
  updated_at = now();

with roster as (
  select * from public.authorized_employee_roster
),
default_scope as (
  select
    (select id from public.branches where coalesce(is_deleted,false)=false order by created_at nulls last limit 1) as branch_id,
    (select id from public.governorates order by created_at nulls last limit 1) as governorate_id,
    (select id from public.complexes where coalesce(is_deleted,false)=false order by created_at nulls last limit 1) as complex_id
)
insert into public.employees (
  employee_code, full_name, phone, email, photo_url, job_title,
  role_id, branch_id, department_id, governorate_id, complex_id,
  status, is_active, is_deleted, hire_date, roster_source, phone_login_enabled
)
select
  r.employee_code,
  r.full_name,
  r.phone,
  r.email,
  r.photo_url,
  r.job_title,
  role_row.id,
  ds.branch_id,
  dept.id,
  ds.governorate_id,
  ds.complex_id,
  'ACTIVE',
  true,
  false,
  current_date,
  'بيانات الموظفين.xlsx',
  true
from roster r
cross join default_scope ds
left join public.roles role_row on role_row.slug = r.role_slug
left join public.departments dept on dept.code = r.department_code
on conflict (employee_code) do update set
  full_name = excluded.full_name,
  phone = excluded.phone,
  email = excluded.email,
  photo_url = excluded.photo_url,
  job_title = excluded.job_title,
  role_id = excluded.role_id,
  branch_id = excluded.branch_id,
  department_id = excluded.department_id,
  governorate_id = excluded.governorate_id,
  complex_id = excluded.complex_id,
  status = 'ACTIVE',
  is_active = true,
  is_deleted = false,
  roster_source = 'بيانات الموظفين.xlsx',
  phone_login_enabled = true,
  updated_at = now();

with roster as (
  select * from public.authorized_employee_roster
)
update public.employees e
set manager_employee_id = manager.id,
    updated_at = now()
from roster r
left join public.employees manager on manager.employee_code = nullif(r.manager_employee_code, '')
where e.employee_code = r.employee_code;

-- اعتماد القائمة الرسمية فقط: أي employee_code خارج القائمة يتم تعطيله منطقيًا ولا يحذف سجله التاريخي.
update public.employees
set is_deleted = true,
    is_active = false,
    status = 'INACTIVE',
    updated_at = now()
where employee_code is not null
  and employee_code not in ('AHS-001', 'AHS-002', 'AHS-003', 'AHS-004', 'AHS-005', 'AHS-006', 'AHS-007', 'AHS-008', 'AHS-009', 'AHS-010', 'AHS-011', 'AHS-012', 'AHS-013', 'AHS-014', 'AHS-015', 'AHS-016', 'AHS-017', 'AHS-018', 'AHS-019', 'AHS-020', 'AHS-021', 'AHS-022', 'AHS-023', 'AHS-024', 'AHS-025', 'AHS-026', 'AHS-027', 'AHS-028');

-- ربط الصور والبيانات بأي profiles موجودة مسبقًا بنفس الهاتف/البريد.
update public.profiles p
set employee_id = e.id,
    full_name = e.full_name,
    phone = e.phone,
    email = e.email,
    avatar_url = e.photo_url,
    role_id = e.role_id,
    branch_id = e.branch_id,
    department_id = e.department_id,
    governorate_id = e.governorate_id,
    complex_id = e.complex_id,
    status = 'ACTIVE',
    temporary_password = false,
    must_change_password = false,
    updated_at = now()
from public.employees e
where (p.phone = e.phone or lower(p.email) = lower(e.email))
  and e.employee_code in ('AHS-001', 'AHS-002', 'AHS-003', 'AHS-004', 'AHS-005', 'AHS-006', 'AHS-007', 'AHS-008', 'AHS-009', 'AHS-010', 'AHS-011', 'AHS-012', 'AHS-013', 'AHS-014', 'AHS-015', 'AHS-016', 'AHS-017', 'AHS-018', 'AHS-019', 'AHS-020', 'AHS-021', 'AHS-022', 'AHS-023', 'AHS-024', 'AHS-025', 'AHS-026', 'AHS-027', 'AHS-028');

-- إعدادات توضح السياسة للإدارة والواجهة.
create table if not exists public.settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  description text default '',
  updated_at timestamptz not null default now()
);

insert into public.settings (key, value, description)
values
  ('employee_login_policy', '{"identifier":"phone","initialPassword":"same_as_phone","selfRegistration":false,"source":"بيانات الموظفين.xlsx"}'::jsonb, 'سياسة الدخول المعتمدة بعد استيراد قائمة الموظفين'),
  ('internal_communication_channel', '{"enabled":true,"push":true,"inAppSound":true,"audience":"all"}'::jsonb, 'قناة التواصل الداخلي للإعلانات والتذكيرات والتعليمات')
on conflict (key) do update set value = excluded.value, description = excluded.description, updated_at = now();

create table if not exists public.dispute_committee_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.dispute_committee_settings (key, value)
values (
  'main_committee',
  '{"name":"لجنة حل المشاكل والخلافات","members":["الشيخ محمد يوسف","يحيي جمال السبع","محمد ابو عمار","بلال محمد الشاكر","ياسر فتحي نور الدين"],"executiveEscalationTo":"الشيخ محمد يوسف","secretary":"يحيي جمال السبع"}'::jsonb
)
on conflict (key) do update set value = excluded.value, updated_at = now();

commit;
