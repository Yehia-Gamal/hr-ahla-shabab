-- =========================================================
-- 004_emergency_admin_access.sql
-- إصلاح دخول أدمن طارئ بكامل الصلاحيات لاختبار النظام
--
-- قبل التشغيل: غيّر v_email و v_password إذا أردت.
-- بعد الدخول: غيّر كلمة المرور فورًا من Supabase Auth أو من النظام بعد التأكد من عمل صفحة تغيير كلمة المرور.
-- =========================================================

create extension if not exists pgcrypto;

do $$
declare
  v_email text := 'admin@example.local';
  v_password text := 'ChangeMe_Admin#2026!';
  v_full_name text := 'مدير النظام';
  v_user_id uuid;
  v_role_id uuid;
  v_employee_id uuid;
  v_branch_id uuid;
  v_department_id uuid;
  v_governorate_id uuid;
  v_complex_id uuid;
begin
  -- 1) تأكيد وجود دور أدمن كامل الصلاحيات
  insert into public.roles (slug, key, name, permissions, active)
  values ('admin', 'ADMIN', 'مدير النظام', array['*']::text[], true)
  on conflict (slug) do update set
    key = excluded.key,
    name = excluded.name,
    permissions = array['*']::text[],
    active = true,
    updated_at = now();

  select id into v_role_id
  from public.roles
  where slug = 'admin'
  limit 1;

  -- 2) التقاط مراجع اختيارية للفرع/القسم حتى يكون الحساب مربوطًا بالنظام
  select id into v_branch_id from public.branches where code = 'MAIN' limit 1;
  select id into v_department_id from public.departments where code in ('EXEC','HR') order by case when code='EXEC' then 0 else 1 end limit 1;
  select id into v_governorate_id from public.governorates where code = 'GZ' limit 1;
  select id into v_complex_id from public.complexes where code = 'AHLA-MANIL' limit 1;

  -- 3) إنشاء أو إصلاح مستخدم Supabase Auth
  select id into v_user_id
  from auth.users
  where lower(email) = lower(v_email)
  limit 1;

  if v_user_id is null then
    v_user_id := gen_random_uuid();

    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      confirmation_sent_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      is_super_admin
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      crypt(v_password, gen_salt('bf')),
      now(),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_full_name, 'role', 'admin'),
      now(),
      now(),
      false
    );
  else
    update auth.users
    set encrypted_password = crypt(v_password, gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        aud = 'authenticated',
        role = 'authenticated',
        banned_until = null,
        raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"provider":"email","providers":["email"]}'::jsonb,
        raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', v_full_name, 'role', 'admin'),
        updated_at = now()
    where id = v_user_id;
  end if;

  -- 4) تأكيد وجود Identity email حتى يستطيع Supabase Auth تسجيل الدخول بالبريد/الباسورد
  if exists (select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'identities') then
    if exists (select 1 from auth.identities where user_id = v_user_id and provider = 'email') then
      update auth.identities
      set identity_data = jsonb_build_object(
            'sub', v_user_id::text,
            'email', v_email,
            'email_verified', true,
            'phone_verified', false
          ),
          provider_id = v_user_id::text,
          last_sign_in_at = coalesce(last_sign_in_at, now()),
          updated_at = now()
      where user_id = v_user_id and provider = 'email';
    else
      insert into auth.identities (
        id,
        user_id,
        provider_id,
        identity_data,
        provider,
        last_sign_in_at,
        created_at,
        updated_at
      ) values (
        gen_random_uuid(),
        v_user_id,
        v_user_id::text,
        jsonb_build_object(
          'sub', v_user_id::text,
          'email', v_email,
          'email_verified', true,
          'phone_verified', false
        ),
        'email',
        now(),
        now(),
        now()
      );
    end if;
  end if;

  -- 5) إنشاء أو ربط Employee أدمن
  select id into v_employee_id
  from public.employees
  where user_id = v_user_id or lower(email) = lower(v_email)
  order by case when user_id = v_user_id then 0 else 1 end
  limit 1;

  if v_employee_id is null then
    insert into public.employees (
      employee_code,
      full_name,
      phone,
      email,
      job_title,
      role_id,
      branch_id,
      department_id,
      governorate_id,
      complex_id,
      status,
      is_active,
      is_deleted,
      hire_date,
      user_id
    ) values (
      'ADMIN-001',
      v_full_name,
      'PHONE_PLACEHOLDER_001',
      v_email,
      'أدمن رئيسي',
      v_role_id,
      v_branch_id,
      v_department_id,
      v_governorate_id,
      v_complex_id,
      'ACTIVE',
      true,
      false,
      current_date,
      v_user_id
    )
    on conflict (employee_code) do update set
      full_name = excluded.full_name,
      email = excluded.email,
      job_title = excluded.job_title,
      role_id = excluded.role_id,
      branch_id = excluded.branch_id,
      department_id = excluded.department_id,
      governorate_id = excluded.governorate_id,
      complex_id = excluded.complex_id,
      status = 'ACTIVE',
      is_active = true,
      is_deleted = false,
      user_id = excluded.user_id,
      updated_at = now()
    returning id into v_employee_id;
  else
    update public.employees
    set full_name = coalesce(nullif(full_name, ''), v_full_name),
        email = v_email,
        job_title = 'أدمن رئيسي',
        role_id = v_role_id,
        branch_id = coalesce(branch_id, v_branch_id),
        department_id = coalesce(department_id, v_department_id),
        governorate_id = coalesce(governorate_id, v_governorate_id),
        complex_id = coalesce(complex_id, v_complex_id),
        status = 'ACTIVE',
        is_active = true,
        is_deleted = false,
        user_id = v_user_id,
        updated_at = now()
    where id = v_employee_id;
  end if;

  -- 6) إنشاء/إصلاح Profile وربطه بدور الأدمن
  insert into public.profiles (
    id,
    employee_id,
    email,
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
  ) values (
    v_user_id,
    v_employee_id,
    v_email,
    v_full_name,
    '',
    v_role_id,
    v_branch_id,
    v_department_id,
    v_governorate_id,
    v_complex_id,
    'ACTIVE',
    false,
    false,
    now(),
    now(),
    now()
  )
  on conflict (id) do update set
    employee_id = excluded.employee_id,
    email = excluded.email,
    full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name),
    role_id = excluded.role_id,
    branch_id = coalesce(public.profiles.branch_id, excluded.branch_id),
    department_id = coalesce(public.profiles.department_id, excluded.department_id),
    governorate_id = coalesce(public.profiles.governorate_id, excluded.governorate_id),
    complex_id = coalesce(public.profiles.complex_id, excluded.complex_id),
    status = 'ACTIVE',
    temporary_password = false,
    must_change_password = false,
    password_changed_at = now(),
    failed_logins = 0,
    locked_until = null,
    updated_at = now();

  -- 7) دعم قواعد قديمة لو كان profiles يحتوي permissions jsonb من نسخة سابقة
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'permissions'
  ) then
    execute 'update public.profiles set permissions = $1::jsonb where id = $2'
    using jsonb_build_object(
      'role', 'admin',
      'fullAccess', true,
      'system', true,
      'employees', true,
      'attendance', true,
      'reports', true,
      'settings', true
    ), v_user_id;
  end if;

  raise notice 'Emergency admin is ready. Email: %, Temporary password: %. Change it immediately after login.', v_email, v_password;
end $$;

-- 8) فحص نهائي سريع
select
  u.id as auth_user_id,
  u.email,
  u.email_confirmed_at,
  p.status as profile_status,
  p.temporary_password,
  p.must_change_password,
  e.employee_code,
  e.full_name as employee_name,
  e.is_active as employee_active,
  e.is_deleted as employee_deleted,
  r.slug as role_slug,
  r.permissions as role_permissions
from auth.users u
left join public.profiles p on p.id = u.id
left join public.employees e on e.user_id = u.id
left join public.roles r on r.id = p.role_id
where lower(u.email) = lower('admin@example.local');
