-- 104 Credential Vault + SQL Alignment Safety Patch
-- Safe to run repeatedly. Ensures fresh projects have credential_vault before legacy encryption guards reference it.

create extension if not exists pgcrypto;

create table if not exists public.credential_vault (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  email text default '',
  phone text default '',
  temporary_password text,
  temp_password text,
  encrypted_password bytea,
  encrypted_temporary_password bytea,
  status text not null default 'PHONE_LOGIN_READY',
  note text default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.credential_vault enable row level security;
create index if not exists idx_credential_vault_user on public.credential_vault(user_id);
create index if not exists idx_credential_vault_employee on public.credential_vault(employee_id);
create index if not exists idx_credential_vault_status on public.credential_vault(status);

drop policy if exists credential_vault_role_guard_select on public.credential_vault;
create policy credential_vault_role_guard_select
  on public.credential_vault
  for select
  to authenticated
  using (public.current_can_view_password_vault());

insert into public.database_migration_status (name, status, applied_at, notes)
values ('104_credential_vault_sql_alignment', 'APPLIED', now(), 'Ensures credential_vault exists for fresh project SQL runs')
on conflict (name) do update
  set status = excluded.status,
      applied_at = now(),
      notes = excluded.notes;

notify pgrst, 'reload schema';
