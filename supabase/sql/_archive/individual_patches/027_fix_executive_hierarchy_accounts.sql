-- =========================================================
-- 027 Fix Executive Hierarchy Accounts
-- Repairs the Ahla Shabab executive/manager tree in Supabase.
-- Safe to re-run. It does not delete rows; old duplicate roster rows are
-- marked inactive/deleted so they stop appearing in active operational views.
-- =========================================================

create extension if not exists pgcrypto;

alter table if exists public.employees
  add column if not exists manager_employee_id uuid references public.employees(id) on delete set null;

alter table if exists public.departments
  add column if not exists manager_employee_id uuid references public.employees(id) on delete set null;

-- Required roles and permissions.
insert into public.roles (slug, key, name, permissions, active)
values
  ('admin', 'ADMIN', 'مدير النظام', array['*']::text[], true),
  ('executive', 'EXECUTIVE', 'المدير التنفيذي', array['*']::text[], true),
  ('executive-secretary', 'EXECUTIVE_SECRETARY', 'السكرتير التنفيذي', array['*']::text[], true),
  ('hr-manager', 'HR_MANAGER', 'الموارد البشرية', array['*']::text[], true),
  ('manager', 'DIRECT_MANAGER', 'مدير مباشر', array['dashboard:view','employees:view','attendance:manage','requests:approve','kpi:team','reports:export','realtime:view','attendance:review']::text[], true),
  ('employee', 'EMPLOYEE', 'موظف', array['dashboard:view','attendance:self','kpi:self','disputes:create','location:self','requests:self','tasks:self']::text[], true)
on conflict (slug) do update set
  key = excluded.key,
  name = excluded.name,
  permissions = excluded.permissions,
  active = true,
  updated_at = now();

-- Stable departments for the organization tree.
insert into public.departments (code, name, branch_id, active)
select d.code, d.name, b.id, true
from (values
  ('EXEC', 'الإدارة التنفيذية'),
  ('MGT', 'الإشراف والمديرون المباشرون'),
  ('OPS', 'فرق التشغيل والخدمات'),
  ('HR', 'الموارد البشرية')
) as d(code, name)
cross join lateral (select id from public.branches order by created_at nulls last, id limit 1) b
on conflict (code) do update set
  name = excluded.name,
  branch_id = coalesce(public.departments.branch_id, excluded.branch_id),
  active = true,
  updated_at = now();

create temp table if not exists tmp_ahla_roster_027 (
  employee_code text primary key,
  full_name text not null,
  phone text,
  email text,
  job_title text,
  role_slug text not null,
  department_code text not null,
  manager_code text,
  hire_date date
) on commit drop;

truncate tmp_ahla_roster_027;

