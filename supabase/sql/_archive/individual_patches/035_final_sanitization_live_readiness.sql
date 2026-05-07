-- =========================================================
-- 035_final_sanitization_live_readiness.sql
-- Final sanitization + live Supabase readiness.
-- - Remove training/demo permission from production roles.
-- - Sanitize remaining seeded/patched employee display names.
-- - Add Web Push subscription tables for real mobile/browser notifications.
-- =========================================================

-- 1) Production must not expose demo/training permission.
-- role_permissions existed in older drafts only; guard it so fresh installs do not fail.
do $$
begin
  if to_regclass('public.role_permissions') is not null then
    delete from public.role_permissions
    where permission_id in (select id from public.permissions where scope = 'demo:manage');
  end if;
end $$;

delete from public.permissions where scope = 'demo:manage';

update public.roles
set permissions = array_remove(coalesce(permissions, array[]::text[]), 'demo:manage')
where 'demo:manage' = any(coalesce(permissions, array[]::text[]));

-- 2) Keep seed names generic in packaged SQL/demo data.
update public.employees set full_name = 'المدير التنفيذي', email = 'executive.director@organization.local' where employee_code = 'EMP-001';
update public.employees set full_name = 'السكرتير التنفيذي', email = 'executive.secretary@organization.local' where employee_code = 'EMP-002';
update public.employees set full_name = 'مدير مباشر رابع', email = 'direct.manager.04@organization.local' where employee_code = 'EMP-003';
update public.employees set full_name = 'مدير مباشر أول', email = 'direct.manager.01@organization.local' where employee_code = 'EMP-004';
update public.employees set full_name = 'مدير مباشر ثانٍ', email = 'direct.manager.02@organization.local' where employee_code = 'EMP-005';
update public.employees set full_name = 'مدير مباشر ثالث', email = 'direct.manager.03@organization.local' where employee_code = 'EMP-006';

-- 3) Real Web Push readiness. The Edge Function that sends notifications
-- must use VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT secrets.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  endpoint text not null unique,
  payload jsonb not null default '{}'::jsonb,
  permission text not null default 'granted',
  created_at timestamptz not null default now()
);

-- Upgrade the original 001 table shape to the real Web Push shape used by the app/function.
alter table public.push_subscriptions
  add column if not exists employee_id uuid references public.employees(id) on delete cascade,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists keys jsonb not null default '{}'::jsonb,
  add column if not exists user_agent text,
  add column if not exists platform text,
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

update public.push_subscriptions
set keys = coalesce(nullif(keys, '{}'::jsonb), payload -> 'keys', '{}'::jsonb),
    updated_at = coalesce(updated_at, created_at, now());

create table if not exists public.notification_delivery_log (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid,
  push_subscription_id uuid references public.push_subscriptions(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'QUEUED',
  provider_response jsonb,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user on public.push_subscriptions(user_id) where is_active = true;
create index if not exists idx_push_subscriptions_employee on public.push_subscriptions(employee_id) where is_active = true;
create index if not exists idx_notification_delivery_log_status on public.notification_delivery_log(status, created_at desc);

alter table public.push_subscriptions enable row level security;
alter table public.notification_delivery_log enable row level security;

drop policy if exists "Users manage own push subscriptions" on public.push_subscriptions;
create policy "Users manage own push subscriptions"
  on public.push_subscriptions
  for all
  using (user_id = auth.uid() or exists (select 1 from public.profiles p join public.roles r on r.id = p.role_id where p.id = auth.uid() and r.slug in ('admin','hr-manager','executive-secretary')))
  with check (user_id = auth.uid() or exists (select 1 from public.profiles p join public.roles r on r.id = p.role_id where p.id = auth.uid() and r.slug in ('admin','hr-manager','executive-secretary')));

drop policy if exists "Admins view notification delivery log" on public.notification_delivery_log;
create policy "Admins view notification delivery log"
  on public.notification_delivery_log
  for select
  using (exists (select 1 from public.profiles p join public.roles r on r.id = p.role_id where p.id = auth.uid() and r.slug in ('admin','hr-manager','executive-secretary')));

-- 4) Mark package readiness in settings table when present.
do $$
begin
  if to_regclass('public.system_settings') is not null then
    insert into public.system_settings (key, value, description)
    values (
      'production.final_sanitized_version',
      '"1.2.2-kpi-cycle-control"'::jsonb,
      'Final sanitized package: generic seed data, production/development config split, and Web Push readiness.'
    )
    on conflict (key) do update set value = excluded.value, description = excluded.description, updated_at = now();
  end if;
end $$;
