-- =========================================================
-- 010 - تبسيط بيانات الموظفين والمستخدمين + حذف صلاحيات الرواتب + ضبط GPS للإنتاج
-- لا يحذف .git أو supabase/.temp أو 004_emergency_admin_access.sql
-- =========================================================

-- 1) حذف صلاحيات الرواتب من نظام الصلاحيات لأنها لم تعد مستخدمة في الواجهة.
delete from public.permissions where scope = 'payroll:manage';

do $$
declare
  permissions_type text;
begin
  select udt_name
  into permissions_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'roles'
    and column_name = 'permissions';

  if permissions_type = '_text' then
    update public.roles
    set permissions = array_remove(permissions, 'payroll:manage')
    where permissions::text ilike '%payroll%';
  elsif permissions_type = 'jsonb' then
    update public.roles
    set permissions = case
      when jsonb_typeof(permissions) = 'array' then (
        select coalesce(jsonb_agg(value), '[]'::jsonb)
        from jsonb_array_elements(permissions) as value
        where trim(both '"' from value::text) <> 'payroll:manage'
      )
      when jsonb_typeof(permissions) = 'object' then permissions - 'payroll:manage' - 'payroll'
      else permissions
    end
    where permissions::text ilike '%payroll%';
  end if;
end $$;

-- إزالة تكاملات الرواتب القديمة من شاشة التكاملات إن كانت موجودة.
delete from public.integration_settings
where key ilike '%payroll%'
   or provider ilike '%payroll%'
   or name ilike '%Payroll%'
   or name ilike '%رواتب%';

-- 2) ضبط GPS للإنتاج: نطاق المجمع 300 متر، وأقصى دقة GPS مقبولة 500 متر.
update public.branches
set
  name = 'مجمع منيل شيحة',
  address = 'مجمع منيل شيحة - الجيزة',
  latitude = 29.95109939158933,
  longitude = 31.238741920853883,
  geofence_radius_meters = 300,
  max_accuracy_meters = 500,
  active = true,
  is_deleted = false
where name ilike '%منيل%' or code in ('MAIN', 'AHLA-MANIL');

-- بعض النسخ لديها أعمدة إضافية في complexes من Patches سابقة؛ نحدثها فقط لو موجودة.
do $$
begin
  update public.complexes
  set name = 'مجمع منيل شيحة', active = true, is_deleted = false
  where name ilike '%منيل%' or code in ('AHLA-MANIL', 'CX-AHLA-MANIL');

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='complexes' and column_name='address') then
    execute $sql$update public.complexes set address = 'مجمع منيل شيحة - الجيزة' where name ilike '%منيل%' or code in ('AHLA-MANIL', 'CX-AHLA-MANIL')$sql$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='complexes' and column_name='latitude') then
    execute $sql$update public.complexes set latitude = 29.95109939158933 where name ilike '%منيل%' or code in ('AHLA-MANIL', 'CX-AHLA-MANIL')$sql$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='complexes' and column_name='longitude') then
    execute $sql$update public.complexes set longitude = 31.238741920853883 where name ilike '%منيل%' or code in ('AHLA-MANIL', 'CX-AHLA-MANIL')$sql$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='complexes' and column_name='radius_meters') then
    execute $sql$update public.complexes set radius_meters = 300 where name ilike '%منيل%' or code in ('AHLA-MANIL', 'CX-AHLA-MANIL')$sql$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='complexes' and column_name='max_accuracy_meters') then
    execute $sql$update public.complexes set max_accuracy_meters = 500 where name ilike '%منيل%' or code in ('AHLA-MANIL', 'CX-AHLA-MANIL')$sql$;
  end if;
end $$;

-- 3) إزالة الاعتماد العملي على كود الموظف والدوام المنفصل في البيانات الجديدة.
alter table if exists public.employees alter column employee_code drop not null;
update public.employees set employee_code = null where employee_code is not null;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='employees' and column_name='shift_id') then
    execute 'update public.employees set shift_id = null';
  end if;
end $$;

-- 4) تثبيت الحالة Active لكل الموظفين لأن النظام الحالي لا يحتاج حالات متعددة للموظف.
update public.employees
set status = 'ACTIVE', is_active = true, is_deleted = false
where coalesce(is_deleted, false) = false;

-- 5) حذف trigger قديم كان يعيد توليد employee_code إن وُجد.
drop trigger if exists trg_employee_defaults_single_branch on public.employees;
drop function if exists public.employee_defaults_single_branch();

-- 6) تبسيط profiles: إبقاء الربط والصلاحيات، بدون فرض فرع/قسم ظاهر للمستخدم.
update public.profiles
set status = coalesce(status, 'ACTIVE')
where id is not null;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='is_active') then
    execute 'update public.profiles set is_active = true';
  end if;
end $$;
