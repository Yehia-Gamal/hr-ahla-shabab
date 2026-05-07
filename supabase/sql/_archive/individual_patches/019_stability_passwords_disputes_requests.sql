-- =========================================================
-- 019 Stability Pack: request payload compatibility, dispute committee workflow,
-- and temporary-password reset support notes.
-- =========================================================

-- لجنة حل المشاكل والخلافات حسب الهيكل الإداري:
-- مدير مباشر ثالث + مدير مباشر ثانٍ + مدير مباشر أول + السكرتير التنفيذي + المدير التنفيذي.
-- يتم إرسال الإشعارات من التطبيق عند إنشاء dispute_cases، وهذا الـ patch يضيف حقولًا مساعدة إن لم تكن موجودة.

alter table if exists public.dispute_cases
  add column if not exists assigned_committee_employee_ids uuid[] default '{}',
  add column if not exists escalation_path text default 'اللجنة ← السكرتير التنفيذي ← المدير التنفيذي المدير التنفيذي',
  add column if not exists resolved_at timestamptz;

alter table if exists public.leave_requests
  add column if not exists workflow jsonb not null default '[]'::jsonb;

alter table if exists public.missions
  add column if not exists workflow jsonb not null default '[]'::jsonb;

-- توافق مع الواجهة عند إدخال طلبات الإجازة أو المأموريات من تطبيق الموظف.
create index if not exists idx_leave_requests_employee_status on public.leave_requests(employee_id, status);
create index if not exists idx_missions_employee_status on public.missions(employee_id, status);
create index if not exists idx_dispute_cases_employee_status on public.dispute_cases(employee_id, status);

-- ملاحظة أمان:
-- Supabase Auth لا يسمح بقراءة كلمات المرور الأصلية، وهذا صحيح أمنيًا.
-- خزنة كلمات المرور في الواجهة تعرض كلمات المرور المؤقتة في الوضع المحلي فقط،
-- أما في الإنتاج فيتم إصدار كلمة مؤقتة جديدة عبر Edge Function admin-update-user.
