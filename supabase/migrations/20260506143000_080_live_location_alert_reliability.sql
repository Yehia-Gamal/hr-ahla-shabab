-- =========================================================
-- 080 Live Location Alert Reliability
-- Fixes: employee profile linkage, live-location realtime visibility,
-- push subscription shape, and notification read scope.
-- Safe/idempotent. Run after the current RUN_IN_SUPABASE_SQL_EDITOR.sql.
-- =========================================================

begin;

create extension if not exists pgcrypto;

-- 1) Make current_employee_id resilient even if profiles.employee_id is empty.
--    Older imports sometimes linked employees.user_id but did not backfill profiles.employee_id;
--    this broke notifications, live-location requests, RLS visibility and push targeting.
create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select coalesce(
    (
      select p.employee_id
      from public.profiles p
      where p.id = auth.uid()
        and p.employee_id is not null
      limit 1
    ),
    (
      select e.id
      from public.employees e
      where e.user_id = auth.uid()
        and coalesce(e.is_deleted, false) = false
      order by e.updated_at desc nulls last, e.created_at desc nulls last
      limit 1
    ),
    (
      select e.id
      from public.employees e
      join auth.users u on u.id = auth.uid()
      where lower(coalesce(e.email, '')) = lower(coalesce(u.email, ''))
        and coalesce(e.email, '') <> ''
        and coalesce(e.is_deleted, false) = false
      order by e.updated_at desc nulls last, e.created_at desc nulls last
      limit 1
    )
  );
$$;

grant execute on function public.current_employee_id() to authenticated;

-- 2) Backfill profile employee links for existing accounts using user_id first, then email.
with matched as (
  select distinct on (p.id)
    p.id as profile_id,
    e.id as employee_id,
    e.full_name,
    e.phone,
    e.email,
    e.photo_url,
    e.role_id,
    e.branch_id,
    e.department_id,
    e.governorate_id,
    e.complex_id
  from public.profiles p
  join public.employees e
    on e.user_id = p.id
    or (
      coalesce(e.email, '') <> ''
      and coalesce(p.email, '') <> ''
      and lower(e.email) = lower(p.email)
    )
  where coalesce(e.is_deleted, false) = false
  order by p.id, case when e.user_id = p.id then 0 else 1 end, e.updated_at desc nulls last, e.created_at desc nulls last
)
update public.profiles p
set employee_id = matched.employee_id,
    full_name = coalesce(nullif(matched.full_name, ''), p.full_name),
    phone = coalesce(nullif(matched.phone, ''), p.phone),
    email = coalesce(nullif(matched.email, ''), p.email),
    avatar_url = coalesce(nullif(matched.photo_url, ''), p.avatar_url),
    role_id = coalesce(matched.role_id, p.role_id),
    branch_id = coalesce(matched.branch_id, p.branch_id),
    department_id = coalesce(matched.department_id, p.department_id),
    governorate_id = coalesce(matched.governorate_id, p.governorate_id),
    complex_id = coalesce(matched.complex_id, p.complex_id),
    status = 'ACTIVE',
    updated_at = now()
from matched
where p.id = matched.profile_id;

-- 3) Ensure live-location and notification tables exist/are aligned for the runtime.
create table if not exists public.live_location_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  requested_by_user_id uuid references auth.users(id) on delete set null,
  requested_by_employee_id uuid references public.employees(id) on delete set null,
  requested_by_name text,
  reason text not null default 'متابعة تنفيذية مباشرة',
  precision text not null default 'HIGH',
  status text not null default 'PENDING',
  expires_at timestamptz,
  responded_at timestamptz,
  response_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.live_location_responses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.live_location_requests(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  requested_by_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'APPROVED',
  latitude double precision,
  longitude double precision,
  accuracy_meters numeric,
  captured_at timestamptz,
  responded_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);

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
    last_seen_at = coalesce(last_seen_at, updated_at, created_at, now()),
    updated_at = now()
where endpoint is not null;

create unique index if not exists push_subscriptions_endpoint_hash_idx
  on public.push_subscriptions(endpoint_hash)
  where endpoint_hash <> '';
