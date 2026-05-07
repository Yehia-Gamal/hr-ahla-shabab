-- 031 - Supabase password vault for visible admin-issued temporary passwords.
-- Run after patch 030.

create table if not exists public.credential_vault (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  employee_id text,
  email text,
  phone text,
  temporary_password text not null,
  status text not null default 'PHONE_LOGIN_READY',
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_credential_vault_user_created
  on public.credential_vault(user_id, created_at desc);

create index if not exists idx_credential_vault_employee
  on public.credential_vault(employee_id);

alter table public.credential_vault enable row level security;

drop policy if exists "credential_vault_full_access_read" on public.credential_vault;
create policy "credential_vault_full_access_read"
  on public.credential_vault
  for select
  to authenticated
  using (public.current_is_full_access());

drop policy if exists "credential_vault_full_access_write" on public.credential_vault;
create policy "credential_vault_full_access_write"
  on public.credential_vault
  for all
  to authenticated
  using (public.current_is_full_access())
  with check (public.current_is_full_access());

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'database_migration_status'
      and column_name = 'patch_name'
  ) then
    insert into public.database_migration_status (patch_name, applied_at, notes)
    values ('031_supabase_password_vault.sql', now(), 'Adds credential_vault table for admin-visible issued temporary passwords.')
    on conflict (patch_name) do update
    set applied_at = excluded.applied_at,
        notes = excluded.notes;
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'database_migration_status'
      and column_name = 'name'
  ) then
    insert into public.database_migration_status (id, name, status, applied_at, notes)
    values ('mig-031-supabase-password-vault', '031_supabase_password_vault.sql', 'APPLIED', now(), 'Adds credential_vault table for admin-visible issued temporary passwords.')
    on conflict (id) do update
    set status = excluded.status,
        applied_at = excluded.applied_at,
        notes = excluded.notes;
  end if;
end $$;
