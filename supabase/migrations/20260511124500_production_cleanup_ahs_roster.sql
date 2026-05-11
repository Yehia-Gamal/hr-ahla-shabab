-- Production cleanup: keep the AHS roster and remove non-core support tables.
-- Run after the bundled SQL has created schema, permissions, and roster rows.

begin;

delete from public.employees
where coalesce(employee_code, '') !~ '^AHS-[0-9]{3}$';

update public.employees e
set
  is_active = true,
  is_deleted = false,
  status = 'ACTIVE',
  roster_source = coalesce(nullif(e.roster_source, ''), 'production_ahs_roster'),
  updated_at = now()
where coalesce(e.employee_code, '') ~ '^AHS-[0-9]{3}$';

delete from public.authorized_employee_roster
where coalesce(employee_code, '') !~ '^AHS-[0-9]{3}$';

drop table if exists public.cleanup_089_employee_archive cascade;
drop table if exists public.import_batches cascade;
drop table if exists public.auto_backup_runs cascade;
drop table if exists public.backup_run_log cascade;
drop table if exists public.backup_restore_jobs cascade;
drop table if exists public.payroll_exports cascade;

insert into public.database_migration_status (name, status, applied_at, notes)
values (
  '20260511_production_cleanup_ahs_roster',
  'APPLIED',
  now(),
  'Removed demo employee rows, kept AHS production roster, and dropped non-core support tables.'
)
on conflict (name) do update
  set status = excluded.status,
      notes = excluded.notes,
      applied_at = now();

insert into public.patch_markers(patch_key, applied_at, notes)
values (
  '20260511_production_cleanup_ahs_roster',
  now(),
  'Final cleanup patch for production roster and non-core tables.'
)
on conflict (patch_key) do update
  set applied_at = excluded.applied_at,
      notes = excluded.notes;

notify pgrst, 'reload schema';

commit;
