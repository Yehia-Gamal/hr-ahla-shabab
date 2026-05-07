-- =========================================================
-- 016 Safe Employee Roster Import Template
-- تم تنظيف هذا الملف من بيانات الموظفين الحقيقية ومن صيغة كلمات المرور المتوقعة.
-- لا تستخدم كلمات مرور مبنية على رقم الهاتف. استخدم Edge Function admin-create-user
-- لإنشاء الحسابات بكلمات مرور عشوائية، أو أرسل دعوات/روابط إعادة تعيين آمنة.
-- =========================================================

-- طريقة الاستخدام الآمنة:
-- 1) استورد الموظفين فقط إلى public.employees بعد مراجعة البيانات.
-- 2) أنشئ حسابات الدخول من لوحة الإدارة أو من Edge Function admin-create-user.
-- 3) لا تحفظ ملف Excel الحقيقي داخل المستودع أو نسخة التسليم.

create extension if not exists pgcrypto;

alter table if exists public.profiles add column if not exists phone text;

-- مثال تجريبي فقط. احذف هذا المثال قبل إدخال بيانات حقيقية.
insert into public.employees (
  employee_code,
  full_name,
  phone,
  email,
  job_title,
  role_id,
  branch_id,
  department_id,
  governorate_id,
  complex_id,
  shift_id,
  status,
  is_active,
  is_deleted,
  hire_date
)
select
  'EMP-DEMO-001',
  'موظف تجربة آمن',
  'PHONE_PLACEHOLDER_001',
  'demo.employee@ahla-shabab.local',
  'موظف تجربة',
  (select id from public.roles where slug = 'employee' limit 1),
  (select id from public.branches where code = 'MAIN' limit 1),
  (select id from public.departments where code = 'OPS' limit 1),
  (select id from public.governorates where code = 'GZ' limit 1),
  (select id from public.complexes where code = 'AHLA-MANIL' limit 1),
  (select id from public.shifts order by name limit 1),
  'ACTIVE',
  true,
  false,
  current_date
where not exists (select 1 from public.employees where employee_code = 'EMP-DEMO-001');

-- إنشاء مستخدم Auth يتم من لوحة الإدارة / Edge Function، وليس من SQL مباشر داخل auth.users.