insert into tmp_ahla_roster_027 (employee_code, full_name, phone, email, job_title, role_slug, department_code, manager_code, hire_date)
values
  ('EMP-001', 'المدير التنفيذي', 'PHONE_PLACEHOLDER_021', 'executive.director@organization.local', 'المدير التنفيذي', 'executive', 'EXEC', null, '2020-01-01'),
  ('EMP-002', 'السكرتير التنفيذي', 'PHONE_PLACEHOLDER_022', 'executive.secretary@organization.local', 'السكرتير التنفيذي', 'executive-secretary', 'EXEC', 'EMP-001', '2021-01-01'),
  ('EMP-003', 'مدير مباشر رابع', 'PHONE_PLACEHOLDER_023', 'ahmed.mahgoob@ahla.local', 'مدير مباشر', 'manager', 'MGT', 'EMP-001', '2021-02-01'),
  ('EMP-004', 'مدير مباشر أول', 'PHONE_PLACEHOLDER_024', 'direct.manager.01@organization.local', 'مدير مباشر', 'manager', 'MGT', 'EMP-001', '2021-02-01'),
  ('EMP-005', 'مدير مباشر ثانٍ', 'PHONE_PLACEHOLDER_025', 'direct.manager.02@organization.local', 'مدير مباشر', 'manager', 'MGT', 'EMP-001', '2021-02-01'),
  ('EMP-006', 'مدير مباشر ثالث', 'PHONE_PLACEHOLDER_026', 'direct.manager.03@organization.local', 'مدير مباشر', 'manager', 'MGT', 'EMP-001', '2021-02-01'),
  ('EMP-007', 'موظف تشغيلي 01', 'PHONE_PLACEHOLDER_027', 'direct.manager.05@organization.local', 'مدير مباشر', 'manager', 'MGT', 'EMP-001', '2021-02-01'),
  ('EMP-008', 'موظف تشغيلي 18', 'PHONE_PLACEHOLDER_028', 'direct.manager.06@organization.local', 'مدير مباشر', 'manager', 'MGT', 'EMP-001', '2021-02-01'),
  ('EMP-009', 'موظف تشغيلي 14', 'PHONE_PLACEHOLDER_029', 'direct.manager.07@organization.local', 'مدير مباشر', 'manager', 'MGT', 'EMP-001', '2021-02-01'),
  ('EMP-010', 'موظف تشغيلي 07', 'PHONE_PLACEHOLDER_030', 'employee.006@organization.local', 'موظف فريق مدير مباشر ثالث', 'employee', 'OPS', 'EMP-006', '2022-01-01'),
  ('EMP-011', 'موظف تشغيلي 08', 'PHONE_PLACEHOLDER_031', 'employee.007@organization.local', 'موظف فريق مدير مباشر ثالث', 'employee', 'OPS', 'EMP-006', '2022-01-01'),
  ('EMP-012', 'موظف تشغيلي 04', 'PHONE_PLACEHOLDER_032', 'direct.manager.08@organization.local', 'مشرف مباشر', 'manager', 'MGT', 'EMP-006', '2022-01-01'),
  ('EMP-013', 'موظف تشغيلي 05', 'PHONE_PLACEHOLDER_033', 'employee.005@organization.local', 'موظف تحت إشراف مباشر', 'employee', 'OPS', 'EMP-012', '2022-01-01'),
  ('EMP-014', 'موظف تشغيلي 13', 'PHONE_PLACEHOLDER_034', 'abdullah.hussein@ahla.local', 'موظف فريق مدير مباشر رابع', 'employee', 'OPS', 'EMP-003', '2022-01-01'),
  ('EMP-015', 'موظف تشغيلي 06', 'PHONE_PLACEHOLDER_035', 'employee.006@organization.local', 'موظف فريق مدير مباشر رابع', 'employee', 'OPS', 'EMP-003', '2022-01-01'),
  ('EMP-016', 'موظف تشغيلي 16', 'PHONE_PLACEHOLDER_036', 'employee.016@organization.local', 'موظف فريق المدير المباشر السابع', 'employee', 'OPS', 'EMP-009', '2022-01-01'),
  ('EMP-017', 'موظف تشغيلي 10', 'PHONE_PLACEHOLDER_037', 'employee.010@organization.local', 'موظف فريق المدير المباشر السابع', 'employee', 'OPS', 'EMP-009', '2022-01-01'),
  ('EMP-018', 'موظف تشغيلي 15', 'PHONE_PLACEHOLDER_038', 'employee.015@organization.local', 'موظف فريق المدير المباشر السابع', 'employee', 'OPS', 'EMP-009', '2022-01-01'),
  ('EMP-019', 'موظف تشغيلي 17', 'PHONE_PLACEHOLDER_039', 'employee.017@organization.local', 'موظف فريق المدير المباشر الأول', 'employee', 'OPS', 'EMP-004', '2022-01-01'),
  ('EMP-020', 'موظف تشغيلي 11', 'PHONE_PLACEHOLDER_040', 'employee.011@organization.local', 'موظف فريق موظف تشغيلي 18', 'employee', 'OPS', 'EMP-008', '2022-01-01'),
  ('EMP-021', 'موظف تشغيلي 12', 'PHONE_PLACEHOLDER_041', 'employee.012@organization.local', 'موظف فريق موظف تشغيلي 18', 'employee', 'OPS', 'EMP-008', '2022-01-01'),
  ('EMP-022', 'موظف تشغيلي 03', 'PHONE_PLACEHOLDER_042', 'employee.003@organization.local', 'موظف فريق موظف تشغيلي 18', 'employee', 'OPS', 'EMP-008', '2022-01-01'),
  ('EMP-023', 'موظف تشغيلي 09', 'PHONE_PLACEHOLDER_043', 'tarek.ibrahim@ahla.local', 'موظف فريق موظف تشغيلي 18', 'employee', 'OPS', 'EMP-008', '2022-01-01');

