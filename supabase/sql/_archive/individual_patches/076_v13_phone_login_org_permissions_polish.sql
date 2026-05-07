-- =========================================================
-- 076 V13 Phone Login + Org Permissions + Production Polish
-- Safe patch: keeps existing secrets/files untouched. Apply after 075.
-- =========================================================

-- 1) Normalize Egyptian phone numbers consistently.
create or replace function public.normalize_egypt_phone(value text)
returns text
language plpgsql
immutable
as $$
declare
  digits text;
begin
  if value is null then return null; end if;
  digits := translate(value, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  digits := regexp_replace(digits, '\D', '', 'g');
  if digits = '' then return null; end if;
  if left(digits, 4) = '0020' then digits := substring(digits from 3); end if;
  if left(digits, 2) = '20' and length(digits) >= 12 then digits := '0' || substring(digits from 3); end if;
  if length(digits) = 10 and left(digits, 1) = '1' then digits := '0' || digits; end if;
  return digits;
end;
$$;

alter table if exists public.employees add column if not exists phone_normalized text;
alter table if exists public.profiles add column if not exists phone_normalized text;
alter table if exists public.profiles add column if not exists must_change_password boolean default false;
alter table if exists public.profiles add column if not exists temporary_password boolean default false;
alter table if exists public.profiles add column if not exists password_changed_at timestamptz;

update public.employees set phone_normalized = public.normalize_egypt_phone(phone) where phone is not null;
update public.profiles set phone_normalized = public.normalize_egypt_phone(phone) where phone is not null;

create or replace function public.set_phone_normalized()
returns trigger
language plpgsql
as $$
begin
  new.phone_normalized := public.normalize_egypt_phone(new.phone);
  return new;
end;
$$;

drop trigger if exists trg_employees_phone_normalized on public.employees;
create trigger trg_employees_phone_normalized
before insert or update of phone on public.employees
for each row execute function public.set_phone_normalized();

drop trigger if exists trg_profiles_phone_normalized on public.profiles;
create trigger trg_profiles_phone_normalized
before insert or update of phone on public.profiles
for each row execute function public.set_phone_normalized();

-- 2) Resolve login phone to Auth email. Browser still uses signInWithPassword(email,password).
create or replace function public.resolve_login_identifier(login_identifier text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized text := public.normalize_egypt_phone(login_identifier);
  resolved_email text;
begin
  if normalized is null then return null; end if;

  select lower(p.email) into resolved_email
  from public.profiles p
  where coalesce(p.status, 'ACTIVE') in ('ACTIVE','INVITED')
    and public.normalize_egypt_phone(coalesce(p.phone_normalized, p.phone)) = normalized
    and p.email is not null
  order by p.updated_at desc nulls last
  limit 1;

  if resolved_email is not null then return resolved_email; end if;

  select lower(coalesce(p.email, e.email)) into resolved_email
  from public.employees e
  left join public.profiles p on p.employee_id = e.id or p.id = e.user_id
  where coalesce(e.is_deleted, false) = false
    and coalesce(e.status, 'ACTIVE') in ('ACTIVE','INVITED')
    and public.normalize_egypt_phone(coalesce(e.phone_normalized, e.phone)) = normalized
  order by e.updated_at desc nulls last
  limit 1;

  return resolved_email;
end;
$$;

grant execute on function public.resolve_login_identifier(text) to anon, authenticated;

-- 3) Prevent future duplicate phone assignments among active employees/profiles.
create or replace function public.prevent_duplicate_active_phone()
returns trigger
language plpgsql
as $$
declare
  normalized text := public.normalize_egypt_phone(new.phone);
  conflict_name text;
begin
  if normalized is null then return new; end if;

  if tg_table_name = 'employees' then
    select full_name into conflict_name
    from public.employees
    where id <> new.id
      and coalesce(is_deleted, false) = false
      and coalesce(status, 'ACTIVE') in ('ACTIVE','INVITED')
      and public.normalize_egypt_phone(coalesce(phone_normalized, phone)) = normalized
    limit 1;
  else
    select full_name into conflict_name
    from public.profiles
    where id <> new.id
      and coalesce(status, 'ACTIVE') in ('ACTIVE','INVITED')
      and public.normalize_egypt_phone(coalesce(phone_normalized, phone)) = normalized
    limit 1;
  end if;

  if conflict_name is not null then
    raise exception 'DUPLICATE_PHONE: رقم الهاتف مستخدم بالفعل لدى %', conflict_name;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_employees_prevent_duplicate_phone on public.employees;
