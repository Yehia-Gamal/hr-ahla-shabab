-- =========================================================
-- Patch 005: تبسيط بيانات الموظفين والبصمة
-- - الحالة دائمًا ACTIVE
-- - لا نعتمد على الوردية في قبول البصمة
-- - وقت الدوام الرسمي للتقارير فقط: 10:00 إلى 18:00 بتوقيت القاهرة
-- - إنشاء عمود passkey_credential_id إن لم يكن موجودًا لتسجيل مرجع بصمة الجهاز
-- =========================================================

alter table public.attendance_events
  add column if not exists passkey_credential_id text;

update public.employees
set status = 'ACTIVE',
    is_active = true,
    shift_id = null
where is_deleted is not true;

create or replace function public.calculate_late_minutes(p_employee_id uuid, p_event_at timestamptz default now())
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  start_ts timestamptz;
  tz text := 'Africa/Cairo';
begin
  -- لا نستخدم الورديات. البداية الرسمية 10:00 صباحًا للتقارير فقط.
  start_ts := ((p_event_at at time zone tz)::date::text || ' 10:00')::timestamp at time zone tz;
  return greatest(0, floor(extract(epoch from (p_event_at - start_ts)) / 60)::integer);
end;
$$;

create or replace function public.force_employee_active_defaults()
returns trigger
language plpgsql
as $$
begin
  new.status := 'ACTIVE';
  new.is_active := true;
  new.shift_id := null;
  if new.employee_code is null or btrim(new.employee_code) = '' then
    new.employee_code := 'EMP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_force_employee_active_defaults on public.employees;
create trigger trg_force_employee_active_defaults
before insert or update on public.employees
for each row execute function public.force_employee_active_defaults();
