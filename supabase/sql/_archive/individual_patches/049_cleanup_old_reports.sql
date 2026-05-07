-- Patch 049: Auto-cleanup old temporary reports (keep 6 months)
begin;

create or replace function public.cleanup_old_reports()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.report_snapshots
  where created_at < now() - interval '6 months';

  delete from public.kpi_cycle_archives
  where archived_at < now() - interval '12 months';
$$;

-- Schedule weekly cleanup via pg_cron if available
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'hr-weekly-cleanup',
      '0 2 * * 0',
      $cron$ SELECT public.cleanup_old_reports(); $cron$
    );
  end if;
end;
$$;

commit;