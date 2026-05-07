-- =========================================================
-- 077 V24 Location Request + Push/CORS Runtime Alignment
-- Safe/idempotent: fixes notification 400s and push subscription shape used by Edge Functions.
-- =========================================================

begin;

alter table if exists public.notifications
  add column if not exists route text default '',
  add column if not exists push_sent_at timestamptz,
  add column if not exists push_status text default '',
  add column if not exists push_error text default '';

alter table if exists public.push_subscriptions
  add column if not exists employee_id uuid references public.employees(id) on delete cascade,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists keys jsonb not null default '{}'::jsonb,
  add column if not exists p256dh text default '',
  add column if not exists auth text default '',
  add column if not exists endpoint_hash text default '',
  add column if not exists user_agent text default '',
  add column if not exists platform text default '',
  add column if not exists permission text default 'granted',
  add column if not exists is_active boolean not null default true,
  add column if not exists status text not null default 'ACTIVE',
  add column if not exists last_seen_at timestamptz,
  add column if not exists last_sent_at timestamptz,
  add column if not exists last_error text default '',
  add column if not exists updated_at timestamptz not null default now();

update public.push_subscriptions
set keys = coalesce(nullif(keys, '{}'::jsonb), payload -> 'keys', '{}'::jsonb),
    p256dh = coalesce(nullif(p256dh, ''), payload #>> '{keys,p256dh}', keys ->> 'p256dh', ''),
    auth = coalesce(nullif(auth, ''), payload #>> '{keys,auth}', keys ->> 'auth', ''),
    endpoint_hash = coalesce(nullif(endpoint_hash, ''), md5(endpoint)),
    status = coalesce(nullif(status, ''), case when is_active then 'ACTIVE' else 'EXPIRED' end),
    last_seen_at = coalesce(last_seen_at, created_at),
    updated_at = now()
where endpoint is not null;

create unique index if not exists push_subscriptions_endpoint_hash_idx
  on public.push_subscriptions(endpoint_hash)
  where endpoint_hash <> '';
create index if not exists idx_push_subscriptions_employee_active
  on public.push_subscriptions(employee_id, is_active, status);
create index if not exists idx_push_subscriptions_user_active
  on public.push_subscriptions(user_id, is_active, status);
create index if not exists idx_notifications_employee_created
  on public.notifications(employee_id, created_at desc);

alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "notifications_live_location_insert_scope" on public.notifications;
create policy "notifications_live_location_insert_scope"
  on public.notifications
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    or employee_id = public.current_employee_id()
    or public.current_is_full_access()
    or public.has_any_permission(array['notifications:manage','alerts:manage','live-location:request','executive:report'])
  );

drop policy if exists "notifications_live_location_read_scope" on public.notifications;
create policy "notifications_live_location_read_scope"
  on public.notifications
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or employee_id = public.current_employee_id()
    or public.current_is_full_access()
    or public.has_any_permission(array['notifications:manage','alerts:manage','executive:report'])
  );

drop policy if exists "notifications_live_location_update_scope" on public.notifications;
create policy "notifications_live_location_update_scope"
  on public.notifications
  for update
  to authenticated
  using (
    user_id = auth.uid()
    or employee_id = public.current_employee_id()
    or public.current_is_full_access()
    or public.has_any_permission(array['notifications:manage','alerts:manage','executive:report'])
  )
  with check (
    user_id = auth.uid()
    or employee_id = public.current_employee_id()
    or public.current_is_full_access()
    or public.has_any_permission(array['notifications:manage','alerts:manage','executive:report'])
  );

drop policy if exists "push_subscriptions_runtime_scope" on public.push_subscriptions;
create policy "push_subscriptions_runtime_scope"
  on public.push_subscriptions
  for all
  to authenticated
  using (
    user_id = auth.uid()
    or employee_id = public.current_employee_id()
    or public.current_is_full_access()
    or public.has_any_permission(array['notifications:manage','alerts:manage','live-location:request','executive:report'])
  )
  with check (
    user_id = auth.uid()
    or employee_id = public.current_employee_id()
    or public.current_is_full_access()
    or public.has_any_permission(array['notifications:manage','alerts:manage','live-location:request','executive:report'])
  );

insert into public.database_migration_status (name, status, notes)
values ('077_v24_location_push_cors', 'APPLIED', 'Aligned notifications, push subscriptions, and live location request policies for v24')
on conflict (name) do update set status = excluded.status, notes = excluded.notes, applied_at = now();

commit;
