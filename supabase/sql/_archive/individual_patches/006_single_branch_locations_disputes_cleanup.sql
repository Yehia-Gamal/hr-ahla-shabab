-- =========================================================
-- Patch 006 — Single Branch + Live Location Requests + Complaint Flow
-- تاريخ التنفيذ: 27 أبريل 2026
-- =========================================================

-- 1) اعتماد مجمع واحد فقط بإحداثيات منيل شيحة الصحيحة
update public.governorates
set name = 'الجيزة'
where code in ('GZ', 'GIZ') or name ilike '%جيزة%';

update public.complexes
set name = 'مجمع منيل شيحة'
where code in ('AHLA-MANIL', 'CX-AHLA-MANIL') or name ilike '%منيل%';

update public.branches
set name = 'مجمع منيل شيحة',
    address = 'مجمع منيل شيحة - الجيزة',
    latitude = 29.95109939158933,
    longitude = 31.238741920853883,
    geofence_radius_meters = 300,
    max_accuracy_meters = 2000,
    active = true,
    is_deleted = false
where code in ('MAIN', 'AHLA-MANIL') or name ilike '%منيل%';

-- 2) تثبيت أن كل الموظفين نشطون ومرتبطون بالمجمع الواحد
update public.employees
set status = 'ACTIVE',
    is_active = true,
    branch_id = coalesce(branch_id, (select id from public.branches where code in ('MAIN','AHLA-MANIL') or name ilike '%منيل%' order by created_at nulls last limit 1)),
    complex_id = coalesce(complex_id, (select id from public.complexes where code in ('AHLA-MANIL','CX-AHLA-MANIL') or name ilike '%منيل%' order by created_at nulls last limit 1)),
    governorate_id = coalesce(governorate_id, (select id from public.governorates where code in ('GZ','GIZ') or name ilike '%جيزة%' order by created_at nulls last limit 1)),
    shift_id = null
where is_deleted is not true;

-- 3) تبسيط طلبات المواقع: لا سبب ولا غرض مطلوب من الواجهة
alter table public.location_requests
  alter column purpose set default 'فتح الموقع وإرسال اللوكيشن المباشر',
  alter column request_reason set default '';

update public.location_requests
set purpose = 'فتح الموقع وإرسال اللوكيشن المباشر',
    request_reason = ''
where purpose is null or trim(purpose) = '' or request_reason is not null;

-- 4) توحيد حالة الشكاوى الجديدة لتذهب للجنة مباشرة
alter table public.dispute_cases
  alter column status set default 'IN_REVIEW',
  alter column severity set default 'MEDIUM';

-- 5) صلاحيات أساسية للموظف لاستخدام الشكاوى وإرسال الموقع
insert into public.permissions (scope, name)
values
  ('disputes:create', 'تسجيل شكوى ذاتية'),
  ('location:self', 'إرسال موقعي الحالي')
on conflict (scope) do update set name = excluded.name;

update public.roles
set permissions = array(
  select distinct unnest(coalesce(public.roles.permissions, '{}'::text[]) || array['dashboard:view','attendance:self','kpi:self','disputes:create','location:self'])
)
where slug = 'employee' or key = 'EMPLOYEE';

-- 6) ملاحظة تشغيلية:
-- بعد تشغيل هذا الملف افتح tools/reset-cache.html لمسح الكاش ثم أعد فتح النظام.
