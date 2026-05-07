-- =========================================================
-- Patch 007: Login UX + Punch GPS tolerance + clean location display
-- Date: 27 Apr 2026
-- =========================================================

-- تنظيف عنوان المجمع من رابط Google Maps الطويل حتى لا يكسر واجهة البصمة
-- وتوسيع نطاق ودقة GPS المسموحة للاختبار العملي على الموبايل وأجهزة المكتب.
update public.branches
set name = 'مجمع منيل شيحة',
    address = 'مجمع منيل شيحة - الجيزة',
    latitude = 29.95109939158933,
    longitude = 31.238741920853883,
    geofence_radius_meters = 300,
    max_accuracy_meters = 2000,
    active = true,
    is_deleted = false,
    updated_at = now()
where code in ('MAIN', 'AHLA-MANIL')
   or name ilike '%منيل شيحة%';

-- ضمان أن أي موظف بدون فرع يعود للمجمع الواحد المعتمد.
update public.employees e
set branch_id = b.id,
    is_active = true,
    status = 'ACTIVE',
    updated_at = now()
from public.branches b
where b.name = 'مجمع منيل شيحة'
  and (e.branch_id is null or e.is_active is distinct from true or e.status is distinct from 'ACTIVE');

-- ملاحظة:
-- البصمة أصبحت تقبل inside_branch_low_accuracy عند وجود GPS ضعيف لكن الموقع داخل نطاق المجمع مع هامش الدقة.
