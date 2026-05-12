-- Sync production employee roster from the official Excel file:
-- c:\Users\Elhamd\Desktop\بيانات الموظفين.xlsx

begin;

alter table public.employees disable trigger trg_employees_prevent_duplicate_phone;
alter table public.profiles disable trigger trg_profiles_prevent_duplicate_phone;

with roster(employee_code, full_name, phone, job_title, manager_employee_code) as (
  values
    ('AHS-001', 'الشيخ محمد يوسف', '01004045849', 'المدير التنفيذي للجمعية', ''),
    ('AHS-002', 'يحيي جمال ألسبع', '01154869616', 'السكرتير التنفيذي + تكنولوجيا المعلومات (IT) والبرمجة', 'AHS-001'),
    ('AHS-003', 'محمد ابو عمار', '01226905602', 'مدير تشغيل 1', 'AHS-001'),
    ('AHS-004', 'محمد عبدالعظيم محمد', '01092701744', 'مسؤول اللجنة الطبية', 'AHS-003'),
    ('AHS-005', 'بلال محمد الشاكر', '01028403239', 'مسؤول الموارد البشرية + الاعلام', 'AHS-001'),
    ('AHS-006', 'ياسر فتحي نور الدين', '01145809595', 'مدير تشغيل 2', 'AHS-001'),
    ('AHS-007', 'مصطفي فايد', '01009052140', 'مدير الحسابات', 'AHS-001'),
    ('AHS-008', 'حامد محمود ألعمدة', '01008214530', 'مسؤول لجنة أسرة كريمة', 'AHS-003'),
    ('AHS-009', 'مصطفي احمد', '01099505229', 'ادارة اللوجيستك', 'AHS-001'),
    ('AHS-010', 'محمد سيد', '01015398047', 'موظف مشتريات', 'AHS-009'),
    ('AHS-011', 'حاتم محمد سالم', '01096842589', 'سائق العربية عزيزة', 'AHS-009'),
    ('AHS-012', 'ربيع محمد ابو زيد', '0114321080', 'سائق العربية مسك', 'AHS-009'),
    ('AHS-013', 'طارق سيد إبراهيم', '01008083891', 'مدير الحركة سائق + مطبخ المتععفين 2', 'AHS-009'),
    ('AHS-014', 'عمار محمد عبدالباسط', '01115714930', 'جرافيك ديزاينر', 'AHS-005'),
    ('AHS-015', 'احمد محمد محجوب', '01033447012', 'مدير الشؤون الادارية', 'AHS-001'),
    ('AHS-016', 'عبدالله حسين حافظ', '01110867632', 'شؤون ادارية', 'AHS-015'),
    ('AHS-017', 'عبد القادر جمال', '01024962522', 'شؤون إدارية', 'AHS-015'),
    ('AHS-018', 'هاني احمد نصير', '01012141949', 'مسؤول المشروعات و طلاب العلم', 'AHS-003'),
    ('AHS-019', 'يوسف رسمي شعبان', '01000719835', 'المشرف الفني لمجمع منيل شيحة', 'AHS-001'),
    ('AHS-020', 'اسماعيل عبدالله', '01093976980', 'موظف بالمجمع', 'AHS-019'),
    ('AHS-021', 'عبدالرحمن حسين مرعي', '01116164951', 'موظف لجنة أسرة كريمة', 'AHS-008'),
    ('AHS-022', 'محمد عبده مزار', '01004466039', 'طباخ بمجمع أحلى شباب', 'AHS-019'),
    ('AHS-023', 'حسام عفيفي  جمعة', '010023827201', 'موظف بالمجمع', 'AHS-019'),
    ('AHS-024', 'محمد الاندونيسي', '01111144881', 'مسؤول الدعايا', 'AHS-006'),
    ('AHS-025', 'ياسين طارق الباسل', '01127260359', 'مسؤول الدعايا', 'AHS-006'),
    ('AHS-026', 'عبد العزيز طارق الباسل', '01000867705', 'مسؤول سفير + مطيخ المتعففين 3', 'AHS-001'),
    ('AHS-027', 'محمد عبد المنعم', '01009919558', 'مسؤول ألاستكشاف', 'AHS-001'),
    ('AHS-028', 'عبداالله نصر', '01016664229', 'أدارة المتطوعين', 'AHS-006')
)
update public.authorized_employee_roster a
set
  full_name = r.full_name,
  phone = r.phone,
  job_title = r.job_title,
  manager_employee_code = r.manager_employee_code,
  initial_password_policy = 'GENERATED_SECURE_PASSWORD',
  source_file = 'بيانات الموظفين.xlsx',
  updated_at = now()
from roster r
where a.employee_code = r.employee_code;

