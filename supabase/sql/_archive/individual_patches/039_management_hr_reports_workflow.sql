-- =========================================================
-- 039 Management Structure + HR Operations + Reports Workflow
-- نسخة الويب: v1.3.0-management-hr-reports
-- الهدف:
-- 1) تثبيت صلاحيات هيكل الإدارة والفرق.
-- 2) إضافة مسار واضح للمدير المباشر وعمليات HR.
-- 3) تقوية Workflow الشكاوى والتصعيد.
-- 4) تجهيز Views للتقارير والتصدير.
-- =========================================================

insert into public.permissions (scope, name)
values
  ('organization:manage', 'إدارة هيكل الإدارة والفرق'),
  ('team:dashboard', 'لوحة الفريق للمدير المباشر'),
  ('hr:operations', 'لوحة عمليات الموارد البشرية'),
  ('disputes:escalate', 'تصعيد الشكاوى للسكرتير والتنفيذي'),
  ('reports:pdf', 'تصدير تقارير PDF/HTML'),
  ('reports:excel', 'تصدير تقارير Excel/CSV')
on conflict (scope) do update set name = excluded.name;

update public.roles
set permissions = array(select distinct unnest(coalesce(permissions, '{}') || array['organization:manage','team:dashboard','hr:operations','disputes:escalate','reports:pdf','reports:excel']))
where slug in ('admin', 'executive-secretary') or key in ('ADMIN', 'EXECUTIVE_SECRETARY');

update public.roles
set permissions = array(select distinct unnest(coalesce(permissions, '{}') || array['hr:operations','team:dashboard','disputes:escalate','reports:pdf','reports:excel']))
where slug = 'hr-manager' or key = 'HR_MANAGER';

update public.roles
set permissions = array(select distinct unnest(coalesce(permissions, '{}') || array['team:dashboard','disputes:escalate','reports:pdf','reports:excel']))
where slug in ('manager', 'direct-manager') or key in ('MANAGER', 'DIRECT_MANAGER');

update public.roles
set permissions = array(select distinct unnest(coalesce(permissions, '{}') || array['reports:pdf','reports:excel','disputes:escalate']))
where slug = 'executive' or key = 'EXECUTIVE';

alter table if exists public.employees
  add column if not exists manager_assigned_at timestamptz,
  add column if not exists manager_assignment_note text;

alter table if exists public.dispute_cases
  add column if not exists current_stage text default 'manager_review',
  add column if not exists assigned_committee_employee_ids uuid[] default '{}',
  add column if not exists secretary_reviewed_at timestamptz,
  add column if not exists executive_decision_at timestamptz,
  add column if not exists escalation_reason text;

create or replace view public.management_team_report as
select
  manager.id as manager_employee_id,
  manager.full_name as manager_name,
  manager.job_title as manager_job_title,
  count(team.id) as team_count,
  count(team.id) filter (where team.status = 'ACTIVE') as active_team_count,
  count(team.id) filter (where team.manager_employee_id is null) as missing_manager_count
from public.employees manager
left join public.roles r on r.id = manager.role_id
left join public.employees team on team.manager_employee_id = manager.id and coalesce(team.is_deleted, false) = false
where coalesce(manager.is_deleted, false) = false
  and r.slug in ('manager', 'direct-manager', 'hr-manager', 'executive', 'executive-secretary', 'admin')
group by manager.id, manager.full_name, manager.job_title;

create or replace view public.hr_operations_report as
select
  e.id as employee_id,
  e.full_name as employee_name,
  e.job_title,
  e.status,
  e.manager_employee_id,
  m.full_name as manager_name,
  case when e.manager_employee_id is null and r.slug = 'employee' then true else false end as missing_manager,
  case when e.phone is null or e.phone = '' then true else false end as missing_phone,
  case when e.email is null or e.email = '' then true else false end as missing_email
from public.employees e
left join public.employees m on m.id = e.manager_employee_id
left join public.roles r on r.id = e.role_id
where coalesce(e.is_deleted, false) = false;

create or replace view public.dispute_workflow_report as
select
  dc.id,
  dc.title,
  dc.employee_id,
  e.full_name as employee_name,
  dc.status,
  coalesce(dc.current_stage, dc.status, 'open') as current_stage,
  dc.severity as priority,
  dc.committee_decision,
  dc.escalated_to_executive,
  dc.created_at,
  dc.updated_at
from public.dispute_cases dc
left join public.employees e on e.id = dc.employee_id;

do $$
begin
  if to_regclass('public.settings') is not null then
    insert into public.settings (key, value)
    values
      ('web_production_version', '"1.3.0-management-hr-reports"'::jsonb),
      ('latest_required_patch', '"039_management_hr_reports_workflow.sql"'::jsonb)
    on conflict (key) do update set value = excluded.value;
  elsif to_regclass('public.system_settings') is not null then
    insert into public.system_settings (key, value)
    values
      ('web_production_version', '"1.3.0-management-hr-reports"'::jsonb),
      ('latest_required_patch', '"039_management_hr_reports_workflow.sql"'::jsonb)
    on conflict (key) do update set value = excluded.value;
  end if;
end $$;
