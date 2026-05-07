-- ⚠️ DEPRECATED PATCH — DO NOT RUN ON NEW DEPLOYMENTS
-- This patch used hardcoded phone numbers for access control.
-- It is superseded by 041_audit_v7_security_mobile_alignment.sql which uses role-based access.
-- Kept only for historical traceability; do not include in production bundles.

-- 033 - Limit password vault visibility to Yehia's phone number only.
-- Run after patch 032.

create or replace function public.current_can_view_password_vault()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    left join public.employees e on e.id = p.employee_id
    where p.id = auth.uid()
      and (
        regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = 'PHONE_PLACEHOLDER_051'
        or right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) = 'PHONE_PLACEHOLDER_085'
        or regexp_replace(coalesce(e.phone, ''), '\D', '', 'g') = 'PHONE_PLACEHOLDER_051'
        or right(regexp_replace(coalesce(e.phone, ''), '\D', '', 'g'), 10) = 'PHONE_PLACEHOLDER_085'
      )
  );
$$;

drop policy if exists "credential_vault_full_access_read" on public.credential_vault;
drop policy if exists "credential_vault_full_access_write" on public.credential_vault;
drop policy if exists "credential_vault_yahia_read" on public.credential_vault;
create policy "credential_vault_yahia_read"
  on public.credential_vault
  for select
  to authenticated
  using (public.current_can_view_password_vault());

drop policy if exists "credential_vault_yahia_write" on public.credential_vault;
create policy "credential_vault_yahia_write"
  on public.credential_vault
  for all
  to authenticated
  using (public.current_can_view_password_vault())
  with check (public.current_can_view_password_vault());

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'database_migration_status'
      and column_name = 'patch_name'
  ) then
    insert into public.database_migration_status (patch_name, applied_at, notes)
    values ('033_limit_password_vault_to_yahia.sql', now(), 'Limits credential_vault visibility to Yehia phone PHONE_PLACEHOLDER_051.')
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
    values ('mig-033-limit-password-vault-to-yahia', '033_limit_password_vault_to_yahia.sql', 'APPLIED', now(), 'Limits credential_vault visibility to Yehia phone PHONE_PLACEHOLDER_051.')
    on conflict (id) do update
    set status = excluded.status,
        applied_at = excluded.applied_at,
        notes = excluded.notes;
  end if;
end $$;
