-- =========================================================
-- 028 Primary Admin + Runtime Schema Fixes
-- Creates/repairs the requested primary admin account:
--   email: admin.production@ahla-shabab.local
--   password: set v_password locally before applying; do not commit real passwords.
-- Also adds runtime columns required by policy acknowledgement and
-- live-location response flows.
-- =========================================================

create extension if not exists pgcrypto;

alter table if exists public.policy_acknowledgements
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.live_location_requests
  add column if not exists responded_at timestamptz,
  add column if not exists response_note text default '';

insert into public.roles (slug, key, name, permissions, active)
values ('admin', 'ADMIN', 'Primary Admin', array['*']::text[], true)
on conflict (slug) do update set
  key = excluded.key,
  name = excluded.name,
  permissions = array['*']::text[],
  active = true,
  updated_at = now();

do $$
declare
  v_email text := 'admin.production@ahla-shabab.local';
  v_password text := 'CHANGE_THIS_PASSWORD_BEFORE_APPLYING';
  v_full_name text := 'Primary Admin';
  v_user_id uuid;
  v_employee_id uuid;
  v_role_id uuid;
  v_branch_id uuid;
begin
  select id into v_role_id from public.roles where slug = 'admin' limit 1;
  select id into v_branch_id from public.branches order by created_at nulls last limit 1;
  select id into v_user_id from auth.users where lower(email) = lower(v_email) limit 1;

  if v_user_id is null then
    v_user_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, invited_at, confirmation_sent_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      is_super_admin,
      email_change, confirmation_token, recovery_token,
      email_change_token_new, email_change_token_current,
      phone, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')),
      now(), now(), now(),
      jsonb_build_object('provider','email','providers',array['email']),
      jsonb_build_object('full_name',v_full_name,'role','admin'),
      now(), now(),
      false,
      '', '', '', '', '', null, '', '', ''
    );
  else
    update auth.users
      set email = v_email,
          encrypted_password = crypt(v_password, gen_salt('bf')),
          email_confirmed_at = coalesce(email_confirmed_at, now()),
          raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('provider','email','providers',array['email']),
          raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name',v_full_name,'role','admin'),
          updated_at = now()
    where id = v_user_id;
  end if;

  insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (
    v_user_id,
    v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    'email',
    v_user_id::text,
    now(),
    now(),
    now()
  )
  on conflict (provider, provider_id) do update set
    user_id = excluded.user_id,
    identity_data = excluded.identity_data,
    updated_at = now();

  select id into v_employee_id
  from public.employees
  where employee_code = 'ADMIN-MAIN' or lower(email) = lower(v_email)
  limit 1;

  if v_employee_id is null then
    v_employee_id := gen_random_uuid();
    insert into public.employees (
      id, user_id, employee_code, full_name, email, phone, job_title,
      branch_id, role_id, manager_employee_id, status, is_active,
      is_deleted, hire_date, created_at, updated_at
    ) values (
      v_employee_id, v_user_id, 'ADMIN-MAIN', v_full_name, v_email, '', 'Primary Admin',
      v_branch_id, v_role_id, null, 'active', true,
      false, current_date, now(), now()
    );
  else
    update public.employees
      set user_id = v_user_id,
          employee_code = 'ADMIN-MAIN',
          full_name = v_full_name,
          email = v_email,
          job_title = 'Primary Admin',
          branch_id = coalesce(branch_id, v_branch_id),
          role_id = v_role_id,
          manager_employee_id = null,
          status = 'active',
          is_active = true,
          is_deleted = false,
          updated_at = now()
    where id = v_employee_id;
  end if;

  insert into public.profiles (
    id, employee_id, role_id, email, full_name, branch_id, status,
    temporary_password, must_change_password, created_at, updated_at
  ) values (
    v_user_id, v_employee_id, v_role_id, v_email, v_full_name, v_branch_id, 'active',
    false, false, now(), now()
  )
  on conflict (id) do update set
    employee_id = excluded.employee_id,
    role_id = excluded.role_id,
    email = excluded.email,
    full_name = excluded.full_name,
    branch_id = coalesce(public.profiles.branch_id, excluded.branch_id),
    status = 'active',
    temporary_password = false,
    must_change_password = false,
    updated_at = now();
end $$;

alter table if exists public.admin_access_logs enable row level security;

do $$
begin
  if to_regclass('public.admin_access_logs') is not null then
    drop policy if exists admin_access_logs_full_access_select on public.admin_access_logs;
    drop policy if exists admin_access_logs_full_access_insert on public.admin_access_logs;

    create policy admin_access_logs_full_access_select
      on public.admin_access_logs
      for select
      using (public.current_is_full_access());

    create policy admin_access_logs_full_access_insert
      on public.admin_access_logs
      for insert
      with check (public.current_is_full_access());
  end if;
end $$;
