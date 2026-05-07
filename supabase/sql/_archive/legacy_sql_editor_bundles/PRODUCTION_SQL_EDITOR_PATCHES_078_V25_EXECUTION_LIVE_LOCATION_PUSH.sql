-- =========================================================
-- 078 V25 Execution: safe internal notifications + push runtime hardening
-- Safe/idempotent. Run after patch 077.
-- =========================================================

begin;

alter table if exists public.notifications
  add column if not exists route text default '',
  add column if not exists data jsonb not null default '{}'::jsonb,
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

create table if not exists public.notification_delivery_log (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references public.notifications(id) on delete set null,
  push_subscription_id uuid references public.push_subscriptions(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'PENDING',
  provider_response jsonb not null default '{}'::jsonb,
  error text default '',
  created_at timestamptz not null default now()
);

create unique index if not exists push_subscriptions_endpoint_hash_idx
  on public.push_subscriptions(endpoint_hash)
  where endpoint_hash <> '';
create index if not exists idx_push_subscriptions_employee_active
  on public.push_subscriptions(employee_id, is_active, status);
create index if not exists idx_push_subscriptions_user_active
  on public.push_subscriptions(user_id, is_active, status);
create index if not exists idx_notifications_employee_created
  on public.notifications(employee_id, created_at desc);
create index if not exists idx_notifications_user_created
  on public.notifications(user_id, created_at desc);

create or replace function public.safe_create_notification(
  p_user_id uuid default null,
  p_employee_id uuid default null,
  p_title text default 'تنبيه',
  p_body text default '',
  p_type text default 'INFO',
  p_route text default '',
  p_data jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_allowed boolean := false;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  v_allowed := coalesce(public.current_is_full_access(), false)
    or coalesce(public.has_any_permission(array['notifications:manage','alerts:manage','live-location:request','executive:report']), false)
    or (p_user_id is not null and p_user_id = auth.uid())
    or (p_employee_id is not null and p_employee_id = public.current_employee_id());

  if not v_allowed then
    raise exception 'FORBIDDEN_NOTIFICATION_CREATE';
  end if;

  insert into public.notifications(user_id, employee_id, title, body, type, status, is_read, route, data, created_at)
  values (p_user_id, p_employee_id, nullif(p_title, ''), coalesce(p_body, ''), coalesce(nullif(p_type, ''), 'INFO'), 'UNREAD', false, coalesce(p_route, ''), coalesce(p_data, '{}'::jsonb), now())
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.safe_create_notification(uuid, uuid, text, text, text, text, jsonb) to authenticated;

alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_delivery_log enable row level security;

drop policy if exists "notifications_v25_read_scope" on public.notifications;
create policy "notifications_v25_read_scope"
  on public.notifications
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or employee_id = public.current_employee_id()
    or public.current_is_full_access()
    or public.has_any_permission(array['notifications:manage','alerts:manage','executive:report'])
  );

drop policy if exists "notifications_v25_update_scope" on public.notifications;
create policy "notifications_v25_update_scope"
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

drop policy if exists "notifications_v25_insert_scope" on public.notifications;
create policy "notifications_v25_insert_scope"
  on public.notifications
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    or employee_id = public.current_employee_id()
    or public.current_is_full_access()
    or public.has_any_permission(array['notifications:manage','alerts:manage','live-location:request','executive:report'])
  );

drop policy if exists "push_subscriptions_v25_scope" on public.push_subscriptions;
create policy "push_subscriptions_v25_scope"
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

drop policy if exists "notification_delivery_log_v25_admin_read" on public.notification_delivery_log;
create policy "notification_delivery_log_v25_admin_read"
  on public.notification_delivery_log
  for select
  to authenticated
  using (public.current_is_full_access() or public.has_any_permission(array['notifications:manage','alerts:manage','executive:report']));

insert into public.database_migration_status (name, status, notes)
values ('078_v25_execution_live_location_push', 'APPLIED', 'Safe notification RPC and push runtime columns aligned for v25')
on conflict (name) do update set status = excluded.status, notes = excluded.notes, applied_at = now();

commit;
