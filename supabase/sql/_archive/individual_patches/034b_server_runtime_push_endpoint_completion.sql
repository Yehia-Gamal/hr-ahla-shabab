-- 034 Server runtime + Web Push endpoint completion
-- Safe/idempotent patch. Does not drop data or alter credential_vault behavior.

begin;

create table if not exists public.database_migration_status (
  name text primary key,
  applied_at timestamptz not null default now(),
  notes text default ''
);

alter table public.push_subscriptions
  add column if not exists employee_id uuid null references public.employees(id) on delete set null,
  add column if not exists endpoint_hash text default '',
  add column if not exists p256dh text default '',
  add column if not exists auth text default '',
  add column if not exists user_agent text default '',
  add column if not exists platform text default '',
  add column if not exists status text not null default 'ACTIVE',
  add column if not exists last_seen_at timestamptz,
  add column if not exists last_sent_at timestamptz,
  add column if not exists last_error text default '',
  add column if not exists updated_at timestamptz not null default now();

update public.push_subscriptions
set
  p256dh = coalesce(nullif(p256dh, ''), payload #>> '{keys,p256dh}'),
  auth = coalesce(nullif(auth, ''), payload #>> '{keys,auth}'),
  endpoint_hash = coalesce(nullif(endpoint_hash, ''), md5(endpoint)),
  last_seen_at = coalesce(last_seen_at, created_at),
  updated_at = now()
where endpoint is not null;

create unique index if not exists push_subscriptions_endpoint_hash_idx
  on public.push_subscriptions(endpoint_hash)
  where endpoint_hash <> '';

create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions(user_id);
create index if not exists push_subscriptions_employee_id_idx on public.push_subscriptions(employee_id);
create index if not exists push_subscriptions_status_idx on public.push_subscriptions(status);

alter table if exists public.attendance_events
  add column if not exists source text default '';

alter table public.notifications
  add column if not exists route text default '',
  add column if not exists push_sent_at timestamptz,
  add column if not exists push_status text default '',
  add column if not exists push_error text default '';

drop policy if exists "push_own" on public.push_subscriptions;
drop policy if exists "push_select_scope" on public.push_subscriptions;
drop policy if exists "push_insert_own" on public.push_subscriptions;
drop policy if exists "push_update_own" on public.push_subscriptions;
drop policy if exists "push_delete_own" on public.push_subscriptions;

create policy "push_select_scope"
  on public.push_subscriptions
  for select
  to authenticated
  using (user_id = auth.uid() or public.current_is_full_access() or public.can_access_employee(employee_id));

create policy "push_insert_own"
  on public.push_subscriptions
  for insert
  to authenticated
  with check (user_id = auth.uid() or public.current_is_full_access());

create policy "push_update_own"
  on public.push_subscriptions
  for update
  to authenticated
  using (user_id = auth.uid() or public.current_is_full_access())
  with check (user_id = auth.uid() or public.current_is_full_access());

create policy "push_delete_own"
  on public.push_subscriptions
  for delete
  to authenticated
  using (user_id = auth.uid() or public.current_is_full_access());

drop policy if exists "notifications_read" on public.notifications;
drop policy if exists "notifications_write" on public.notifications;
drop policy if exists "notifications_read_scope" on public.notifications;
drop policy if exists "notifications_insert_admin" on public.notifications;
drop policy if exists "notifications_update_scope" on public.notifications;
drop policy if exists "notifications_delete_admin" on public.notifications;

create policy "notifications_read_scope"
  on public.notifications
  for select
  to authenticated
  using (user_id = auth.uid() or public.current_is_full_access() or public.can_access_employee(employee_id));

create policy "notifications_insert_admin"
  on public.notifications
  for insert
  to authenticated
  with check (public.current_is_full_access() or public.has_permission('alerts:manage') or public.has_permission('dashboard:view'));

create policy "notifications_update_scope"
  on public.notifications
  for update
  to authenticated
  using (user_id = auth.uid() or public.current_is_full_access() or public.can_access_employee(employee_id))
  with check (user_id = auth.uid() or public.current_is_full_access() or public.can_access_employee(employee_id));

create policy "notifications_delete_admin"
  on public.notifications
  for delete
  to authenticated
  using (public.current_is_full_access());

-- Keep required buckets present; do not remove existing files.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 2097152, array['image/png','image/jpeg','image/webp','image/gif']),
  ('punch-selfies', 'punch-selfies', false, 3145728, array['image/png','image/jpeg','image/webp']),
  ('employee-attachments', 'employee-attachments', false, 8388608, null)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars_update_own_or_admin" on storage.objects;
create policy "avatars_update_own_or_admin"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'avatars' and (owner = auth.uid() or public.current_is_full_access()))
  with check (bucket_id = 'avatars' and (owner = auth.uid() or public.current_is_full_access()));

drop policy if exists "avatars_delete_own_or_admin" on storage.objects;
create policy "avatars_delete_own_or_admin"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'avatars' and (owner = auth.uid() or public.current_is_full_access()));

insert into public.database_migration_status (id, name, status, applied_at, notes)
values ('034_server_runtime_push_endpoint_completion', '034_server_runtime_push_endpoint_completion.sql', 'APPLIED', now(), 'Completes Web Push subscription schema, notification push status fields, storage policies, and production runtime readiness.')
on conflict (name) do update set status = excluded.status, applied_at = excluded.applied_at, notes = excluded.notes;

commit;
