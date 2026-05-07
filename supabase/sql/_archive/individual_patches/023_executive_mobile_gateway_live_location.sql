-- =========================================================
-- 023 Executive Mobile + Secure Gateway + Live Location Requests
-- Adds: live location request/response workflow, admin access logs,
-- executive view logs, and permissions used by the new UI pack.
-- =========================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------
-- Tables
-- ---------------------------------------------------------
create table if not exists public.live_location_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  requested_by_user_id uuid references auth.users(id) on delete set null,
  requested_by_employee_id uuid references public.employees(id) on delete set null,
  requested_by_name text,
  reason text not null default 'متابعة تنفيذية مباشرة',
  precision text not null default 'HIGH',
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','EXPIRED','CANCELLED')),
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
  status text not null check (status in ('APPROVED','REJECTED')),
  latitude double precision,
  longitude double precision,
  accuracy_meters numeric,
  captured_at timestamptz,
  responded_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_access_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_employee_id uuid references public.employees(id) on delete set null,
  action text not null,
  route text,
  result text,
  user_agent text,
  ip_address inet,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.executive_views (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_employee_id uuid references public.employees(id) on delete set null,
  employee_id uuid references public.employees(id) on delete set null,
  route text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_live_location_requests_employee on public.live_location_requests(employee_id, created_at desc);
create index if not exists idx_live_location_requests_status on public.live_location_requests(status, created_at desc);
create index if not exists idx_live_location_responses_employee on public.live_location_responses(employee_id, responded_at desc);
create index if not exists idx_admin_access_logs_actor on public.admin_access_logs(actor_user_id, created_at desc);
create index if not exists idx_executive_views_actor on public.executive_views(actor_user_id, created_at desc);

-- ---------------------------------------------------------
-- Permissions seed
-- ---------------------------------------------------------
insert into public.permissions (scope, name)
values
  ('executive:mobile', 'المتابعة التنفيذية من الموبايل'),
  ('live-location:request', 'طلب الموقع المباشر من الموظف'),
  ('live-location:respond', 'الرد على طلب الموقع المباشر'),
  ('admin-gateway:access', 'الدخول من بوابة التشغيل')
on conflict (scope) do update set name = excluded.name;

-- Give full-access roles access to the new scopes.
update public.roles
set permissions = (
  select array_agg(distinct p)
  from unnest(coalesce(permissions, '{}'::text[]) || array['executive:mobile','live-location:request','admin-gateway:access']::text[]) as p
)
where ('*' = any(coalesce(permissions, '{}'::text[])))
   or lower(coalesce(key, slug, name, '')) in ('admin','super-admin','super_admin','executive','executive-secretary','hr-manager')
   or coalesce(name,'') in ('مدير النظام','المدير التنفيذي','السكرتير التنفيذي','مدير موارد بشرية');

-- Employee role can respond to requests that target their own employee profile.
update public.roles
set permissions = (
  select array_agg(distinct p)
  from unnest(coalesce(permissions, '{}'::text[]) || array['attendance:self','location:self','live-location:respond']::text[]) as p
)
where lower(coalesce(key, slug, name, '')) in ('employee','role-employee')
   or coalesce(name,'') = 'موظف';

-- ---------------------------------------------------------
-- RLS
-- ---------------------------------------------------------
alter table public.live_location_requests enable row level security;
alter table public.live_location_responses enable row level security;
alter table public.admin_access_logs enable row level security;
alter table public.executive_views enable row level security;

drop policy if exists live_location_requests_select on public.live_location_requests;
create policy live_location_requests_select on public.live_location_requests
for select using (
  public.has_permission('live-location:request')
  or employee_id = public.current_employee_id()
  or requested_by_employee_id = public.current_employee_id()
);

drop policy if exists live_location_requests_insert on public.live_location_requests;
create policy live_location_requests_insert on public.live_location_requests
for insert with check (public.has_permission('live-location:request'));

drop policy if exists live_location_requests_update on public.live_location_requests;
create policy live_location_requests_update on public.live_location_requests
for update using (
  public.has_permission('live-location:request')
  or employee_id = public.current_employee_id()
) with check (
  public.has_permission('live-location:request')
  or employee_id = public.current_employee_id()
);

drop policy if exists live_location_responses_select on public.live_location_responses;
create policy live_location_responses_select on public.live_location_responses
for select using (
  public.has_permission('live-location:request')
  or employee_id = public.current_employee_id()
);

drop policy if exists live_location_responses_insert on public.live_location_responses;
create policy live_location_responses_insert on public.live_location_responses
for insert with check (employee_id = public.current_employee_id() or public.current_is_full_access());

drop policy if exists admin_access_logs_select on public.admin_access_logs;
create policy admin_access_logs_select on public.admin_access_logs
for select using (public.has_permission('audit:view') or public.has_permission('settings:manage'));

drop policy if exists admin_access_logs_insert on public.admin_access_logs;
create policy admin_access_logs_insert on public.admin_access_logs
for insert with check (auth.uid() is not null);

drop policy if exists executive_views_select on public.executive_views;
create policy executive_views_select on public.executive_views
for select using (public.has_permission('audit:view') or public.has_permission('executive:mobile'));

drop policy if exists executive_views_insert on public.executive_views;
create policy executive_views_insert on public.executive_views
for insert with check (public.has_permission('executive:mobile'));
