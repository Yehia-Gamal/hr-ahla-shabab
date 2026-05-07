-- =========================================================
-- 038 KPI Cycle Control + Stage Reports
-- نسخة الويب: v1.2.2-kpi-cycle-control
-- الهدف:
-- 1) تثبيت نافذة التقييم من يوم 20 إلى 25.
-- 2) إضافة أعمدة إغلاق/قفل دورة KPI.
-- 3) إضافة View لمتابعة مراحل الاعتماد من الموظف حتى المدير التنفيذي.
-- 4) إضافة مؤشرات تنبيه للمتأخرين حسب المرحلة.
-- =========================================================

create table if not exists public.kpi_cycles (
  id text primary key,
  name text not null,
  starts_on date,
  ends_on date,
  due_on date,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.kpi_cycles
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by_user_id uuid,
  add column if not exists final_report_generated_at timestamptz,
  add column if not exists window_start_day int default 20,
  add column if not exists window_end_day int default 25,
  add column if not exists submission_deadline_day int default 25;

alter table if exists public.kpi_evaluations
  add column if not exists self_submitted_at timestamptz,
  add column if not exists manager_approved_at timestamptz,
  add column if not exists hr_reviewed_at timestamptz,
  add column if not exists secretary_reviewed_at timestamptz,
  add column if not exists executive_approved_at timestamptz,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by_user_id uuid,
  add column if not exists escalation_note text;

update public.kpi_cycles
set window_start_day = coalesce(window_start_day, 20),
    window_end_day = coalesce(window_end_day, 25),
    submission_deadline_day = coalesce(submission_deadline_day, 25)
where true;

update public.kpi_evaluations
set self_submitted_at = coalesce(self_submitted_at, submitted_at)
where status in ('SELF_SUBMITTED', 'MANAGER_APPROVED', 'HR_REVIEWED', 'SECRETARY_REVIEWED', 'EXECUTIVE_APPROVED', 'APPROVED')
  and self_submitted_at is null;

create or replace view public.kpi_cycle_stage_report as
select
  kc.id as cycle_id,
  kc.name as cycle_name,
  kc.starts_on,
  kc.ends_on,
  kc.due_on,
  kc.status as cycle_status,
  count(ke.id) as total_evaluations,
  count(*) filter (where ke.status = 'DRAFT') as draft_count,
  count(*) filter (where ke.status = 'SELF_SUBMITTED') as waiting_manager_count,
  count(*) filter (where ke.status = 'MANAGER_APPROVED') as waiting_hr_count,
  count(*) filter (where ke.status = 'HR_REVIEWED') as waiting_secretary_count,
  count(*) filter (where ke.status = 'SECRETARY_REVIEWED') as waiting_executive_count,
  count(*) filter (where ke.status in ('EXECUTIVE_APPROVED', 'APPROVED')) as final_approved_count,
  round(avg(ke.total_score)::numeric, 2) as average_score
from public.kpi_cycles kc
left join public.kpi_evaluations ke on ke.cycle_id = kc.id
group by kc.id, kc.name, kc.starts_on, kc.ends_on, kc.due_on, kc.status;

create or replace view public.kpi_employee_stage_report as
select
  ke.id,
  ke.cycle_id,
  ke.employee_id,
  e.full_name as employee_name,
  ke.manager_employee_id,
  m.full_name as manager_name,
  ke.status,
  case ke.status
    when 'DRAFT' then 'لم يبدأ'
    when 'SELF_SUBMITTED' then 'بانتظار المدير المباشر'
    when 'MANAGER_APPROVED' then 'بانتظار HR'
    when 'HR_REVIEWED' then 'بانتظار السكرتير التنفيذي'
    when 'SECRETARY_REVIEWED' then 'بانتظار المدير التنفيذي'
    when 'EXECUTIVE_APPROVED' then 'اعتماد نهائي'
    when 'APPROVED' then 'اعتماد نهائي'
    else coalesce(ke.status, 'مسودة')
  end as stage_label,
  ke.total_score,
  ke.grade,
  ke.rating,
  ke.self_submitted_at,
  ke.manager_approved_at,
  ke.hr_reviewed_at,
  ke.secretary_reviewed_at,
  ke.executive_approved_at,
  ke.locked_at
from public.kpi_evaluations ke
left join public.employees e on e.id = ke.employee_id
left join public.employees m on m.id = ke.manager_employee_id;

do $$
begin
  if to_regclass('public.settings') is not null then
    insert into public.settings (key, value)
    values
      ('web_production_version', '"1.2.2-kpi-cycle-control"'::jsonb),
      ('kpi_cycle_control_patch', '"038_kpi_cycle_control_reports.sql"'::jsonb)
    on conflict (key) do update set value = excluded.value;
  elsif to_regclass('public.system_settings') is not null then
    insert into public.system_settings (key, value)
    values
      ('web_production_version', '"1.2.2-kpi-cycle-control"'::jsonb),
      ('kpi_cycle_control_patch', '"038_kpi_cycle_control_reports.sql"'::jsonb)
    on conflict (key) do update set value = excluded.value;
  end if;
end $$;

-- ملاحظة: منع إرسال الموظف/المدير خارج نافذة 20-25 مطبق في طبقة الويب،
-- وعند الإنتاج يمكن إضافة RPC/Trigger صارم إذا رغبت في منع أي كتابة مباشرة من خارج الواجهة.
