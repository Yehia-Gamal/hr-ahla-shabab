-- =========================================================
-- 034_final_lockdown_cleanup.sql
-- Final lockdown cleanup for web production handoff.
-- Goals:
-- 1) Keep Demo/Training permission out of every non-admin role.
-- 2) Keep executive roles unable to reach technical/admin-only areas.
-- 3) Keep storage private where it contains attendance selfies or attachments.
-- 4) Add final app-version marker for auditability.
-- =========================================================

-- Admin may still own every permission through '*'. Non-admin roles must not carry demo/system permissions.
update public.roles
set permissions = array_remove(array_remove(array_remove(array_remove(coalesce(permissions, array[]::text[]), 'demo:manage'), 'settings:manage'), 'database:migrations'), 'backup:auto')
where slug <> 'admin';

-- Executive roles remain read/decision/mobile only; no hidden full-admin or users management.
update public.roles
set permissions = array[
  'executive:mobile', 'employees:view', 'attendance:view', 'requests:view',
  'reports:export', 'live-location:request', 'sensitive:approve'
]::text[]
where slug = 'executive';

update public.roles
set permissions = array[
  'executive:mobile', 'employees:view', 'attendance:view', 'requests:view',
  'reports:export', 'live-location:request'
]::text[]
where slug = 'executive-secretary';

-- Keep sensitive storage private. Avatars may remain public for browser display unless you choose signed URLs later.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('punch-selfies', 'punch-selfies', false, 3145728, array['image/png','image/jpeg','image/webp']),
  ('employee-attachments', 'employee-attachments', false, 8388608, null)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Tighten upload policies without breaking authenticated browser uploads.
drop policy if exists "selfies_upload_auth" on storage.objects;
create policy "selfies_upload_auth" on storage.objects
for insert to authenticated
with check (bucket_id = 'punch-selfies' and (owner = auth.uid() or owner is null));

drop policy if exists "attachments_upload_auth" on storage.objects;
create policy "attachments_upload_auth" on storage.objects
for insert to authenticated
with check (bucket_id = 'employee-attachments' and (owner = auth.uid() or owner is null));

drop policy if exists "attachments_update_owner_or_admin" on storage.objects;
create policy "attachments_update_owner_or_admin" on storage.objects
for update to authenticated
using (bucket_id = 'employee-attachments' and (owner = auth.uid() or public.current_is_full_access()))
with check (bucket_id = 'employee-attachments' and (owner = auth.uid() or public.current_is_full_access()));

drop policy if exists "attachments_delete_admin_only" on storage.objects;
create policy "attachments_delete_admin_only" on storage.objects
for delete to authenticated
using (bucket_id = 'employee-attachments' and public.current_is_full_access());

-- Store a final deployment marker in system settings when the table exists.
do $$
begin
  if to_regclass('public.system_settings') is not null then
    insert into public.system_settings(key, value, description)
    values ('web_production_version', '"1.2.2-kpi-cycle-control"'::jsonb, 'Final web production lockdown package version')
    on conflict (key) do update set value = excluded.value, description = excluded.description, updated_at = now();
  end if;
end $$;
