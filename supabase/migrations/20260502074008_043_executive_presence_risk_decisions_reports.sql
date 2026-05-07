-- =========================================================
-- 043 Executive live presence + attendance risk + decisions + committee minutes + monthly PDF queue
-- Purpose:
--   1) لوحة حضور لحظية للمدير التنفيذي مع خريطة وموقع.
--   2) نظام تقييم خطر البصمة والتلاعب.
--   3) سجل قرارات إدارية رسمي مع توقيع اطلاع لكل موظف.
--   4) محاضر لجنة حل المشاكل والخلافات.
--   5) صلاحيات أدق للمدير المباشر: يرى فريقه فقط عبر RLS.
--   6) سجل تشغيل تقارير PDF شهرية تلقائية.
-- =========================================================

begin;

alter table public.attendance_events add column if not exists device_id text;
alter table public.attendance_events add column if not exists user_agent text;
alter table public.attendance_events add column if not exists source text default 'web';

insert into public.permissions (scope, name)
values
  ('executive:presence-map', 'خريطة الحضور اللحظية للمدير التنفيذي'),
  ('attendance:risk', 'مركز تقييم خطر البصمة'),
  ('decisions:manage', 'إدارة سجل القرارات الإدارية'),
  ('decisions:acknowledge', 'تأكيد الاطلاع على القرارات'),
  ('disputes:minutes', 'محاضر لجنة حل المشاكل والخلافات'),
  ('reports:monthly-pdf-auto', 'تقارير PDF شهرية تلقائية'),
  ('manager:team-only', 'قصر المدير المباشر على فريقه فقط')
on conflict (scope) do update set name = excluded.name;

update public.roles
set permissions = (
  select array(select distinct unnest(coalesce(public.roles.permissions, '{}'::text[]) || array['executive:presence-map','attendance:risk','decisions:manage','reports:monthly-pdf-auto','disputes:minutes','manager:team-only']))
)
where slug in ('admin', 'executive-secretary');

update public.roles
set permissions = (
  select array(select distinct unnest(coalesce(public.roles.permissions, '{}'::text[]) || array['executive:presence-map','attendance:risk','decisions:manage','reports:monthly-pdf-auto','disputes:minutes']))
)
where slug in ('executive');

update public.roles
set permissions = (
  select array(select distinct unnest(coalesce(public.roles.permissions, '{}'::text[]) || array['attendance:risk','decisions:manage','reports:monthly-pdf-auto','disputes:minutes']))
)
where slug in ('hr-manager');

update public.roles
set permissions = (
  select array(select distinct unnest(coalesce(public.roles.permissions, '{}'::text[]) || array['manager:team-only','decisions:acknowledge']))
)
where slug in ('direct-manager', 'employee');

create table if not exists public.attendance_risk_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete cascade,
  attendance_event_id uuid,
  risk_code text not null,
  risk_label text not null,
  risk_score integer not null default 0,
  severity text not null default 'MEDIUM',
  metadata jsonb not null default '{}'::jsonb,
  resolved boolean not null default false,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_attendance_risk_events_employee_created on public.attendance_risk_events(employee_id, created_at desc);
create index if not exists idx_attendance_risk_events_unresolved on public.attendance_risk_events(resolved, severity);

create table if not exists public.admin_decisions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  category text not null default 'ADMINISTRATIVE',
  priority text not null default 'MEDIUM',
  scope text not null default 'ALL',
  target_employee_ids uuid[] not null default '{}'::uuid[],
  requires_acknowledgement boolean not null default true,
  status text not null default 'PUBLISHED',
  issued_by_user_id uuid,
  issued_by_employee_id uuid references public.employees(id) on delete set null,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_decision_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.admin_decisions(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  user_id uuid,
  acknowledged_at timestamptz not null default now(),
  user_agent text default '',
  ip_hint text default '',
  created_at timestamptz not null default now(),
  unique(decision_id, employee_id)
);

create index if not exists idx_admin_decisions_published on public.admin_decisions(status, published_at desc);
create index if not exists idx_admin_decision_ack_employee on public.admin_decision_acknowledgements(employee_id, acknowledged_at desc);

create table if not exists public.dispute_minutes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null,
  session_at timestamptz not null default now(),
  members text[] not null default '{}'::text[],
  decision text not null default '',
  notes text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  signed_by_user_id uuid,
  signed_by_name text default '',
  signature_status text not null default 'SIGNED',
  created_at timestamptz not null default now()
);

