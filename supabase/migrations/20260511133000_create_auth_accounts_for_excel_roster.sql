-- Create and link Supabase Auth accounts for the official AHS roster.
-- Initial password policy follows the current employee app behavior: phone number as first password.
-- Employees should change passwords after first login.

begin;

create extension if not exists pgcrypto;

alter table public.employees disable trigger trg_employees_prevent_duplicate_phone;
alter table public.profiles disable trigger trg_profiles_prevent_duplicate_phone;

with roster as (
  select
    e.*,
    regexp_replace(coalesce(e.phone, ''), '[^0-9]', '', 'g') as phone_digits,
    lower('emp.' || regexp_replace(coalesce(e.phone, ''), '[^0-9]', '', 'g') || '@ahla-shabab.org') as login_email
  from public.employees e
  where e.employee_code ~ '^AHS-[0-9]{3}$'
)
update public.employees e
set email = r.login_email,
    updated_at = now()
from roster r
where e.id = r.id
  and e.email is distinct from r.login_email;

with roster as (
  select
    e.*,
    regexp_replace(coalesce(e.phone, ''), '[^0-9]', '', 'g') as phone_digits,
    lower('emp.' || regexp_replace(coalesce(e.phone, ''), '[^0-9]', '', 'g') || '@ahla-shabab.org') as login_email
  from public.employees e
  where e.employee_code ~ '^AHS-[0-9]{3}$'
)
update auth.users u
set encrypted_password = crypt(r.phone_digits, gen_salt('bf')),
    email_confirmed_at = coalesce(u.email_confirmed_at, now()),
    raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object(
        'name', r.full_name,
        'full_name', r.full_name,
        'phone', r.phone,
        'employee_id', r.id,
        'employee_code', r.employee_code
      ),
    raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('provider', 'email', 'providers', array['email']),
    updated_at = now(),
    deleted_at = null,
    banned_until = null
from roster r
where lower(u.email) = r.login_email;

with roster as (
  select
    e.*,
    regexp_replace(coalesce(e.phone, ''), '[^0-9]', '', 'g') as phone_digits,
    lower('emp.' || regexp_replace(coalesce(e.phone, ''), '[^0-9]', '', 'g') || '@ahla-shabab.org') as login_email
  from public.employees e
  where e.employee_code ~ '^AHS-[0-9]{3}$'
),
missing as (
  select r.*
  from roster r
  where not exists (select 1 from auth.users u where lower(u.email) = r.login_email)
)
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  created_at,
  updated_at,
  phone,
  phone_confirmed_at,
  is_sso_user,
  is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  m.login_email,
  crypt(m.phone_digits, gen_salt('bf')),
  now(),
  jsonb_build_object('provider', 'email', 'providers', array['email']),
  jsonb_build_object(
    'name', m.full_name,
    'full_name', m.full_name,
    'phone', m.phone,
    'employee_id', m.id,
    'employee_code', m.employee_code
  ),
  false,
  now(),
  now(),
  null,
  null,
  false,
  false
from missing m;

insert into auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  u.id,
  u.id::text,
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
  'email',
  null,
  now(),
  now()
from auth.users u
join public.employees e on lower(e.email) = lower(u.email)
where e.employee_code ~ '^AHS-[0-9]{3}$'
on conflict (provider_id, provider) do update
set identity_data = excluded.identity_data,
    updated_at = now();

update public.employees e
set user_id = u.id,
    updated_at = now()
from auth.users u
where lower(u.email) = lower(e.email)
  and e.employee_code ~ '^AHS-[0-9]{3}$';

insert into public.profiles (
  id,
  employee_id,
  email,
  phone,
  full_name,
  avatar_url,
  role_id,
  branch_id,
  department_id,
  governorate_id,
  complex_id,
  status,
  temporary_password,
  must_change_password,
  password_changed_at,
  created_at,
  updated_at
)
select
  e.user_id,
  e.id,
  e.email,
  e.phone,
  e.full_name,
  e.photo_url,
  e.role_id,
  e.branch_id,
  e.department_id,
  e.governorate_id,
  e.complex_id,
  'ACTIVE',
  true,
  true,
  null,
  now(),
  now()
from public.employees e
where e.employee_code ~ '^AHS-[0-9]{3}$'
  and e.user_id is not null
on conflict (id) do update
set employee_id = excluded.employee_id,
    email = excluded.email,
    phone = excluded.phone,
    full_name = excluded.full_name,
    avatar_url = excluded.avatar_url,
    role_id = excluded.role_id,
    branch_id = excluded.branch_id,
    department_id = excluded.department_id,
    governorate_id = excluded.governorate_id,
    complex_id = excluded.complex_id,
    status = 'ACTIVE',
    temporary_password = true,
    must_change_password = true,
    updated_at = now();

update auth.users u
set confirmation_token = coalesce(u.confirmation_token, ''),
    recovery_token = coalesce(u.recovery_token, ''),
    email_change_token_new = coalesce(u.email_change_token_new, ''),
    email_change = coalesce(u.email_change, ''),
    email_change_token_current = coalesce(u.email_change_token_current, ''),
    phone_change = coalesce(u.phone_change, ''),
    phone_change_token = coalesce(u.phone_change_token, ''),
    reauthentication_token = coalesce(u.reauthentication_token, ''),
    is_super_admin = coalesce(u.is_super_admin, false),
    phone_confirmed_at = coalesce(u.phone_confirmed_at, u.email_confirmed_at),
    raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('email_verified', true, 'phone_login_ready', true),
    updated_at = now()
from public.employees e
where e.user_id = u.id
  and e.employee_code ~ '^AHS-[0-9]{3}$';

alter table public.employees enable trigger trg_employees_prevent_duplicate_phone;
alter table public.profiles enable trigger trg_profiles_prevent_duplicate_phone;

insert into public.database_migration_status (name, status, applied_at, notes)
values (
  '20260511_create_auth_accounts_for_excel_roster',
  'APPLIED',
  now(),
  'Created/linked Auth users and profiles for the 28 official AHS employees.'
)
on conflict (name) do update
  set status = excluded.status,
      notes = excluded.notes,
      applied_at = now();

insert into public.patch_markers(patch_key, applied_at, notes)
values (
  '20260511_create_auth_accounts_for_excel_roster',
  now(),
  'Created and linked Auth users/profiles for official AHS roster.'
)
on conflict (patch_key) do update
  set applied_at = excluded.applied_at,
      notes = excluded.notes;

notify pgrst, 'reload schema';

commit;