with roster(employee_code, full_name, phone, job_title, manager_employee_code) as (
  values
    ('AHS-001', 'الشيخ محمد يوسف', '01004045849', 'المدير التنفيذي للجمعية', ''),
    ('AHS-002', 'يحيي جمال ألسبع', '01154869616', 'السكرتير التنفيذي + تكنولوجيا المعلومات (IT) والبرمجة', 'AHS-001'),
    ('AHS-003', 'محمد ابو عمار', '01226905602', 'مدير تشغيل 1', 'AHS-001'),
    ('AHS-004', 'محمد عبدالعظيم محمد', '01092701744', 'مسؤول اللجنة الطبية', 'AHS-003'),
    ('AHS-005', 'بلال محمد الشاكر', '01028403239', 'مسؤول الموارد البشرية + الاعلام', 'AHS-001'),
    ('AHS-006', 'ياسر فتحي نور الدين', '01145809595', 'مدير تشغيل 2', 'AHS-001'),
    ('AHS-007', 'مصطفي فايد', '01009052140', 'مدير الحسابات', 'AHS-001'),
    ('AHS-008', 'حامد محمود ألعمدة', '01008214530', 'مسؤول لجنة أسرة كريمة', 'AHS-003'),
    ('AHS-009', 'مصطفي احمد', '01099505229', 'ادارة اللوجيستك', 'AHS-001'),
    ('AHS-010', 'محمد سيد', '01015398047', 'موظف مشتريات', 'AHS-009'),
    ('AHS-011', 'حاتم محمد سالم', '01096842589', 'سائق العربية عزيزة', 'AHS-009'),
    ('AHS-012', 'ربيع محمد ابو زيد', '0114321080', 'سائق العربية مسك', 'AHS-009'),
    ('AHS-013', 'طارق سيد إبراهيم', '01008083891', 'مدير الحركة سائق + مطبخ المتععفين 2', 'AHS-009'),
    ('AHS-014', 'عمار محمد عبدالباسط', '01115714930', 'جرافيك ديزاينر', 'AHS-005'),
    ('AHS-015', 'احمد محمد محجوب', '01033447012', 'مدير الشؤون الادارية', 'AHS-001'),
    ('AHS-016', 'عبدالله حسين حافظ', '01110867632', 'شؤون ادارية', 'AHS-015'),
    ('AHS-017', 'عبد القادر جمال', '01024962522', 'شؤون إدارية', 'AHS-015'),
    ('AHS-018', 'هاني احمد نصير', '01012141949', 'مسؤول المشروعات و طلاب العلم', 'AHS-003'),
    ('AHS-019', 'يوسف رسمي شعبان', '01000719835', 'المشرف الفني لمجمع منيل شيحة', 'AHS-001'),
    ('AHS-020', 'اسماعيل عبدالله', '01093976980', 'موظف بالمجمع', 'AHS-019'),
    ('AHS-021', 'عبدالرحمن حسين مرعي', '01116164951', 'موظف لجنة أسرة كريمة', 'AHS-008'),
    ('AHS-022', 'محمد عبده مزار', '01004466039', 'طباخ بمجمع أحلى شباب', 'AHS-019'),
    ('AHS-023', 'حسام عفيفي  جمعة', '010023827201', 'موظف بالمجمع', 'AHS-019'),
    ('AHS-024', 'محمد الاندونيسي', '01111144881', 'مسؤول الدعايا', 'AHS-006'),
    ('AHS-025', 'ياسين طارق الباسل', '01127260359', 'مسؤول الدعايا', 'AHS-006'),
    ('AHS-026', 'عبد العزيز طارق الباسل', '01000867705', 'مسؤول سفير + مطيخ المتعففين 3', 'AHS-001'),
    ('AHS-027', 'محمد عبد المنعم', '01009919558', 'مسؤول ألاستكشاف', 'AHS-001'),
    ('AHS-028', 'عبداالله نصر', '01016664229', 'أدارة المتطوعين', 'AHS-006')
)
update public.employees e
set
  full_name = r.full_name,
  phone = r.phone,
  job_title = r.job_title,
  manager_employee_id = m.id,
  roster_source = 'بيانات الموظفين.xlsx',
  is_active = true,
  is_deleted = false,
  status = 'ACTIVE',
  updated_at = now()
from roster r
left join public.employees m on m.employee_code = nullif(r.manager_employee_code, '')
where e.employee_code = r.employee_code;

update public.profiles p
set
  full_name = e.full_name,
  phone = e.phone,
  avatar_url = e.photo_url,
  role_id = e.role_id,
  branch_id = e.branch_id,
  department_id = e.department_id,
  governorate_id = e.governorate_id,
  complex_id = e.complex_id,
  status = 'ACTIVE',
  updated_at = now()
from public.employees e
where p.employee_id = e.id
  and e.employee_code ~ '^AHS-[0-9]{3}$';

alter table public.employees enable trigger trg_employees_prevent_duplicate_phone;
alter table public.profiles enable trigger trg_profiles_prevent_duplicate_phone;

insert into public.database_migration_status (name, status, applied_at, notes)
values (
  '20260511_sync_employee_excel_roster',
  'APPLIED',
  now(),
  'Synced names, phones, job titles, and direct managers from the official employee Excel file.'
)
on conflict (name) do update
  set status = excluded.status,
      notes = excluded.notes,
      applied_at = now();

insert into public.patch_markers(patch_key, applied_at, notes)
values (
  '20260511_sync_employee_excel_roster',
  now(),
  'Synced official Excel roster data.'
)
on conflict (patch_key) do update
  set applied_at = excluded.applied_at,
      notes = excluded.notes;

notify pgrst, 'reload schema';

commit;
