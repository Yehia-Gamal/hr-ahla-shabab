-- =========================================================
-- 020 Full Operations Pack
-- مهام داخلية + مستندات الموظفين + أرصدة الإجازات + قراءات الإعلانات
-- شغّل بعد 019_stability_passwords_disputes_requests.sql
-- =========================================================

create extension if not exists pgcrypto;

insert into public.permissions (scope, name) values
  ('tasks:manage', 'إدارة المهام الداخلية'),
  ('documents:manage', 'إدارة مستندات الموظفين'),
  ('leave:balance', 'إدارة أرصدة الإجازات'),
  ('announcements:manage', 'إدارة الإعلانات والقراءة'),
  ('executive:report', 'التقرير التنفيذي المختصر'),
  ('permissions:matrix', 'إدارة مصفوفة الصلاحيات'),
  ('tasks:self', 'متابعة مهامي'),
  ('documents:self', 'متابعة مستنداتي'),
  ('requests:self', 'متابعة طلباتي')
on conflict (scope) do update set name = excluded.name;

update public.roles
set permissions = array(select distinct unnest(coalesce(permissions, '{}') || array['tasks:self','documents:self','requests:self']))
where slug = 'employee';

update public.roles
set permissions = array['*']
where slug in ('admin','executive','executive-secretary','hr-manager');

create table if not exists public.leave_balances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  annual_total numeric not null default 21,
  casual_total numeric not null default 7,
  sick_total numeric not null default 15,
  used_days numeric not null default 0,
  remaining_days numeric not null default 28,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id)
);

create table if not exists public.employee_tasks (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  assigned_by_employee_id uuid references public.employees(id) on delete set null,
  title text not null,
  description text default '',
  priority text not null default 'MEDIUM',
  status text not null default 'OPEN',
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  title text not null,
  document_type text not null default 'OTHER',
  status text not null default 'ACTIVE',
  file_name text default '',
  file_url text default '',
  expires_on date,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.announcement_reads (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references public.notifications(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete cascade,
  read_at timestamptz not null default now(),
  unique(notification_id, employee_id)
);

create table if not exists public.policy_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  policy_key text not null,
  policy_title text not null,
  acknowledged_at timestamptz not null default now(),
  unique(employee_id, policy_key)
);

create index if not exists idx_leave_balances_employee on public.leave_balances(employee_id);
create index if not exists idx_employee_tasks_employee_status on public.employee_tasks(employee_id, status);
create index if not exists idx_employee_tasks_due on public.employee_tasks(due_date);
create index if not exists idx_employee_documents_employee on public.employee_documents(employee_id);
create index if not exists idx_employee_documents_expiry on public.employee_documents(expires_on);

alter table public.leave_balances enable row level security;
alter table public.employee_tasks enable row level security;
alter table public.employee_documents enable row level security;
alter table public.announcement_reads enable row level security;
alter table public.policy_acknowledgements enable row level security;

-- Employee scoped policies
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leave_balances','employee_tasks','employee_documents','policy_acknowledgements'] LOOP
    EXECUTE format('drop policy if exists "%1$s_read_scope" on public.%1$I', t);
    EXECUTE format('drop policy if exists "%1$s_insert_scope" on public.%1$I', t);
    EXECUTE format('drop policy if exists "%1$s_update_scope" on public.%1$I', t);
    EXECUTE format('drop policy if exists "%1$s_delete_full" on public.%1$I', t);
    EXECUTE format('create policy "%1$s_read_scope" on public.%1$I for select to authenticated using (public.can_access_employee(employee_id) or public.current_is_full_access())', t);
    EXECUTE format('create policy "%1$s_insert_scope" on public.%1$I for insert to authenticated with check (public.current_is_full_access() or employee_id = public.current_employee_id() or public.has_permission(''tasks:manage'') or public.has_permission(''documents:manage'') or public.has_permission(''leave:balance''))', t);
    EXECUTE format('create policy "%1$s_update_scope" on public.%1$I for update to authenticated using (public.current_is_full_access() or public.can_access_employee(employee_id)) with check (public.current_is_full_access() or public.can_access_employee(employee_id))', t);
    EXECUTE format('create policy "%1$s_delete_full" on public.%1$I for delete to authenticated using (public.current_is_full_access())', t);
  END LOOP;
END $$;

drop policy if exists "announcement_reads_scope" on public.announcement_reads;
create policy "announcement_reads_scope" on public.announcement_reads for all to authenticated
using (public.current_is_full_access() or employee_id = public.current_employee_id())
with check (public.current_is_full_access() or employee_id = public.current_employee_id());

-- View used by executive reporting / BI tools
create or replace view public.v_employee_operations_summary as
select
  e.id as employee_id,
  e.full_name,
  e.status,
  e.manager_employee_id,
  coalesce(lb.remaining_days, 28) as leave_remaining_days,
  count(distinct t.id) filter (where t.status <> 'DONE') as open_tasks,
  count(distinct d.id) filter (where d.expires_on is not null and d.expires_on <= current_date + interval '30 days') as expiring_documents
from public.employees e
left join public.leave_balances lb on lb.employee_id = e.id
left join public.employee_tasks t on t.employee_id = e.id
left join public.employee_documents d on d.employee_id = e.id
group by e.id, e.full_name, e.status, e.manager_employee_id, lb.remaining_days;
