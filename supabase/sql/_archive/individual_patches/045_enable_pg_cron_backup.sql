-- Patch 045: Enable pg_cron backup schedule placeholder
-- Requires enabling pg_cron in Supabase Dashboard before running scheduled jobs.
begin;

create extension if not exists pg_cron;

create table if not exists public.backup_run_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'scheduled',
  status text not null default 'PENDING',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.run_auto_backup()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.backup_run_log(kind, status, details)
  values ('scheduled', 'RECORDED', jsonb_build_object('note', 'External backup runner should export data from Supabase storage/database.'));
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ahla-shabab-hr-auto-backup', '0 2 * * *', $$select public.run_auto_backup();$$);
  end if;
exception when duplicate_object then
  null;
end $$;

commit;
