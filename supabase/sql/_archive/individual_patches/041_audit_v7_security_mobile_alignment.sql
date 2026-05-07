-- =========================================================
-- Patch 041 — Audit V7 security/mobile alignment
-- Purpose:
-- 1) Provide a role-based password-vault guard without personal phone rules.
-- 2) Encrypt legacy credential_vault plaintext columns if they exist in older deployments.
-- 3) Keep temporary_password as a legacy boolean flag and document must_change_password usage.
-- =========================================================

begin;

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists must_change_password boolean not null default true;

comment on column public.profiles.temporary_password is
  'Legacy boolean flag only. Do not store plaintext passwords here. Use must_change_password for login policy.';
comment on column public.profiles.must_change_password is
  'Boolean login policy flag that forces the user to change a temporary password after login.';

create or replace function public.current_can_view_password_vault()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    left join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
      and (
        coalesce(r.slug, '') in ('admin', 'hr-manager')
        or coalesce(r.key, '') in ('ADMIN', 'HR_MANAGER')
        or '*' = any(coalesce(r.permissions, '{}'::text[]))
        or 'users:manage' = any(coalesce(r.permissions, '{}'::text[]))
      )
  );
$$;

grant execute on function public.current_can_view_password_vault() to authenticated;

-- Upgrade older deployments that may still have public.credential_vault with plaintext fields.
do $$
declare
  vault_key text := coalesce(nullif(current_setting('app.vault_key', true), ''), nullif(current_setting('app.jwt_secret', true), ''), 'change-this-vault-key-before-production');
begin
  if to_regclass('public.credential_vault') is not null then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'credential_vault' and column_name = 'encrypted_temporary_password'
    ) then
      alter table public.credential_vault add column encrypted_temporary_password bytea;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'credential_vault' and column_name = 'temporary_password'
    ) then
      execute 'update public.credential_vault
              set encrypted_temporary_password = pgp_sym_encrypt(temporary_password::text, $1)
              where encrypted_temporary_password is null and temporary_password is not null'
      using vault_key;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'credential_vault' and column_name = 'temp_password'
    ) then
      execute 'update public.credential_vault
              set encrypted_temporary_password = pgp_sym_encrypt(temp_password::text, $1)
              where encrypted_temporary_password is null and temp_password is not null'
      using vault_key;
    end if;

    alter table public.credential_vault enable row level security;

    drop policy if exists credential_vault_role_guard_select on public.credential_vault;
    create policy credential_vault_role_guard_select
      on public.credential_vault
      for select
      using (public.current_can_view_password_vault());
  end if;
end $$;

insert into public.system_settings (key, value, description, updated_at)
values (
  'audit_v7_security_mobile_alignment',
  jsonb_build_object(
    'patch', '041_audit_v7_security_mobile_alignment.sql',
    'serviceWorkerSplit', true,
    'employeeMoreSheet', true,
    'passwordVaultRoleGuard', true,
    'legacyCredentialVaultEncrypted', true
  ),
  'Tracks Audit V7 hardening: scoped service workers, employee mobile navigation, and role-based password vault guard.',
  now()
)
on conflict (key) do update set value = excluded.value, description = excluded.description, updated_at = now();

commit;