-- Upsert the canonical roster.
insert into public.employees (
  employee_code, full_name, phone, email, job_title, role_id, branch_id, department_id,
  governorate_id, complex_id, shift_id, status, is_active, is_deleted, hire_date
)
select
  r.employee_code,
  r.full_name,
  r.phone,
  r.email,
  r.job_title,
  role.id,
  branch.id,
  dept.id,
  gov.id,
  complex.id,
  shift_row.id,
  'ACTIVE',
  true,
  false,
  r.hire_date
from tmp_ahla_roster_027 r
join public.roles role on role.slug = r.role_slug
left join public.departments dept on dept.code = r.department_code
left join lateral (select id from public.branches order by created_at nulls last, id limit 1) branch on true
left join lateral (select id from public.governorates order by created_at nulls last, id limit 1) gov on true
left join lateral (select id from public.complexes order by created_at nulls last, id limit 1) complex on true
left join lateral (select id from public.shifts order by created_at nulls last, id limit 1) shift_row on true
on conflict (employee_code) do update set
  full_name = excluded.full_name,
  phone = excluded.phone,
  email = excluded.email,
  job_title = excluded.job_title,
  role_id = excluded.role_id,
  branch_id = excluded.branch_id,
  department_id = excluded.department_id,
  governorate_id = excluded.governorate_id,
  complex_id = excluded.complex_id,
  shift_id = excluded.shift_id,
  status = 'ACTIVE',
  is_active = true,
  is_deleted = false,
  hire_date = excluded.hire_date,
  updated_at = now();

-- Manager tree.
update public.employees e
set manager_employee_id = manager.id,
    updated_at = now()
from tmp_ahla_roster_027 r
left join public.employees manager on manager.employee_code = r.manager_code
where e.employee_code = r.employee_code;

-- Hide duplicate active roster rows with the same names but non-canonical codes.
update public.employees e
set is_active = false,
    is_deleted = true,
    status = 'INACTIVE',
    updated_at = now()
from tmp_ahla_roster_027 r
where e.full_name = r.full_name
  and e.employee_code <> r.employee_code
  and coalesce(e.is_deleted, false) = false;

-- Current real Yihia login aliases should point to the secretary employee/profile.
update public.profiles p
set employee_id = emp.id,
    role_id = role.id,
    full_name = 'السكرتير التنفيذي',
    phone = coalesce(p.phone, emp.phone),
    branch_id = emp.branch_id,
    department_id = emp.department_id,
    governorate_id = emp.governorate_id,
    complex_id = emp.complex_id,
    status = 'ACTIVE',
    updated_at = now()
from public.employees emp
join public.roles role on role.slug = 'executive-secretary'
where emp.employee_code = 'EMP-002'
  and lower(p.email) in ('legacy.secretary.01@removed.local', 'legacy.secretary.02@removed.local', 'executive.secretary@organization.local');

update public.employees e
set user_id = p.id,
    updated_at = now()
from public.profiles p
where e.employee_code = 'EMP-002'
  and lower(p.email) = 'legacy.secretary.01@removed.local';

-- Create/repair Auth + Profile accounts for canonical roster rows when absent.
do $$
declare
  rec record;
  v_user_id uuid;
  v_employee_id uuid;
  v_temp_password text := 'ChangeMe_Ahla#2026!';
