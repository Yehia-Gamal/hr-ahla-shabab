-- 104 QC4 Runtime Alignment Safety Patch
-- Safe to run repeatedly. Guards legacy SQL references that may not exist on fresh installs.

-- Guard legacy attendance table indexes. The current app stores punches in attendance_events/attendance_daily.
do $$
begin
  if to_regclass('public.attendance') is not null then
    create index if not exists idx_attendance_employee_date
      on public.attendance(employee_id, punch_date desc);
    create index if not exists idx_attendance_status_date
      on public.attendance(status, punch_date desc);
  end if;
end;
$$;

-- Support both legacy audit_log and current audit_logs naming without failing fresh installs.
do $$
begin
  if to_regclass('public.audit_log') is not null then
    create index if not exists idx_audit_log_created
      on public.audit_log(created_at desc);

    update public.audit_log
    set severity = 'CRITICAL'
    where action in ('USER_CREATED', 'USER_DELETED', 'ROLE_CHANGED', 'PASSWORD_RESET', 'ADMIN_LOGIN', 'BULK_EXPORT');

    create index if not exists idx_audit_log_severity
      on public.audit_log(severity, created_at desc)
      where severity in ('WARNING', 'CRITICAL');
  end if;

  if to_regclass('public.audit_logs') is not null then
    alter table public.audit_logs
      add column if not exists severity text default 'INFO'
        check (severity in ('INFO', 'WARNING', 'CRITICAL'));

    create index if not exists idx_audit_logs_created_qc4
      on public.audit_logs(created_at desc);

    update public.audit_logs
    set severity = 'CRITICAL'
    where action in ('USER_CREATED', 'USER_DELETED', 'ROLE_CHANGED', 'PASSWORD_RESET', 'ADMIN_LOGIN', 'BULK_EXPORT');

    create index if not exists idx_audit_logs_severity_qc4
      on public.audit_logs(severity, created_at desc)
      where severity in ('WARNING', 'CRITICAL');
  end if;
end;
$$;

-- Cleanup must not fail when optional archive tables are absent.
create or replace function public.cleanup_old_reports()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.report_snapshots') is not null then
    execute 'delete from public.report_snapshots where created_at < now() - interval ''6 months''';
  end if;

  if to_regclass('public.kpi_cycle_archives') is not null then
    execute 'delete from public.kpi_cycle_archives where archived_at < now() - interval ''12 months''';
  end if;
end;
$$;

-- Align operations center with the table currently used by the app: public.missions.
create or replace view public.live_operations_center as
select
  now() as generated_at,
  (select count(*) from public.employees where coalesce(is_active, true) = true) as active_employees,
  (select count(*) from public.attendance_events where created_at::date = current_date) as today_attendance_events,
  (select count(*) from public.attendance_identity_checks where requires_review = true and coalesce(review_status,'PENDING') = 'PENDING') as pending_identity_reviews,
  (select count(*) from public.leave_requests where status in ('pending_manager_review','pending_hr_review','PENDING')) as pending_leave_requests,
  (select count(*) from public.missions where status in ('pending_manager_review','pending_hr_review','PENDING')) as pending_mission_requests;

comment on view public.live_operations_center is 'Live command center counters for HR/admin/executive dashboards; QC4 aligned with missions table.';

-- Optional tracking tables, guarded for old/fresh projects.
do $$
begin
  if to_regclass('public.database_migration_status') is not null then
    insert into public.database_migration_status (name, status, applied_at, notes)
    values ('104_sql_qc4_static_runtime_alignment', 'APPLIED', now(), 'Guards legacy attendance/audit cleanup references and aligns operations center with missions table')
    on conflict (name) do update
      set status = excluded.status,
          applied_at = now(),
          notes = excluded.notes;
  end if;

  if to_regclass('public.patch_markers') is not null then
    insert into public.patch_markers(patch_key, applied_at, notes)
    values ('104_sql_qc4_static_runtime_alignment', now(), 'Guards legacy attendance/audit cleanup references and aligns operations center with missions table')
    on conflict (patch_key) do update
      set applied_at = excluded.applied_at,
          notes = excluded.notes;
  end if;
end;
$$;

notify pgrst, 'reload schema';
