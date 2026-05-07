-- =========================================================
-- 024 - Sensitive approvals + Executive presence hardening
-- Adds executive approval workflow for dangerous actions
-- and presence snapshot storage for mobile executive view.
-- =========================================================

create table if not exists public.sensitive_approvals (
  id uuid primary key default gen_random_uuid(),
  action_type text not null default 'SENSITIVE_ACTION',
  target_type text not null default 'system',
  target_id text,
  target_employee_id uuid references public.employees(id) on delete set null,
  title text not null default 'طلب اعتماد عملية حساسة',
  summary text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','EXECUTED','CANCELLED')),
  requested_by_user_id uuid references auth.users(id) on delete set null,
  requested_by_employee_id uuid references public.employees(id) on delete set null,
  requested_by_name text,
  requested_at timestamptz not null default now(),
  decided_by_user_id uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sensitive_approvals_status_idx on public.sensitive_approvals(status, created_at desc);
create index if not exists sensitive_approvals_target_employee_idx on public.sensitive_approvals(target_employee_id);

create table if not exists public.executive_presence_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null default current_date,
  counts jsonb not null default '{}'::jsonb,
  rows jsonb not null default '[]'::jsonb,
  generated_by_user_id uuid references auth.users(id) on delete set null,
  generated_at timestamptz not null default now()
);

create index if not exists executive_presence_snapshots_date_idx on public.executive_presence_snapshots(snapshot_date desc, generated_at desc);

alter table public.sensitive_approvals enable row level security;
alter table public.executive_presence_snapshots enable row level security;

do $$ begin
  create policy "sensitive approvals readable by admins"
  on public.sensitive_approvals for select
  using (
    exists (
      select 1 from public.profiles p
      left join public.roles r on r.id = p.role_id
      where p.id = auth.uid()
        and coalesce(r.key, r.slug, '') in ('ADMIN','EXECUTIVE','EXECUTIVE_SECRETARY','HR_MANAGER','admin','executive','executive-secretary','hr-manager')
    )
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "sensitive approvals insert by admins"
  on public.sensitive_approvals for insert
  with check (
    exists (
      select 1 from public.profiles p
      left join public.roles r on r.id = p.role_id
      where p.id = auth.uid()
        and coalesce(r.key, r.slug, '') in ('ADMIN','EXECUTIVE','EXECUTIVE_SECRETARY','HR_MANAGER','admin','executive','executive-secretary','hr-manager')
    )
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "sensitive approvals update by executive authority"
  on public.sensitive_approvals for update
  using (
    exists (
      select 1 from public.profiles p
      left join public.roles r on r.id = p.role_id
      where p.id = auth.uid()
        and coalesce(r.key, r.slug, '') in ('ADMIN','EXECUTIVE','EXECUTIVE_SECRETARY','admin','executive','executive-secretary')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      left join public.roles r on r.id = p.role_id
      where p.id = auth.uid()
        and coalesce(r.key, r.slug, '') in ('ADMIN','EXECUTIVE','EXECUTIVE_SECRETARY','admin','executive','executive-secretary')
    )
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "executive presence readable by executive authority"
  on public.executive_presence_snapshots for select
  using (
    exists (
      select 1 from public.profiles p
      left join public.roles r on r.id = p.role_id
      where p.id = auth.uid()
        and coalesce(r.key, r.slug, '') in ('ADMIN','EXECUTIVE','EXECUTIVE_SECRETARY','HR_MANAGER','admin','executive','executive-secretary','hr-manager')
    )
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "executive presence insert by executive authority"
  on public.executive_presence_snapshots for insert
  with check (
    exists (
      select 1 from public.profiles p
      left join public.roles r on r.id = p.role_id
      where p.id = auth.uid()
        and coalesce(r.key, r.slug, '') in ('ADMIN','EXECUTIVE','EXECUTIVE_SECRETARY','HR_MANAGER','admin','executive','executive-secretary','hr-manager')
    )
  );
exception when duplicate_object then null; end $$;

-- Optional permission seeds if your roles/permissions tables exist.
insert into public.permissions (scope, name)
select scope, name
from (values
  ('sensitive-actions:approve', 'اعتماد العمليات الحساسة'),
  ('sensitive-actions:request', 'طلب تنفيذ عملية حساسة'),
  ('executive:presence-map', 'عرض خريطة الحضور التنفيذية')
) as v(scope, name)
where exists (select 1 from information_schema.tables where table_schema='public' and table_name='permissions')
on conflict (scope) do nothing;