begin
  for rec in
    select r.*, e.id as employee_id, e.branch_id, e.department_id, e.governorate_id, e.complex_id, role.id as role_id
    from tmp_ahla_roster_027 r
    join public.employees e on e.employee_code = r.employee_code
    join public.roles role on role.slug = r.role_slug
  loop
    v_employee_id := rec.employee_id;

    select id into v_user_id
    from auth.users
    where lower(email) = lower(rec.email)
    limit 1;

    if v_user_id is null then
      v_user_id := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        confirmation_sent_at, raw_app_meta_data, raw_user_meta_data, created_at,
        updated_at, is_super_admin
      ) values (
        '00000000-0000-0000-0000-000000000000',
        v_user_id,
        'authenticated',
        'authenticated',
        rec.email,
        crypt(v_temp_password, gen_salt('bf')),
        now(),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', rec.full_name, 'role', rec.role_slug),
        now(),
        now(),
        false
      );
    else
      update auth.users
      set email_confirmed_at = coalesce(email_confirmed_at, now()),
          aud = 'authenticated',
          role = 'authenticated',
          banned_until = null,
          raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"provider":"email","providers":["email"]}'::jsonb,
          raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', rec.full_name, 'role', rec.role_slug),
          updated_at = now()
      where id = v_user_id;
    end if;

    if exists (select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'identities') then
      insert into auth.identities (
        id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(),
        v_user_id,
        v_user_id::text,
        jsonb_build_object('sub', v_user_id::text, 'email', rec.email, 'email_verified', true, 'phone_verified', false),
        'email',
        now(),
        now(),
        now()
      )
      on conflict (provider, provider_id) do update set
        user_id = excluded.user_id,
        identity_data = excluded.identity_data,
        updated_at = now();
    end if;

    update public.employees
    set user_id = v_user_id,
        updated_at = now()
    where id = v_employee_id
      and (user_id is null or employee_code in ('EMP-001','EMP-003','EMP-004','EMP-005','EMP-006','EMP-007','EMP-008','EMP-009','EMP-012'));

    insert into public.profiles (
      id, employee_id, email, phone, full_name, avatar_url, role_id, branch_id,
      department_id, governorate_id, complex_id, status, temporary_password,
      must_change_password, password_changed_at, created_at, updated_at
    ) values (
      v_user_id,
      v_employee_id,
      rec.email,
      rec.phone,
      rec.full_name,
      '',
      rec.role_id,
      rec.branch_id,
      rec.department_id,
      rec.governorate_id,
      rec.complex_id,
      'ACTIVE',
      true,
      true,
      null,
      now(),
      now()
    )
    on conflict (id) do update set
      employee_id = excluded.employee_id,
      email = excluded.email,
      phone = excluded.phone,
      full_name = excluded.full_name,
      role_id = excluded.role_id,
      branch_id = excluded.branch_id,
      department_id = excluded.department_id,
      governorate_id = excluded.governorate_id,
      complex_id = excluded.complex_id,
      status = 'ACTIVE',
      updated_at = now();
  end loop;
end $$;

-- Department managers.
update public.departments d
set manager_employee_id = e.id,
    updated_at = now()
from public.employees e
where (d.code = 'EXEC' and e.employee_code = 'EMP-001')
   or (d.code = 'MGT' and e.employee_code = 'EMP-001')
   or (d.code = 'OPS' and e.employee_code = 'EMP-006')
   or (d.code = 'HR' and e.employee_code = 'EMP-002');

-- Close old imported duplicates for old executive/secretary aliases, then attach
-- any remaining active orphan employee directly under the executive root.
with canonical as (
  select id from public.employees where employee_code in ('EMP-001','EMP-002')
)
update public.employees e
set is_active = false,
    is_deleted = true,
    status = 'INACTIVE',
    updated_at = now()
where e.id not in (select id from canonical)
  and coalesce(e.is_deleted, false) = false
  and (
    e.employee_code in ('EMP-192404E9','EMP-F9889BBE')
    or
    lower(coalesce(e.email, '')) in ('legacy.secretary.01@removed.local','legacy.secretary.02@removed.local')
    or e.full_name in ('اسم تنفيذي قديم','اسم سكرتارية قديم')
    or (e.full_name like '%السكرتير التنفيذي جمال%' and e.employee_code <> 'EMP-002')
    or (e.full_name like '%اسم تنفيذي قديم%' and e.employee_code <> 'EMP-001')
  );

with root as (
  select id from public.employees where employee_code = 'EMP-001'
)
update public.employees e
set manager_employee_id = root.id,
    updated_at = now()
from root
where e.employee_code <> 'EMP-001'
  and coalesce(e.is_deleted, false) = false
  and e.manager_employee_id is null;

-- Recursive hierarchy visibility for managers and full access users.
create or replace function public.can_access_employee(emp_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive team(id) as (
    select public.current_employee_id()
    union all
    select e.id
    from public.employees e
    join team t on e.manager_employee_id = t.id
    where coalesce(e.is_deleted, false) = false
  )
  select coalesce(
    public.current_is_full_access()
    or emp_id in (select id from team),
    false
  );
$$;

comment on function public.can_access_employee(uuid) is 'Allows a manager to read their full subordinate tree, plus full access roles.';

-- Verification result.
select
  e.employee_code,
  e.full_name,
  r.slug as role_slug,
  manager.employee_code as manager_code,
  manager.full_name as manager_name,
  e.email,
  e.user_id is not null as has_auth_user,
  coalesce(e.is_deleted, false) as is_deleted
from public.employees e
left join public.roles r on r.id = e.role_id
left join public.employees manager on manager.id = e.manager_employee_id
where e.employee_code in (select employee_code from tmp_ahla_roster_027)
order by e.employee_code;