create trigger trg_employees_prevent_duplicate_phone
before insert or update of phone on public.employees
for each row execute function public.prevent_duplicate_active_phone();

drop trigger if exists trg_profiles_prevent_duplicate_phone on public.profiles;
create trigger trg_profiles_prevent_duplicate_phone
before insert or update of phone on public.profiles
for each row execute function public.prevent_duplicate_active_phone();

-- 4) Official hierarchy alignment for existing known names.
do $$
declare
  exec_id uuid;
  secretary_id uuid;
  manager_id uuid;
begin
  select id into exec_id from public.employees where full_name ilike '%محمد يوسف%' or full_name ilike '%الشيخ محمد%' order by created_at limit 1;
  select id into secretary_id from public.employees where full_name ilike '%يحي%جمال%السبع%' or full_name ilike '%السكرتير التنفيذي%' order by created_at limit 1;

  if exec_id is not null then
    update public.employees set manager_employee_id = null where id = exec_id;
    if secretary_id is not null then update public.employees set manager_employee_id = exec_id where id = secretary_id; end if;
    update public.employees set manager_employee_id = exec_id where full_name in ('أحمد محجوب','بلال محمد الشاكر','ياسر فتحي نور الدين','محمد عبد الباسط','محمد عبد الباسط (أبو عمار)','مصطفي فايد','مصطفى فايد','مصطفى أحمد','يوسف رسمي شعبان') and id <> exec_id;
  end if;

  select id into manager_id from public.employees where full_name in ('محمد عبد الباسط','محمد عبد الباسط (أبو عمار)') order by created_at limit 1;
  if manager_id is not null then
    update public.employees set manager_employee_id = manager_id where full_name in ('محمد عبد العظيم','هاني احمد نصير','هاني أحمد نصير','حامد محمود العمدة');
    update public.employees set manager_employee_id = (select id from public.employees where full_name = 'حامد محمود العمدة' limit 1) where full_name = 'عبد الرحمن حسين' and exists (select 1 from public.employees where full_name = 'حامد محمود العمدة');
  end if;

  select id into manager_id from public.employees where full_name = 'أحمد محجوب' order by created_at limit 1;
  if manager_id is not null then update public.employees set manager_employee_id = manager_id where full_name in ('عبدالله حسين حافظ','عبد الله حسين حافظ','عبد القادر جمال'); end if;

  select id into manager_id from public.employees where full_name = 'يوسف رسمي شعبان' order by created_at limit 1;
  if manager_id is not null then update public.employees set manager_employee_id = manager_id where full_name in ('إسماعيل عبدالله','اسماعيل عبدالله','حسام عفيفي','محمد عبده مزار'); end if;

  select id into manager_id from public.employees where full_name = 'بلال محمد الشاكر' order by created_at limit 1;
  if manager_id is not null then update public.employees set manager_employee_id = manager_id where full_name = 'عمار محمد'; end if;

  select id into manager_id from public.employees where full_name = 'مصطفى أحمد' or full_name = 'مصطفي أحمد' order by created_at limit 1;
  if manager_id is not null then update public.employees set manager_employee_id = manager_id where full_name in ('محمد سيد','ربيع محمد','حاتم محمد سالم','طارق سيد إبراهيم'); end if;
end $$;

-- 5) Attendance / GPS production setting marker.
insert into public.system_settings(key, value, description)
values (
  'v13_production_polish',
  '{"phoneLogin":true,"temporaryPasswordIsPhone":true,"qrDisabled":true,"gpsReviewInsteadOfHardReject":true,"orgChartFromExecutive":true,"employeeProfileEditable":true}'::jsonb,
  'V13 production polish: phone login, profile edits, org chart, GPS review and QR disabled.'
)
on conflict (key) do update set value = excluded.value, description = excluded.description, updated_at = now();

notify pgrst, 'reload schema';
