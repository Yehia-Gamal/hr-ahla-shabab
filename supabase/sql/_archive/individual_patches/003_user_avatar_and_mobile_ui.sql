-- =========================================================
-- Patch 003 — User Avatar support
-- شغّل هذا الملف في Supabase SQL Editor على قاعدة موجودة بالفعل.
-- يضيف avatar_url إلى profiles حتى يمكن حفظ صورة المستخدم المستقلة.
-- =========================================================

alter table public.profiles
  add column if not exists avatar_url text default '';

-- مزامنة أولية: لو المستخدم مربوط بموظف لديه photo_url ولا توجد صورة مستخدم، استخدم صورة الموظف كافتراض.
update public.profiles p
set avatar_url = e.photo_url
from public.employees e
where p.employee_id = e.id
  and coalesce(p.avatar_url, '') = ''
  and coalesce(e.photo_url, '') <> '';

-- التأكد من وجود Bucket avatars وسياسات التخزين الأساسية.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
for select using (bucket_id = 'avatars');

drop policy if exists "avatars_upload_auth" on storage.objects;
create policy "avatars_upload_auth" on storage.objects
for insert to authenticated
with check (bucket_id = 'avatars');
