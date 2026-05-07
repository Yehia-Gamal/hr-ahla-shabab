-- =========================================================
-- Patch: إصلاح أدوار Profiles وربطها بجدول Employees
-- شغّل هذا الملف في Supabase SQL Editor إذا ظهر للمستخدم دور خاطئ
-- مثل: باحث/مدخل بيانات بدلاً من المدير/الأدمن.
-- =========================================================

update public.profiles p
set employee_id = e.id,
    full_name = coalesce(nullif(e.full_name, ''), p.full_name),
    role_id = e.role_id,
    branch_id = e.branch_id,
    department_id = e.department_id,
    governorate_id = e.governorate_id,
    complex_id = e.complex_id,
    status = 'ACTIVE',
    updated_at = now()
from public.employees e
where lower(p.email) = lower(e.email)
  and e.is_deleted = false
  and (
    p.employee_id is distinct from e.id
    or p.role_id is distinct from e.role_id
    or p.branch_id is distinct from e.branch_id
    or p.department_id is distinct from e.department_id
  );

-- تأكيد أن الأدوار العليا لها صلاحية كاملة.
update public.roles
set permissions = array['*'], active = true, updated_at = now()
where slug in ('admin', 'executive', 'executive-secretary', 'hr-manager');

-- فحص سريع بعد التنفيذ.
select p.email,
       p.full_name,
       r.slug as role_slug,
       r.name as role_name,
       r.permissions
from public.profiles p
left join public.roles r on r.id = p.role_id
order by p.updated_at desc;