create index if not exists idx_push_subscriptions_employee_active
  on public.push_subscriptions(employee_id, is_active, status);
create index if not exists idx_push_subscriptions_user_active
  on public.push_subscriptions(user_id, is_active, status);
create index if not exists idx_live_location_requests_employee_status
  on public.live_location_requests(employee_id, status, created_at desc);
create index if not exists idx_live_location_responses_employee_created
  on public.live_location_responses(employee_id, created_at desc);
create index if not exists idx_notifications_employee_created
  on public.notifications(employee_id, created_at desc);
create index if not exists idx_notifications_user_created
  on public.notifications(user_id, created_at desc);

alter table public.live_location_requests enable row level security;
alter table public.live_location_responses enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;

-- 4) RLS: employee sees their own location requests and notifications even when targeting by employee_id only.
drop policy if exists live_location_requests_select on public.live_location_requests;
create policy live_location_requests_select on public.live_location_requests
for select to authenticated using (
  public.has_permission('live-location:request')
  or employee_id = public.current_employee_id()
  or requested_by_employee_id = public.current_employee_id()
);

drop policy if exists live_location_requests_insert on public.live_location_requests;
create policy live_location_requests_insert on public.live_location_requests
for insert to authenticated with check (public.has_permission('live-location:request'));

drop policy if exists live_location_requests_update on public.live_location_requests;
create policy live_location_requests_update on public.live_location_requests
for update to authenticated using (
  public.has_permission('live-location:request')
  or employee_id = public.current_employee_id()
) with check (
  public.has_permission('live-location:request')
  or employee_id = public.current_employee_id()
);

drop policy if exists live_location_responses_select on public.live_location_responses;
create policy live_location_responses_select on public.live_location_responses
for select to authenticated using (
  public.has_permission('live-location:request')
  or employee_id = public.current_employee_id()
);

drop policy if exists live_location_responses_insert on public.live_location_responses;
create policy live_location_responses_insert on public.live_location_responses
for insert to authenticated with check (employee_id = public.current_employee_id());

drop policy if exists "notifications_v25_read_scope" on public.notifications;
create policy "notifications_v25_read_scope" on public.notifications
for select to authenticated using (
  user_id = auth.uid()
  or employee_id = public.current_employee_id()
  or public.current_is_full_access()
  or public.has_any_permission(array['notifications:manage','alerts:manage','executive:report','live-location:request'])
);

drop policy if exists "push_subscriptions_own_or_admin" on public.push_subscriptions;
create policy "push_subscriptions_own_or_admin" on public.push_subscriptions
for all to authenticated
using (
  user_id = auth.uid()
  or employee_id = public.current_employee_id()
  or public.current_is_full_access()
  or public.has_any_permission(array['notifications:manage','alerts:manage'])
)
with check (
  user_id = auth.uid()
  or employee_id = public.current_employee_id()
  or public.current_is_full_access()
  or public.has_any_permission(array['notifications:manage','alerts:manage'])
);

-- 5) Realtime: useful for future live UI, harmless if already added.
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; when undefined_object then null; when insufficient_privilege then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.live_location_requests;
exception when duplicate_object then null; when undefined_object then null; when insufficient_privilege then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.live_location_responses;
exception when duplicate_object then null; when undefined_object then null; when insufficient_privilege then null;
end $$;

-- 6) Migration marker.
create table if not exists public.database_migration_status (
  id text primary key default gen_random_uuid()::text,
  name text unique not null,
  status text not null default 'APPLIED',
  applied_at timestamptz not null default now(),
  applied_by_user_id uuid references auth.users(id),
  notes text not null default ''
);

insert into public.database_migration_status (name, status, notes)
values ('080_live_location_alert_reliability', 'APPLIED', 'Profile employee fallback + live-location alerts + push subscriptions alignment')
on conflict (name) do update set status = excluded.status, notes = excluded.notes, applied_at = now();

insert into public.system_settings (key, value, description)
values ('live_location_alert_reliability', 'true'::jsonb, 'Patch 080 applied: live location requests visible and alertable')
on conflict (key) do update set value = excluded.value, description = excluded.description, updated_at = now();

commit;
