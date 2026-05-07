-- =========================================================
-- Patch 012 — Strong HR Features
-- مراجعة البصمات المرفوضة + الأجهزة المعتمدة + التقارير + سجل الأمان
-- يحافظ على ملفات الاختبار والطوارئ ولا يحذف أي بيانات.
-- =========================================================

-- 1) توسيع جدول الحضور لدعم مراجعة البصمات المرفوضة
alter table if exists public.attendance_events
  add column if not exists review_decision text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by_user_id uuid,
  add column if not exists biometric_method text,
  add column if not exists passkey_credential_id uuid,
  add column if not exists risk_flags jsonb default '[]'::jsonb;

create index if not exists idx_attendance_events_rejected_review
  on public.attendance_events (status, requires_review, event_at desc);

create index if not exists idx_attendance_events_month_employee
  on public.attendance_events (employee_id, event_at desc);

-- 2) توسيع passkey_credentials لإدارة الأجهزة المعتمدة
alter table if exists public.passkey_credentials
  add column if not exists employee_id uuid references public.employees(id) on delete set null,
  add column if not exists label text,
  add column if not exists platform text,
  add column if not exists user_agent text,
  add column if not exists trusted boolean default true,
  add column if not exists status text default 'DEVICE_TRUSTED',
  add column if not exists trusted_at timestamptz,
  add column if not exists disabled_at timestamptz,
  add column if not exists last_used_at timestamptz;

create index if not exists idx_passkey_credentials_employee_status
  on public.passkey_credentials (employee_id, status);

-- 3) ربط الأجهزة بالمستخدم/الموظف إن كانت البيانات القديمة لا تحتوي employee_id
update public.passkey_credentials pc
set employee_id = p.employee_id
from public.profiles p
where pc.employee_id is null
  and pc.user_id = p.id
  and p.employee_id is not null;

-- 4) صلاحيات الصفحات الجديدة
insert into public.permissions (scope, name, description)
values
  ('attendance:review', 'مراجعة البصمات المرفوضة', 'اعتماد أو رفض محاولات البصمة المرفوضة'),
  ('devices:manage', 'إدارة الأجهزة المعتمدة', 'اعتماد وتعطيل مفاتيح المرور وأجهزة البصمة'),
  ('security:view', 'عرض سجل الأمان', 'مراجعة الدخول الفاشل وتغيير كلمات المرور'),
  ('demo:manage', 'إدارة وضع التدريب', 'تشغيل وضع تدريب محلي دون التأثير على Supabase')
on conflict (scope) do update
set name = excluded.name,
    description = excluded.description;

-- 5) منح المديرين/HR صلاحية مراجعة البصمات، مع ترك الأدمن كما هو
do $$
declare
  permissions_type text;
begin
  select udt_name
  into permissions_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'roles'
    and column_name = 'permissions';

  if permissions_type = '_text' then
    update public.roles
    set permissions = (
      select array_agg(distinct value)
      from unnest(coalesce(permissions, '{}'::text[]) || array['attendance:review']) as value
    )
    where lower(coalesce(slug, key, name, '')) in ('direct-manager','manager','hr-manager','hr');
  elsif permissions_type = 'jsonb' then
    update public.roles
    set permissions = (
      select jsonb_agg(distinct value)
      from jsonb_array_elements_text(coalesce(permissions, '[]'::jsonb) || '["attendance:review"]'::jsonb) as value
    )
    where lower(coalesce(slug, key, name, '')) in ('direct-manager','manager','hr-manager','hr');
  end if;
end $$;

-- 6) إعدادات افتراضية للتنبيهات والتقرير الشهري
insert into public.integration_settings (key, name, provider, enabled, status, notes)
values
  ('missing_punch_alerts', 'تنبيهات عدم تسجيل البصمة', 'internal', true, 'READY', 'تنبيه الموظفين الذين لم يسجلوا حضور اليوم'),
  ('monthly_attendance_report', 'التقرير الشهري بتصميم الجمعية', 'internal-print', true, 'READY', 'PDF عبر نافذة الطباعة من المتصفح')
on conflict (key) do update
set enabled = excluded.enabled,
    status = excluded.status,
    notes = excluded.notes;

-- 7) تثبيت إحداثيات مجمع منيل شيحة
update public.branches
set name = 'مجمع منيل شيحة',
    address = 'مجمع منيل شيحة - الجيزة',
    latitude = 29.95109939158933,
    longitude = 31.238741920853883,
    geofence_radius_meters = 300,
    max_accuracy_meters = 500,
    active = true
where id in (select id from public.branches order by created_at nulls last limit 1);