create index if not exists idx_dispute_minutes_case_session on public.dispute_minutes(case_id, session_at desc);

create table if not exists public.monthly_pdf_report_runs (
  id uuid primary key default gen_random_uuid(),
  month text not null,
  status text not null default 'READY',
  generated_at timestamptz not null default now(),
  generated_by_user_id uuid,
  storage_path text default '',
  counts jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_monthly_pdf_report_runs_month on public.monthly_pdf_report_runs(month, generated_at desc);

create or replace function public.current_profile_employee_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select p.employee_id
  from public.profiles p
  where p.id = auth.uid()
  limit 1;
$$;

create or replace function public.current_has_any_scope(required_scopes text[])
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    left join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
      and (
        coalesce(r.slug, '') in ('admin','executive-secretary')
        or '*' = any(coalesce(r.permissions, '{}'::text[]))
        or coalesce(r.permissions, '{}'::text[]) && required_scopes
      )
  );
$$;

create or replace function public.current_can_see_employee(target_employee_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  with recursive team(id) as (
    select public.current_profile_employee_id()
    union
    select e.id
    from public.employees e
    join team t on e.manager_employee_id = t.id
    where coalesce(e.is_deleted, false) = false
  )
  select
    public.current_has_any_scope(array['employees:write','hr:operations','executive:mobile','executive:presence-map','attendance:manage','kpi:hr'])
    or target_employee_id in (select id from team);
$$;

-- Override the original employee-scope guard so direct managers never read outside their team.
create or replace function public.can_access_employee(emp_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.current_can_see_employee(emp_id);
$$;

create or replace view public.executive_presence_live as
select
  e.id as employee_id,
  e.full_name,
  e.job_title,
  e.phone,
  e.photo_url,
  e.manager_employee_id,
  m.full_name as manager_name,
  latest_event.event_at as last_attendance_at,
  latest_event.type as last_attendance_type,
  latest_event.status as last_attendance_status,
  latest_event.geofence_status,
  latest_event.requires_review,
  latest_location.latitude,
  latest_location.longitude,
  latest_location.accuracy_meters,
  latest_location.captured_at as last_location_at,
  case
    when latest_event.event_at is null then 'ABSENT'
    when coalesce(latest_event.status, '') ilike '%LATE%' then 'LATE'
    when latest_event.type = 'CHECK_OUT' then 'CHECKED_OUT'
    else 'PRESENT'
  end as today_status
from public.employees e
left join public.employees m on m.id = e.manager_employee_id
left join lateral (
  select ae.*
  from public.attendance_events ae
  where ae.employee_id = e.id
    and ae.event_at::date = current_date
  order by ae.event_at desc nulls last, ae.created_at desc nulls last
  limit 1
) latest_event on true
left join lateral (
  select llr.employee_id, llr.latitude, llr.longitude, llr.accuracy_meters, coalesce(llr.captured_at, llr.responded_at, llr.created_at) as captured_at
  from public.live_location_responses llr
  where llr.employee_id = e.id
  order by coalesce(llr.captured_at, llr.responded_at, llr.created_at) desc nulls last
  limit 1
) latest_location on true
where coalesce(e.is_deleted, false) = false;

create or replace view public.attendance_risk_dashboard as
select
  e.id as employee_id,
  e.full_name,
  e.job_title,
  count(ae.id) filter (where ae.requires_review = true or ae.geofence_status in ('outside_branch','location_low_accuracy','permission_denied','location_unavailable','geofence_miss')) as flagged_events,
  count(distinct coalesce(ae.device_id, ae.user_agent, ae.source)) filter (where ae.created_at >= now() - interval '7 days') as device_count,
  count(ae.id) filter (where ae.created_at >= now() - interval '7 days' and ae.latitude is null) as missing_location_events,
  least(100,
    (count(ae.id) filter (where ae.requires_review = true or ae.geofence_status in ('outside_branch','location_low_accuracy','permission_denied','location_unavailable','geofence_miss')) * 15)
    + greatest(0, count(distinct coalesce(ae.device_id, ae.user_agent, ae.source)) - 1) * 20
    + (count(ae.id) filter (where ae.created_at >= now() - interval '7 days' and ae.latitude is null) * 8)
  )::int as risk_score
from public.employees e
left join public.attendance_events ae on ae.employee_id = e.id and ae.created_at >= now() - interval '7 days'
where coalesce(e.is_deleted, false) = false
group by e.id, e.full_name, e.job_title;

alter table public.attendance_risk_events enable row level security;
alter table public.admin_decisions enable row level security;
alter table public.admin_decision_acknowledgements enable row level security;
alter table public.dispute_minutes enable row level security;
alter table public.monthly_pdf_report_runs enable row level security;

-- RLS for manager-team-only and executive/HR access.
drop policy if exists "attendance_risk_events_select_scope" on public.attendance_risk_events;
create policy "attendance_risk_events_select_scope" on public.attendance_risk_events
for select using (public.current_can_see_employee(employee_id));

drop policy if exists "attendance_risk_events_manage_scope" on public.attendance_risk_events;
create policy "attendance_risk_events_manage_scope" on public.attendance_risk_events
for all using (public.current_has_any_scope(array['attendance:risk','attendance:review','attendance:manage','executive:mobile']))
with check (public.current_has_any_scope(array['attendance:risk','attendance:review','attendance:manage','executive:mobile']));

drop policy if exists "admin_decisions_select_visible" on public.admin_decisions;
create policy "admin_decisions_select_visible" on public.admin_decisions
for select using (
  public.current_has_any_scope(array['decisions:manage','notifications:manage','executive:report'])
  or scope in ('ALL','EMPLOYEES')
  or public.current_profile_employee_id() = any(target_employee_ids)
);

drop policy if exists "admin_decisions_manage" on public.admin_decisions;
create policy "admin_decisions_manage" on public.admin_decisions
for all using (public.current_has_any_scope(array['decisions:manage','notifications:manage','executive:report']))
with check (public.current_has_any_scope(array['decisions:manage','notifications:manage','executive:report']));

drop policy if exists "admin_decision_ack_select_scope" on public.admin_decision_acknowledgements;
create policy "admin_decision_ack_select_scope" on public.admin_decision_acknowledgements
for select using (
  employee_id = public.current_profile_employee_id()
  or public.current_has_any_scope(array['decisions:manage','notifications:manage','executive:report'])
);

drop policy if exists "admin_decision_ack_insert_self" on public.admin_decision_acknowledgements;
create policy "admin_decision_ack_insert_self" on public.admin_decision_acknowledgements
for insert with check (employee_id = public.current_profile_employee_id());

drop policy if exists "dispute_minutes_select_scope" on public.dispute_minutes;
create policy "dispute_minutes_select_scope" on public.dispute_minutes
for select using (public.current_has_any_scope(array['disputes:minutes','disputes:committee','disputes:manage','executive:mobile']));

drop policy if exists "dispute_minutes_manage_scope" on public.dispute_minutes;
create policy "dispute_minutes_manage_scope" on public.dispute_minutes
for all using (public.current_has_any_scope(array['disputes:minutes','disputes:committee','disputes:manage','executive:mobile']))
with check (public.current_has_any_scope(array['disputes:minutes','disputes:committee','disputes:manage','executive:mobile']));

drop policy if exists "monthly_pdf_report_runs_select_scope" on public.monthly_pdf_report_runs;
create policy "monthly_pdf_report_runs_select_scope" on public.monthly_pdf_report_runs
for select using (public.current_has_any_scope(array['reports:monthly-pdf-auto','reports:pdf','reports:export','executive:report']));

drop policy if exists "monthly_pdf_report_runs_manage_scope" on public.monthly_pdf_report_runs;
create policy "monthly_pdf_report_runs_manage_scope" on public.monthly_pdf_report_runs
for all using (public.current_has_any_scope(array['reports:monthly-pdf-auto','reports:pdf','reports:export','executive:report']))
with check (public.current_has_any_scope(array['reports:monthly-pdf-auto','reports:pdf','reports:export','executive:report']));

insert into public.settings (key, value, description)
values
  ('executive_presence_live', '{"enabled":true,"map":true,"missingLocationAlert":true}'::jsonb, 'لوحة حضور لحظية وخريطة مباشرة للمدير التنفيذي'),
  ('attendance_risk_scoring', '{"enabled":true,"duplicateWindowMinutes":10,"farDistanceMeters":1000,"newDevicePoints":20}'::jsonb, 'إعدادات تقييم خطر البصمة'),
  ('monthly_pdf_reports', '{"enabled":true,"frequency":"monthly","include":["attendance","late","absence","kpi","disputes","requests"],"printToPdf":true}'::jsonb, 'تقارير PDF شهرية تلقائية')
on conflict (key) do update set value = excluded.value, description = excluded.description, updated_at = now();

commit;
