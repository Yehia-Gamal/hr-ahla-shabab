-- 096_kpi_automation_mobile_reports
-- Safe alignment for KPI automation, manager mobile review, HR monthly center,
-- executive KPI report, and smart cycle locking.
-- No destructive operations.

create table if not exists public.database_migration_status (
  name text primary key,
  status text not null default 'APPLIED',
  applied_at timestamptz not null default now(),
  notes text
);

create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  description text,
  updated_at timestamptz not null default now()
);

insert into public.database_migration_status (name, status, applied_at, notes)
values ('096_kpi_automation_mobile_reports','APPLIED',now(),'KPI 096: manager mobile KPI review, HR monthly KPI center, executive KPI report, stage reminders, and smart cycle lock after day 25.')
on conflict (name) do update set status = excluded.status, applied_at = now(), notes = excluded.notes;

insert into public.system_settings (key, value, description, updated_at)
values ('release_096_kpi_automation_mobile_reports', jsonb_build_object('version','v31-production-hardening-096','expectedPatch','096_kpi_automation_mobile_reports','previousPatch','095_kpi_workflow_polish','workflow',jsonb_build_array('SELF_SUBMITTED','MANAGER_APPROVED','HR_REVIEWED','SECRETARY_REVIEWED','EXECUTIVE_APPROVED'),'features',jsonb_build_array('manager-mobile-kpi-center','hr-monthly-kpi-control-center','executive-kpi-pdf-csv-report','stage-based-kpi-notifications','smart-kpi-cycle-lock-after-day-25','navbar-color-polish-096'),'appliedAt',now()), 'Release marker for KPI automation/mobile/reporting 096.', now())
on conflict (key) do update set value = excluded.value, description = excluded.description, updated_at = now();
